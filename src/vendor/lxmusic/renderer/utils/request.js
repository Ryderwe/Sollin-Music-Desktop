import { Buffer } from 'buffer'

const buildHeadersObject = (headers) => {
  const result = {}
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value
  })
  return result
}

const buildBody = (options) => {
  if (options.formData) return options.formData
  if (options.form) return new URLSearchParams(options.form)
  if (options.body == null) return undefined
  if (typeof options.body === 'string' || options.body instanceof Blob || options.body instanceof FormData || options.body instanceof URLSearchParams) {
    return options.body
  }
  return JSON.stringify(options.body)
}

const normalizeHeaders = (options) => {
  const headers = new Headers(options.headers || {})
  if (options.form && !headers.has('content-type')) {
    headers.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8')
  } else if (options.body && typeof options.body === 'object' && !(options.body instanceof Blob) && !(options.body instanceof FormData) && !(options.body instanceof URLSearchParams) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json;charset=UTF-8')
  }
  if (!headers.has('accept')) {
    headers.set('accept', 'application/json, text/plain, */*')
  }
  if (!headers.has('user-agent')) {
    headers.set('user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')
  }
  return headers
}

const parseBufferBody = (buffer) => {
  const raw = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '')
  const text = raw.toString('utf8')
  try {
    return { raw, body: JSON.parse(text) }
  } catch {
    return { raw, body: text }
  }
}

const parseTextBody = (text) => parseBufferBody(Buffer.from(text || '', 'utf8'))

const parseBody = async(response) => {
  const buffer = Buffer.from(await response.arrayBuffer())
  return parseBufferBody(buffer)
}

const parseElectronBody = (response) => {
  if (typeof response?.bodyBase64 === 'string' && response.bodyBase64) {
    return parseBufferBody(Buffer.from(response.bodyBase64, 'base64'))
  }
  return parseTextBody(response?.bodyText || '')
}

export const httpFetch = (url, options = { method: 'get' }) => {
  const controller = new AbortController()
  const timeout = typeof options.timeout === 'number' && options.timeout > 0 ? options.timeout : 20000
  let timer = null

  const promise = new Promise((resolve, reject) => {
    timer = setTimeout(() => controller.abort(new Error('timeout')), timeout)

    const electronHttp = globalThis.window?.electronAPI?.httpRequest
    const requestMethod = (options.method || 'get').toUpperCase()
    const requestHeaders = Object.fromEntries(normalizeHeaders(options).entries())
    const requestBody = (() => {
      if (options.form) return Object.fromEntries(new URLSearchParams(options.form).entries())
      if (typeof options.body === 'string') return options.body
      if (options.body == null) return undefined
      if (options.body instanceof URLSearchParams) return Object.fromEntries(options.body.entries())
      return options.body
    })()

    const handleSuccess = (statusCode, statusMessage, headers, raw, body) => {
      resolve({
        statusCode,
        statusMessage,
        headers,
        bytes: raw.byteLength,
        raw,
        body,
      })
    }

    const requestPromise = typeof electronHttp === 'function'
      ? electronHttp({
        url,
        method: requestMethod,
        headers: requestHeaders,
        body: requestBody,
      }).then((response) => {
        const { raw, body } = parseElectronBody(response)
        handleSuccess(response?.status || 0, '', response?.headers || {}, raw, body)
      })
      : fetch(url, {
        method: requestMethod,
        headers: requestHeaders,
        body: buildBody(options),
        signal: controller.signal,
        redirect: options.follow_max && options.follow_max > 0 ? 'follow' : 'manual',
        credentials: options.credentials || 'omit',
      }).then(async(response) => {
        const { raw, body } = await parseBody(response)
        handleSuccess(response.status, response.statusText, buildHeadersObject(response.headers), raw, body)
      })

    requestPromise.catch((error) => {
      if (error?.name === 'AbortError') {
        const abortError = new Error('cancel request')
        abortError.code = 'ABORT_ERR'
        reject(abortError)
        return
      }
      reject(error)
    }).finally(() => {
      if (timer) clearTimeout(timer)
    })
  })

  return {
    promise,
    cancelHttp() {
      controller.abort()
    },
  }
}

export const cancelHttp = (requestObj) => {
  if (requestObj?.cancelHttp) requestObj.cancelHttp()
}
