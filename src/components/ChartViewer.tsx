import { useEffect, useRef, useState } from 'react'
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import type { Chart } from '../App'
import { transposeXml, getKeyFifths } from '../utils/transposeXml'
import TransposeControl from './TransposeControl'
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
  rules.renameChord?.('69', '6/9')
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
  const [transpose, setTranspose] = useState(0)

  const originalFifths = getKeyFifths(chart.xmlContent)

  // Reset transpose when chart changes
  useEffect(() => {
    setTranspose(0)
  }, [chart])

  useEffect(() => {
    if (!containerRef.current) return
    setStatus('loading')
    setErrorMsg('')

    const xml = transposeXml(chart.xmlContent, transpose)

    containerRef.current.innerHTML = ''
    const osmd = new OpenSheetMusicDisplay(containerRef.current, OSMD_OPTIONS)
    osmdRef.current = osmd
    applyChordFixes(osmd)

    osmd
      .load(xml)
      .then(() => {
        if (osmdRef.current !== osmd) return

        const container = containerRef.current!
        const expectedSystems = countXmlSystems(xml)
        const MAX_WIDTH = 5000
        const MIN_READABLE = 900

        let renderWidth = Math.max(container.offsetWidth, MIN_READABLE)
        while (true) {
          container.style.width = `${renderWidth}px`
          osmd.render()
          const actual = countRenderedSystems(osmd)
          if (actual <= expectedSystems || renderWidth >= MAX_WIDTH) break
          renderWidth = Math.min(Math.ceil(renderWidth * 1.3), MAX_WIDTH)
        }

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
  }, [chart, transpose])

  return (
    <div className="chart-viewer">
      {status === 'ready' && (
        <TransposeControl
          originalFifths={originalFifths}
          transpose={transpose}
          onChange={setTranspose}
        />
      )}
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
