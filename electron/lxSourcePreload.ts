import { contextBridge, ipcRenderer, webFrame } from 'electron'
import zlib from 'zlib'
import { createCipheriv, publicEncrypt, constants, randomBytes, createHash } from 'crypto'
import { performHttpRequest } from './httpRequest'
import {
  LX_SOURCE_INTERNAL_IPC,
  type LxSourceRequestPayload,
  type LxSourceRuntimeInitPayload,
  type LxSourceRuntimeResponse,
} from './lxSourceShared'

type RequestHandler = ((payload: LxSourceRequestPayload) => Promise<unknown> | unknown) | null

let requestHandler: RequestHandler = null
let initReported = false
let lxExposed = false
let initErrorHandlerExposed = false

const EVENT_NAMES = {
  request: 'request',
  inited: 'inited',
  updateAlert: 'updateAlert',
} as const

const sanitizeErrorMessage = (error: unknown) => {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  return String(error)
}

const parseResponseBody = (bodyText: string) => {
  try {
    return JSON.parse(bodyText)
  } catch {
    return bodyText
  }
}

const reportInitResult = (ok: boolean, data?: unknown, error?: string) => {
  if (initReported) return
  initReported = true
  ipcRenderer.send(LX_SOURCE_INTERNAL_IPC.initResult, {
    ok,
    data,
    error,
  })
}

const exposeInitErrorHandler = () => {
  if (initErrorHandlerExposed) return
  initErrorHandlerExposed = true
  contextBridge.exposeInMainWorld('__lx_init_error_handler__', {
    sendError(message: string) {
      reportInitResult(false, undefined, message)
    },
  })
}

const installGlobalErrorHandler = () => {
  exposeInitErrorHandler()
  void webFrame.executeJavaScript(`(() => {
    window.addEventListener('error', (event) => {
      if (!event.isTrusted) return
      const message = String(event.message || '').replace(/^Uncaught\\sError:\\s/, '')
      globalThis.__lx_init_error_handler__?.sendError(message)
    })
    window.addEventListener('unhandledrejection', (event) => {
      if (!event.isTrusted) return
      const reason = event.reason
      const message = typeof reason === 'string' ? reason : (reason?.message ?? String(reason))
      globalThis.__lx_init_error_handler__?.sendError(String(message).replace(/^Error:\\s/, ''))
    })
  })()`).catch(() => undefined)
}

const normalizeMusicUrlResult = (response: unknown, payload: LxSourceRequestPayload) => {
  if (typeof response === 'string' && /^https?:/i.test(response)) {
    return {
      source: payload.source,
      action: payload.action,
      data: {
        type: payload.info.type,
        url: response,
      },
    }
  }

  if (response && typeof response === 'object') {
    const url = typeof (response as { url?: unknown }).url === 'string' ? (response as { url: string }).url : ''
    const type = typeof (response as { type?: unknown }).type === 'string' ? (response as { type: string }).type : payload.info.type
    if (url && /^https?:/i.test(url)) {
      return {
        source: payload.source,
        action: payload.action,
        data: {
          type,
          url,
        },
      }
    }
  }

  throw new Error('failed')
}

const handleRuntimeRequest = async(payload: { requestKey: string; data: LxSourceRequestPayload }) => {
  const response: LxSourceRuntimeResponse = {
    requestKey: payload.requestKey,
    ok: false,
  }

  if (!requestHandler) {
    response.error = 'Request event is not defined'
    ipcRenderer.send(LX_SOURCE_INTERNAL_IPC.response, response)
    return
  }

  try {
    const result = await requestHandler(payload.data)
    response.ok = true
    response.result = normalizeMusicUrlResult(result, payload.data)
  } catch (error) {
    response.error = sanitizeErrorMessage(error)
  }

  ipcRenderer.send(LX_SOURCE_INTERNAL_IPC.response, response)
}

