import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.min.mjs'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import pdfWorkerUrl from '../pdf-worker-with-polyfills.js?worker&url'

// Bundled worker that includes polyfills for Safari < 18.4 (URL.parse, Promise.try).
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

  // Release canvas pixel buffers to free WebKit memory immediately rather than waiting for GC
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
      const contentW = (wrapperRef.current?.getBoundingClientRect().width ?? 32) - 32 || 800
      lastFitWidthRef.current = contentW
      const vp = page.getViewport({ scale: 1 })
      setScale(contentW / vp.width)
      setFitDone(true)
    })
  }, [pdfDoc, fitDone])

  // Re-fit to width when container resizes (fullscreen transitions, orientation change)
  useEffect(() => {
    if (!fitDone || !wrapperRef.current || !pdfDoc) return
    const el = wrapperRef.current

    function refit(newW: number) {
      if (newW > 0 && Math.abs(newW - lastFitWidthRef.current) > 4) {
        lastFitWidthRef.current = newW
        pdfDoc!.getPage(1).then(page => {
          setScale(newW / page.getViewport({ scale: 1 }).width)
        })
      }
    }

    // ResizeObserver handles fullscreen transitions and desktop window resize
    const resizeObserver = new ResizeObserver(entries => {
      refit(entries[0]?.contentRect.width ?? 0)
    })
    resizeObserver.observe(el)

    // window resize fires after iOS fully settles layout on orientation change,
    // which is more reliable than ResizeObserver for device rotation
    const onWindowResize = () => refit(el.getBoundingClientRect().width - 32)
    window.addEventListener('resize', onWindowResize)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', onWindowResize)
    }
  }, [fitDone, pdfDoc])

  // Lazy render: reserve layout space for all pages up front, then render each page
  // only when it scrolls into the viewport, and free its pixel buffer when it scrolls out.
  // This caps total canvas memory at ~2-3 visible pages regardless of PDF length,
  // preventing the OOM crash seen on iPad with multi-page PDFs.
  useEffect(() => {
    if (!pdfDoc || !fitDone || numPages === 0) return

    cancelActiveTasks()
    const cancelled = { value: false }
    let intersectionObserver: IntersectionObserver | null = null
    setLoading(true)

    async function renderPage(index: number) {
      if (cancelled.value) return
      const canvas = canvasesRef.current[index]
      if (!canvas) return
      try {
        const page = await pdfDoc!.getPage(index + 1)
        if (cancelled.value) return
        const viewport = page.getViewport({ scale })
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const task = page.render({ canvasContext: ctx, viewport, canvas })
        activeTasksRef.current.push(task)
        try {
          await task.promise
          if (!cancelled.value) canvas.style.visibility = 'visible'
        } finally {
          activeTasksRef.current = activeTasksRef.current.filter(t => t !== task)
        }
      } catch {
        // skip bad page
      }
    }

    function freePage(index: number) {
      const canvas = canvasesRef.current[index]
      if (canvas) {
        canvas.width = 1
        canvas.height = 1
        canvas.style.visibility = 'hidden'
      }
    }

    // Phase 1: load dimensions for all pages and set canvas CSS sizes so the
    // scroll container has the correct total height before any pixels are drawn.
    // Phase 2: start IntersectionObserver to draw pages as they enter the viewport.
    async function init() {
      for (let i = 0; i < numPages; i++) {
        if (cancelled.value) return
        const canvas = canvasesRef.current[i]
        if (!canvas) continue
        const page = await pdfDoc!.getPage(i + 1)
        if (cancelled.value) return
        const vp = page.getViewport({ scale })
        canvas.style.width = Math.floor(vp.width) + 'px'
        canvas.style.height = Math.floor(vp.height) + 'px'
        canvas.style.visibility = 'hidden'
        canvas.width = 1
        canvas.height = 1
      }
      if (cancelled.value) return

      setLoading(false)

      intersectionObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          const idx = parseInt((entry.target as HTMLElement).dataset.pageIdx ?? '-1')
          if (idx < 0) return
          if (entry.isIntersecting) renderPage(idx)
          else freePage(idx)
        })
      }, { rootMargin: '200px 0px' })

      canvasesRef.current.forEach((canvas, i) => {
        if (canvas) {
          canvas.dataset.pageIdx = String(i)
          intersectionObserver!.observe(canvas)
        }
      })
    }

    init()

    return () => {
      cancelled.value = true
      intersectionObserver?.disconnect()
      cancelActiveTasks()
    }
  }, [pdfDoc, scale, numPages, fitDone]) // eslint-disable-line react-hooks/exhaustive-deps

  const fitToWidth = useCallback(() => {
    if (!pdfDoc || !wrapperRef.current) return
    pdfDoc.getPage(1).then(page => {
      const contentW = wrapperRef.current!.getBoundingClientRect().width - 32 || 800
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
      const contentW = rect.width - 32 || 800
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
          />
        ))}
      </div>
    </div>
  )
}
