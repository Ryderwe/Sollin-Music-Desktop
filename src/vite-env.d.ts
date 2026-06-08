/// <reference types="vite/client" />

declare module 'node-forge' {
    namespace pki {
        function publicKeyFromPem(pem: string): {
            encrypt(data: string, scheme: string): string
        }
    }
    namespace util {
        function bytesToHex(bytes: string): string
    }
}

interface ImportMetaEnv {
  readonly DEV: boolean
  readonly PROD: boolean
  readonly MODE: string
  readonly VITE_APP_VERSION?: string
  readonly VITE_DEV_SERVER_PORT?: string
  readonly VITE_GITHUB_REPO?: string
  readonly VITE_GITHUB_ANNOUNCEMENT_REPO?: string
  readonly VITE_GITHUB_ANNOUNCEMENT_ISSUE_NUMBER?: string
  readonly VITE_GITHUB_ANNOUNCEMENT_AUTHOR?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
