import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// URL.parse() was added in Safari 18 / iOS 18. pdfjs-dist v5 calls it on the
// main thread. Polyfill it for older iPads so the PDF viewer doesn't crash.
if (typeof (URL as unknown as { parse?: unknown }).parse !== 'function') {
  Object.assign(URL, {
    parse: (url: string | URL, base?: string | URL) => {
      try { return new URL(url, base) } catch { return null }
    },
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
