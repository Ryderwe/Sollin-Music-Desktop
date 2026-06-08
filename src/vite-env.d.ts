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
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
