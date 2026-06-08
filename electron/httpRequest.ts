import http from 'http'
import https from 'https'
import zlib from 'zlib'

export type HttpBridgeRequestOptions = {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
  maxRedirects?: number
}

export type HttpBridgeResponse = {
  status: number
  statusText: string
  headers: Record<string, string>
  setCookies: string[]
  bodyBuffer: Buffer
  bodyText: string
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return Object.prototype.toString.call(value) === '[object Object]'
}

const normalizeRequestHeaders = (headers?: Record<string, string>) => {
  const normalized: Record<string, string> = {}
  if (!headers) return normalized
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) continue
    normalized[key] = String(value)
  }
  return normalized
}

const normalizeResponseHeaders = (headers: http.IncomingHttpHeaders) => {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'undefined') continue
    // Set-Cookie must NOT be joined — the HTTP spec forbids it
    if (key.toLowerCase() === 'set-cookie') continue
    normalized[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value)
  }
  return normalized
}

const encodeBody = (body: unknown, headers: Record<string, string>) => {
  if (body == null) return undefined
  if (typeof body === 'string') return Buffer.from(body)
  if (body instanceof Uint8Array) return Buffer.from(body)
  if (body instanceof ArrayBuffer) return Buffer.from(body)

  if (isPlainObject(body)) {
    const contentType = (headers['content-type'] || headers['Content-Type'] || '').toLowerCase()
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(body)) {
        params.append(key, value == null ? '' : String(value))
      }
      return Buffer.from(params.toString())
    }

    if (!contentType) {
      headers['content-type'] = 'application/json;charset=UTF-8'
    }

    return Buffer.from(JSON.stringify(body))
  }

  return Buffer.from(String(body))
}

const decodeBody = (buffer: Buffer, encoding?: string) => {
  if (!buffer.length || !encoding) return buffer

  const normalizedEncoding = encoding.toLowerCase()
  try {
    if (normalizedEncoding.includes('gzip')) return zlib.gunzipSync(buffer)
    if (normalizedEncoding.includes('deflate')) return zlib.inflateSync(buffer)
    if (normalizedEncoding.includes('br')) return zlib.brotliDecompressSync(buffer)
  } catch (error) {
    console.warn('Decode response body failed:', error)
  }

  return buffer
}

export const performHttpRequest = async(options: HttpBridgeRequestOptions): Promise<HttpBridgeResponse> => {
  const url = options?.url
  if (!url || typeof url !== 'string') {
    throw new Error('A valid url is required')
  }

  const target = new URL(url)
  const method = (options.method || 'GET').toUpperCase()
  const headers = normalizeRequestHeaders(options.headers)
  const timeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : 30000
  const maxRedirects = typeof options.maxRedirects === 'number' && options.maxRedirects >= 0 ? options.maxRedirects : 5
  const bodyBuffer = encodeBody(options.body, headers)

  if (bodyBuffer && !headers['content-length'] && !headers['Content-Length']) {
    headers['content-length'] = String(bodyBuffer.byteLength)
  }

  return new Promise<HttpBridgeResponse>((resolve, reject) => {
    const lib = target.protocol === 'https:' ? https : http
    const request = lib.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method,
        headers,
      },
      async(response) => {
        const status = response.statusCode ?? 0
        const location = response.headers.location

        if (location && REDIRECT_STATUS.has(status) && maxRedirects > 0) {
          response.resume()
          try {
            const nextUrl = new URL(location, target).toString()
            const shouldSwitchToGet = status === 303 || ((status === 301 || status === 302) && method !== 'GET' && method !== 'HEAD')
            const redirectedResponse = await performHttpRequest({
              ...options,
              url: nextUrl,
              method: shouldSwitchToGet ? 'GET' : method,
              body: shouldSwitchToGet ? undefined : options.body,
              maxRedirects: maxRedirects - 1,
            })
            resolve(redirectedResponse)
          } catch (error) {
            reject(error)
          }
          return
        }

        const chunks: Buffer[] = []
        response.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })
        response.on('end', () => {
          const rawBuffer = Buffer.concat(chunks)
          const decodedBuffer = decodeBody(rawBuffer, Array.isArray(response.headers['content-encoding'])
            ? response.headers['content-encoding'][0]
            : response.headers['content-encoding'])

          const setCookies = Array.isArray(response.headers['set-cookie'])
            ? response.headers['set-cookie']
            : response.headers['set-cookie'] ? [response.headers['set-cookie']] : []

          resolve({
            status,
            statusText: response.statusMessage || '',
            headers: normalizeResponseHeaders(response.headers),
            setCookies,
            bodyBuffer: decodedBuffer,
            bodyText: decodedBuffer.toString('utf8'),
          })
        })
        response.on('error', reject)
      }
    )

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Request timeout after ${timeoutMs}ms`))
    })
    request.on('error', reject)

    if (bodyBuffer) request.write(bodyBuffer)
    request.end()
  })
}
