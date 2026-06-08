export interface HttpRequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PROPFIND' | 'MKCOL' | 'HEAD' | string
  headers?: Record<string, string>
  body?: string
}

export interface HttpResponse {
  status: number
  headers: Record<string, string>
  bodyText: string
  bodyBase64?: string
}

const normalizeHeaders = (headers: Headers): Record<string, string> => {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    result[key] = value
  })
  return result
}

export const httpClient = {
  async request(options: HttpRequestOptions): Promise<HttpResponse> {
    const electronApi = typeof window !== 'undefined' ? (window.electronAPI as any) : undefined
    if (electronApi?.httpRequest) {
      return electronApi.httpRequest(options)
    }

    const response = await fetch(options.url, {
      method: options.method || 'GET',
      headers: options.headers,
      body: options.body,
    })

    return {
      status: response.status,
      headers: normalizeHeaders(response.headers),
      bodyText: await response.text(),
    }
  },

  async getJson<T = any>(url: string, headers?: Record<string, string>): Promise<T> {
    const response = await this.request({ url, method: 'GET', headers })
    return JSON.parse(response.bodyText) as T
  },

  async getText(url: string, headers?: Record<string, string>): Promise<string> {
    const response = await this.request({ url, method: 'GET', headers })
    return response.bodyText
  },

  async postJson<T = any>(url: string, body: any, headers?: Record<string, string>): Promise<T> {
    const response = await this.request({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(headers || {}),
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
    return JSON.parse(response.bodyText) as T
  },

  async postForm<T = any>(url: string, body: URLSearchParams | string, headers?: Record<string, string>): Promise<T> {
    const response = await this.request({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(headers || {}),
      },
      body: typeof body === 'string' ? body : body.toString(),
    })
    return JSON.parse(response.bodyText) as T
  },
}

export default httpClient