const exposeLx = (payload: LxSourceRuntimeInitPayload) => {
  if (lxExposed) return
  lxExposed = true

  contextBridge.exposeInMainWorld('lx', {
    EVENT_NAMES,
    request(url: string, options: any = {}, callback: (err: Error | null, resp: any, body: any) => void) {
      const headers = { ...(options?.headers || {}) } as Record<string, string>
      let body = options?.body

      if (options?.form && !headers['content-type'] && !headers['Content-Type']) {
        headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8'
        body = options.form
      } else if (options?.formData && body == null) {
        body = options.formData
      }

      let cancelled = false

      void performHttpRequest({
        url,
        method: options?.method,
        headers,
        body,
        timeoutMs: typeof options?.timeout === 'number' ? options.timeout : 20000,
        maxRedirects: typeof options?.follow_max === 'number' ? options.follow_max : 5,
      }).then((response) => {
        if (cancelled) return
        const parsedBody = parseResponseBody(response.bodyText)
        callback.call(this, null, {
          statusCode: response.status,
          statusMessage: response.statusText,
          headers: response.headers,
          bytes: response.bodyBuffer.byteLength,
          raw: response.bodyBuffer,
          body: parsedBody,
        }, parsedBody)
      }).catch((error) => {
        if (cancelled) return
        callback.call(this, error instanceof Error ? error : new Error(sanitizeErrorMessage(error)), null, null)
      })

      return () => {
        cancelled = true
      }
    },
    send(eventName: string, data: unknown) {
      return new Promise<void>((resolve, reject) => {
        switch (eventName) {
          case EVENT_NAMES.inited:
            if (initReported) {
              reject(new Error('Script is inited'))
              return
            }
            reportInitResult(true, data)
            resolve()
            return
          case EVENT_NAMES.updateAlert:
            ipcRenderer.send(LX_SOURCE_INTERNAL_IPC.updateAlert, data)
            resolve()
            return
          default:
            reject(new Error(`Unsupported event: ${eventName}`))
        }
      })
    },
    on(eventName: string, handler: RequestHandler) {
      if (eventName !== EVENT_NAMES.request) return Promise.reject(new Error(`Unsupported event: ${eventName}`))
      requestHandler = handler
      return Promise.resolve()
    },
    utils: {
      crypto: {
        aesEncrypt(buffer: Buffer, mode: string, key: Buffer | string, iv: Buffer | string) {
          const cipher = createCipheriv(mode, key, iv)
          return Buffer.concat([cipher.update(buffer), cipher.final()])
        },
        rsaEncrypt(buffer: Buffer, key: string) {
          const padded = Buffer.concat([Buffer.alloc(Math.max(0, 128 - buffer.length)), buffer])
          return publicEncrypt({ key, padding: constants.RSA_NO_PADDING }, padded)
        },
        randomBytes(size: number) {
          return randomBytes(size)
        },
        md5(value: string) {
          return createHash('md5').update(value).digest('hex')
        },
      },
      buffer: {
        from(value: any, encodingOrOffset?: any, length?: any) {
          return Buffer.from(value, encodingOrOffset, length)
        },
        bufToString(buf: Buffer | Uint8Array | string, format?: BufferEncoding) {
          return Buffer.from(buf as any).toString(format)
        },
      },
      zlib: {
        inflate(buf: Buffer) {
          return new Promise<Buffer>((resolve, reject) => {
            zlib.inflate(buf, (error, data) => {
              if (error) reject(new Error(error.message))
              else resolve(data)
            })
          })
        },
        deflate(data: Buffer | string) {
          return new Promise<Buffer>((resolve, reject) => {
            zlib.deflate(data, (error, buffer) => {
              if (error) reject(new Error(error.message))
              else resolve(buffer)
            })
          })
        },
      },
    },
    currentScriptInfo: {
      ...payload.scriptInfo,
      rawScript: payload.script,
    },
    version: '2.0.0',
    env: 'desktop',
  })
}

const initializeRuntime = async(payload: LxSourceRuntimeInitPayload) => {
  requestHandler = null
  initReported = false

  installGlobalErrorHandler()
  exposeLx(payload)

  try {
    await webFrame.executeJavaScript(payload.script)
  } catch (error) {
    reportInitResult(false, undefined, sanitizeErrorMessage(error))
  }
}

ipcRenderer.on(LX_SOURCE_INTERNAL_IPC.initEnv, (_event, payload: LxSourceRuntimeInitPayload) => {
  void initializeRuntime(payload)
})

ipcRenderer.on(LX_SOURCE_INTERNAL_IPC.request, (_event, payload: { requestKey: string; data: LxSourceRequestPayload }) => {
  void handleRuntimeRequest(payload)
})

ipcRenderer.send(LX_SOURCE_INTERNAL_IPC.runtimeReady)
