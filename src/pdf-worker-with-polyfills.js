// Worker-side polyfills for Safari < 18.4 / iOS < 18.4.
// These run after the pdfjs import (ES module hoisting) but before any
// worker messages arrive, so they're in place when PDF.js uses them.

import 'pdfjs-dist/build/pdf.worker.min.mjs'

// URL.parse: Safari 18.0+
if (typeof URL.parse !== 'function') {
  URL.parse = function (url, base) {
    try { return new URL(url, base) } catch { return null }
  }
}

// Promise.try: Safari 18.4+
if (typeof Promise.try !== 'function') {
  Promise.try = function (fn, ...args) {
    return new Promise(function (resolve) { resolve(fn.apply(null, args)) })
  }
}
