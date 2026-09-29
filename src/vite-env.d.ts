/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PUBLIC_SITE_URL?: string;
  readonly VITE_PLATFORM_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
