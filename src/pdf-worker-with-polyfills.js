// The legacy build bundles core-js polyfills for APIs missing in Safari/iOS < 18.x:
// URL.parse (18.0+), Promise.try (18.4+), Uint8Array.prototype.toHex (18.2+),
// Promise.withResolvers (17.4+), and others. This is the worker entry point bundled
// by Vite via ?worker&url so bare specifiers resolve correctly in production.
import 'pdfjs-dist/legacy/build/pdf.worker.min.mjs'
