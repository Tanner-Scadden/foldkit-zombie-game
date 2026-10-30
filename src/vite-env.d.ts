/// <reference types="vite/client" />

declare const __BUILD_ID__: string

interface ImportMetaEnv {
  readonly VITE_API_ORIGIN?: string
}

declare module 'virtual:sprite-atlas' {
  const atlas: import('./spriteAtlas').SpriteAtlas
  export default atlas
}
