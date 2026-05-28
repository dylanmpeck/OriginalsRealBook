import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// URL.parse: Safari 18.0+ / iOS 18.0+. pdfjs-dist v5 calls it on the main thread.
if (typeof (URL as unknown as { parse?: unknown }).parse !== 'function') {
  Object.assign(URL, {
    parse: (url: string | URL, base?: string | URL) => {
      try { return new URL(url, base) } catch { return null }
    },
  })
}

// Promise.try: Safari 18.4+ / iOS 18.4+. pdfjs-dist v5 calls it on the main thread.
if (typeof (Promise as unknown as { try?: unknown }).try !== 'function') {
  Object.assign(Promise, {
    try: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
      new Promise(resolve => { resolve(fn(...args)) }),
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
