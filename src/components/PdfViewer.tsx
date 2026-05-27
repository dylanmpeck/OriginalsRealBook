import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// Vite copies the worker file to the build output via the ?url import above.
// This avoids CDN dependencies and works in both dev and prod.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const ZOOM_STEP = 0.15
const ZOOM_MIN = 0.25
const ZOOM_MAX = 3.0

// Returns the nearest scrollable ancestor and its scroll offset.
// In normal mode this is window; in simulated fullscreen it's the chart-viewer div.
// Only counts an element as the scroll container if it actually constrains height
// (scrollHeight > clientHeight). Elements that grow to fit their content have equal
// scrollHeight and clientHeight and are skipped so we fall through to window.
function getScrollContainer(el: HTMLElement): { scrollTop: number; height: number } {
  let parent = el.parentElement
  while (parent && parent !== document.documentElement) {
    const { overflowY } = getComputedStyle(parent)
    if (overflowY === 'auto' || overflowY === 'scroll') {
      if (parent.scrollHeight > parent.clientHeight) {
        return { scrollTop: parent.scrollTop, height: parent.clientHeight }
      }
    }
    parent = parent.parentElement
  }
  return { scrollTop: window.scrollY, height: window.innerHeight }
}

interface Props {
  url: string
}

export default function PdfViewer({ url }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasesRef = useRef<(HTMLCanvasElement | null)[]>([])
  const activeTasksRef = useRef<{ cancel(): void }[]>([])
  const lastFitWidthRef = useRef(0)

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [scale, setScale] = useState(1)
  const [fitDone, setFitDone] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  function cancelActiveTasks() {
    activeTasksRef.current.forEach(t => { try { t.cancel() } catch { /* already done */ } })
    activeTasksRef.current = []
  }

  // Release canvas pixel buffers (frees WebKit memory immediately rather than waiting for GC)
  function freeCanvases() {
    canvasesRef.current.forEach(c => { if (c) { c.width = 1; c.height = 1 } })
  }

  // Load PDF when URL changes
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setPdfDoc(null)
    setNumPages(0)
    setFitDone(false)
    cancelActiveTasks()
    freeCanvases()
    canvasesRef.current = []

    const task = pdfjsLib.getDocument({ url })
    task.promise
      .then(doc => {
        if (cancelled) return
        setPdfDoc(doc)
        setNumPages(doc.numPages)
      })
      .catch(err => {
        if (cancelled) return
        setError((err as Error).message ?? 'Failed to load PDF')
        setLoading(false)
      })
    return () => {
      cancelled = true
      task.destroy()
    }
  }, [url])

  // Free canvas memory on unmount
  useEffect(() => {
    return () => {
      cancelActiveTasks()
      freeCanvases()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto fit-to-width on first load
  useEffect(() => {
    if (!pdfDoc || fitDone) return
    pdfDoc.getPage(1).then(page => {
      const contentW = (wrapperRef.current?.clientWidth ?? 0) - 32 || 800
      lastFitWidthRef.current = contentW
      const vp = page.getViewport({ scale: 1 })
      setScale(contentW / vp.width)
      setFitDone(true)
    })
  }, [pdfDoc, fitDone])

  // Re-fit to width when the container resizes (e.g. entering/exiting fullscreen)
  useEffect(() => {
    if (!fitDone || !wrapperRef.current || !pdfDoc) return
    const el = wrapperRef.current
    const observer = new ResizeObserver(entries => {
      const newW = entries[0]?.contentRect.width ?? 0
      if (newW > 0 && Math.abs(newW - lastFitWidthRef.current) > 4) {
        lastFitWidthRef.current = newW
        pdfDoc.getPage(1).then(page => {
          setScale(newW / page.getViewport({ scale: 1 }).width)
        })
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [fitDone, pdfDoc])

  // Render all pages whenever scale or doc changes
  useEffect(() => {
    if (!pdfDoc || !fitDone || numPages === 0) return

    cancelActiveTasks()
    const cancelled = { value: false }
    setLoading(true)

    async function renderAll() {
      for (let i = 0; i < numPages; i++) {
        if (cancelled.value) return
        const canvas = canvasesRef.current[i]
        if (!canvas) continue

        try {
          const page = await pdfDoc!.getPage(i + 1)
          if (cancelled.value) return

          const viewport = page.getViewport({ scale })
          const cssW = Math.floor(viewport.width)
          const cssH = Math.floor(viewport.height)
          // Set explicit CSS size so zoom changes are always visually reflected.
          // Rendering at CSS scale (not DPR) keeps canvas buffers small enough for iPad.
          canvas.width = cssW
          canvas.height = cssH
          canvas.style.width = cssW + 'px'
          canvas.style.height = cssH + 'px'

          const ctx = canvas.getContext('2d')
          if (!ctx) continue

          const task = page.render({ canvasContext: ctx, viewport, canvas })
          activeTasksRef.current.push(task)
          try {
            await task.promise
          } finally {
            activeTasksRef.current = activeTasksRef.current.filter(t => t !== task)
          }
        } catch {
          if (cancelled.value) return
          // skip bad page, continue with the rest
        }
      }
      if (!cancelled.value) setLoading(false)
    }

    renderAll()
    return () => {
      cancelled.value = true
      cancelActiveTasks()
    }
  }, [pdfDoc, scale, numPages, fitDone]) // eslint-disable-line react-hooks/exhaustive-deps

  const fitToWidth = useCallback(() => {
    if (!pdfDoc || !wrapperRef.current) return
    pdfDoc.getPage(1).then(page => {
      const contentW = (wrapperRef.current!.clientWidth - 32) || 800
      setScale(contentW / page.getViewport({ scale: 1 }).width)
    })
  }, [pdfDoc])

  const fitToPage = useCallback(() => {
    if (!pdfDoc || !wrapperRef.current) return
    pdfDoc.getPage(1).then(page => {
      const { scrollTop, height: containerH } = getScrollContainer(wrapperRef.current!)
      const rect = wrapperRef.current!.getBoundingClientRect()
      const wrapperTopInContainer = rect.top + scrollTop
      const availH = containerH - wrapperTopInContainer
      const vp = page.getViewport({ scale: 1 })
      const contentW = (wrapperRef.current!.clientWidth - 32) || 800
      const fitW = contentW / vp.width
      const fitH = availH / vp.height
      setScale(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min(fitW, fitH))))
    })
  }, [pdfDoc])

  if (error) {
    return (
      <div className="chart-status error">
        <p>Could not load PDF.</p>
        <p className="error-detail">{error}</p>
      </div>
    )
  }

  return (
    <div className="pdf-js-viewer">
      <div className="zoom-controls">
        <button className="zoom-step" onClick={() => setScale(s => Math.max(ZOOM_MIN, parseFloat((s - ZOOM_STEP).toFixed(2))))} disabled={scale <= ZOOM_MIN} aria-label="Zoom out">−</button>
        <span className="zoom-pct">{Math.round(scale * 100)}%</span>
        <button className="zoom-step" onClick={() => setScale(s => Math.min(ZOOM_MAX, parseFloat((s + ZOOM_STEP).toFixed(2))))} disabled={scale >= ZOOM_MAX} aria-label="Zoom in">+</button>
        <div className="zoom-divider" />
        <button className="zoom-btn" onClick={fitToWidth}>Fit Width</button>
        <button className="zoom-btn" onClick={fitToPage} disabled={!fitDone}>Fit Page</button>
      </div>

      <div ref={wrapperRef} className="pdf-js-pages">
        {loading && (
          <div className="pdf-js-loading">
            <div className="spinner" />
            <span>Rendering PDF…</span>
          </div>
        )}
        {Array.from({ length: numPages }, (_, i) => (
          <canvas
            key={i}
            ref={el => { canvasesRef.current[i] = el }}
            className="pdf-js-page"
            style={{ visibility: loading ? 'hidden' : 'visible' }}
          />
        ))}
      </div>
    </div>
  )
}
