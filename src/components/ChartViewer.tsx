import { useEffect, useRef, useState } from 'react'
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import type { Chart } from '../App'
import './ChartViewer.css'

const OSMD_OPTIONS = {
  autoResize: false,
  backend: 'svg',
  drawingParameters: 'default',
  drawCredits: true,
  drawPartNames: true,
  followCursor: false,
  disableCursor: true,
  newSystemFromXML: true,
  newPageFromXML: true,
} as const

function applyChordFixes(osmd: OpenSheetMusicDisplay): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rules = osmd.EngravingRules as any
  // OSMD hardcodes 6/9 as "69" in resetChordNames(); rename it.
  rules.renameChord?.('69', '6/9')
  // OSMD has no entry for major-seventh + altered b5, falling back to "(alt b5)".
  // "b5" must use ASCII "b" to match OSMD's internal accidental text (resetChordAccidentalTexts default).
  rules.addChordName?.('Maj7♭5', 'majorseventh', [], ['b5'], [])
}

function countXmlSystems(xml: string): number {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const breaks = doc.querySelectorAll('print[new-system="yes"], print[new-page="yes"]')
  return breaks.length + 1
}

function countRenderedSystems(osmd: OpenSheetMusicDisplay): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pages: { MusicSystems: unknown[] }[] = (osmd.GraphicSheet as any)?.MusicPages ?? []
  return pages.reduce((sum, page) => sum + page.MusicSystems.length, 0)
}

interface Props {
  chart: Chart
}

type Status = 'loading' | 'ready' | 'error'

export default function ChartViewer({ chart }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!containerRef.current) return
    setStatus('loading')
    setErrorMsg('')

    containerRef.current.innerHTML = ''
    osmdRef.current = new OpenSheetMusicDisplay(containerRef.current, OSMD_OPTIONS)
    applyChordFixes(osmdRef.current)

    osmdRef.current
      .load(chart.xmlContent)
      .then(() => {
        const container = containerRef.current!
        const osmd = osmdRef.current!
        const expectedSystems = countXmlSystems(chart.xmlContent)
        const MAX_WIDTH = 5000
        // 900px is the minimum width where staff notation stays readable.
        // On mobile the container is narrower, so we start here and let the
        // score scroll horizontally rather than shrink below legibility.
        const MIN_READABLE = 900

        // Start at the container's natural width (floored at MIN_READABLE) and
        // widen until OSMD's automatic line-breaking no longer adds systems
        // beyond what the XML specifies. This finds the smallest render width
        // that preserves the author's layout, minimising the CSS scale-down
        // and keeping notes as large as possible.
        let renderWidth = Math.max(container.offsetWidth, MIN_READABLE)
        while (true) {
          container.style.width = `${renderWidth}px`
          osmd.render()
          const actual = countRenderedSystems(osmd)
          if (actual <= expectedSystems || renderWidth >= MAX_WIDTH) break
          renderWidth = Math.min(Math.ceil(renderWidth * 1.3), MAX_WIDTH)
        }

        // Release the pinned width — CSS (svg { width: 100% }) scales the SVG
        // to fit the visible container while the viewBox preserves proportions.
        container.style.width = ''
        setStatus('ready')
      })
      .catch((err: unknown) => {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to parse MusicXML.')
        setStatus('error')
      })

    return () => {
      if (containerRef.current) containerRef.current.innerHTML = ''
      osmdRef.current = null
    }
  }, [chart])

  return (
    <div className="chart-viewer">
      {status === 'loading' && (
        <div className="chart-status">
          <div className="spinner" />
          <span>Rendering score…</span>
        </div>
      )}
      {status === 'error' && (
        <div className="chart-status error">
          <p>Could not render this file.</p>
          <p className="error-detail">{errorMsg}</p>
        </div>
      )}
      <div
        ref={containerRef}
        className="osmd-container"
        style={{ visibility: status === 'ready' ? 'visible' : 'hidden' }}
      />
    </div>
  )
}
