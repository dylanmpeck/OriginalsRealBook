/// <reference types="vite/client" />

// The legacy build re-exports the same API as pdfjs-dist but bundles core-js polyfills.
declare module 'pdfjs-dist/legacy/build/pdf.min.mjs' {
  export * from 'pdfjs-dist'
}
