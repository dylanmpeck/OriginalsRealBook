import { useEffect, useMemo, useRef, useState } from 'react'
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { transposeXml, getKeyFifths } from '../utils/transposeXml'
import { getChartXml, getChartFileUrl, type ChartDoc, type ChartKey, type FormatType } from '../lib/charts'
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

function patchXmlTitle(xml: string, title: string): string {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const workTitle = doc.querySelector('work-title')
  if (workTitle) workTitle.textContent = title
  const movTitle = doc.querySelector('movement-title')
  if (movTitle) movTitle.textContent = title
  return new XMLSerializer().serializeToString(doc)
}

function formatLabel(type: FormatType): string {
  return type === 'musicxml' ? 'MusicXML' : type === 'pdf' ? 'PDF' : 'Image'
}

function keyLabel(key: ChartKey): string {
  return key.replace('b', '♭')
}

interface Props {
  chart: ChartDoc
}

type Status = 'loading' | 'ready' | 'error'

export default function ChartViewer({ chart }: Props) {
  const availableTypes = useMemo(() => {
    const seen = new Set<FormatType>()
    const types: FormatType[] = []
    for (const f of chart.formats) {
      if (!seen.has(f.type)) { seen.add(f.type); types.push(f.type) }
    }
    return types
  }, [chart.formats])

  const defaultType: FormatType = availableTypes.includes('musicxml') ? 'musicxml' : availableTypes[0]
  const [selectedType, setSelectedType] = useState<FormatType>(defaultType)
  const [selectedKey, setSelectedKey] = useState<ChartKey>('C')

  const formatsOfType = useMemo(
    () => chart.formats.filter(f => f.type === selectedType),
    [chart.formats, selectedType]
  )

  // When the selected type changes, snap to the first available key for that type
  useEffect(() => {
    const firstKey = (formatsOfType[0]?.key as ChartKey | undefined) ?? 'C'
    setSelectedKey(firstKey)
  }, [selectedType]) // eslint-disable-line react-hooks/exhaustive-deps

  const activeFormat = useMemo(() => {
    if (formatsOfType.length === 0) return null
    if (selectedType === 'musicxml') return formatsOfType[0]
    return formatsOfType.find(f => (f.key ?? 'C') === selectedKey) ?? formatsOfType[0]
  }, [formatsOfType, selectedType, selectedKey])

  const [xmlContent, setXmlContent] = useState<string | null>(null)
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [transpose, setTranspose] = useState(0)

  const containerRef = useRef<HTMLDivElement>(null)
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null)

  const isXml = selectedType === 'musicxml'

  // Load file content when the active format changes
  useEffect(() => {
    if (!activeFormat) return
    setStatus('loading')
    setXmlContent(null)
    setFileUrl(null)
    setTranspose(0)

    if (activeFormat.type === 'musicxml') {
      getChartXml(activeFormat.storagePath)
        .then(text => setXmlContent(text))
        .catch(err => {
          setErrorMsg(err instanceof Error ? err.message : 'Failed to load file.')
          setStatus('error')
        })
    } else {
      getChartFileUrl(activeFormat.storagePath)
        .then(url => {
          setFileUrl(url)
          setStatus('ready')
        })
        .catch(err => {
          setErrorMsg(err instanceof Error ? err.message : 'Failed to load file.')
          setStatus('error')
        })
    }
  }, [activeFormat])

  // Render OSMD when XML content or transpose changes
  useEffect(() => {
    if (!xmlContent || !containerRef.current) return
    setStatus('loading')
    setErrorMsg('')

    const xml = transposeXml(patchXmlTitle(xmlContent, chart.title), transpose)
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
  }, [xmlContent, transpose]) // eslint-disable-line react-hooks/exhaustive-deps

  const originalFifths = xmlContent ? getKeyFifths(xmlContent) : 0
  const keysForType = formatsOfType.map(f => (f.key ?? 'C') as ChartKey)

  return (
    <div className="chart-viewer">
      {availableTypes.length > 1 && (
        <div className="format-tabs">
          {availableTypes.map(type => (
            <button
              key={type}
              className={`format-tab${selectedType === type ? ' active' : ''}`}
              onClick={() => setSelectedType(type)}
            >
              {formatLabel(type)}
            </button>
          ))}
        </div>
      )}

      {isXml ? (
        <div className="xml-tools">
          <TransposeControl
            originalFifths={originalFifths}
            transpose={transpose}
            onChange={setTranspose}
          />
        </div>
      ) : (
        <div className="media-tools">
          <span className="media-tools-label">Key</span>
          <div className="key-toggle">
            {keysForType.map(k => (
              <button
                key={k}
                className={`key-btn${selectedKey === k ? ' active' : ''}`}
                onClick={() => setSelectedKey(k)}
              >
                {keyLabel(k)}
              </button>
            ))}
          </div>
        </div>
      )}

      {status === 'loading' && (
        <div className="chart-status">
          <div className="spinner" />
          <span>Loading…</span>
        </div>
      )}

      {status === 'error' && (
        <div className="chart-status error">
          <p>Could not load this file.</p>
          <p className="error-detail">{errorMsg}</p>
        </div>
      )}

      {selectedType === 'pdf' && fileUrl && status === 'ready' && (
        <iframe className="pdf-viewer" src={fileUrl} title="PDF chart" />
      )}

      {selectedType === 'image' && fileUrl && status === 'ready' && (
        <div className="image-viewer">
          <img src={fileUrl} alt="Chart" />
        </div>
      )}

      {/* Always mounted so the ref is stable for OSMD; visibility:hidden preserves
          layout dimensions (offsetWidth) that OSMD needs during render */}
      <div
        ref={containerRef}
        className="osmd-container"
        style={isXml
          ? { visibility: status === 'ready' ? 'visible' : 'hidden' }
          : { display: 'none' }
        }
      />
    </div>
  )
}
