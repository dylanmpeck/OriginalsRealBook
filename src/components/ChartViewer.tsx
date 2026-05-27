import { useEffect, useMemo, useRef, useState } from 'react'
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { transposeXml, getKeyFifths } from '../utils/transposeXml'
import { getChartXml, getChartFileUrl, type ChartDoc, type ChartKey, type FormatType } from '../lib/charts'
import TransposeControl from './TransposeControl'
import './ChartViewer.css'

const OSMD_OPTIONS = {
  autoResize: false,
  backend: 'svg',
  darkMode: false,
  defaultColorMusic: '#000000',
  pageBackgroundColor: '#FFFFFF',
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
  const availableParts = useMemo(() => {
    const seen = new Set<string>()
    const parts: string[] = []
    for (const f of chart.formats) {
      if (!seen.has(f.part)) { seen.add(f.part); parts.push(f.part) }
    }
    return parts
  }, [chart.formats])

  const [selectedPart, setSelectedPart] = useState<string>(availableParts[0] ?? 'Lead Sheet')

  const formatsForPart = useMemo(
    () => chart.formats.filter(f => f.part === selectedPart),
    [chart.formats, selectedPart]
  )

  const availableTypes = useMemo(() => {
    const seen = new Set<FormatType>()
    const types: FormatType[] = []
    for (const f of formatsForPart) {
      if (!seen.has(f.type)) { seen.add(f.type); types.push(f.type) }
    }
    return types
  }, [formatsForPart])

  const defaultType: FormatType = availableTypes.includes('musicxml') ? 'musicxml' : availableTypes[0]
  const [selectedType, setSelectedType] = useState<FormatType>(defaultType)
  const [selectedKey, setSelectedKey] = useState<ChartKey>('C')

  // When selected part changes, reset type to first available for that part
  useEffect(() => {
    const firstType = availableTypes.includes('musicxml') ? 'musicxml' : availableTypes[0]
    if (firstType) setSelectedType(firstType)
  }, [selectedPart]) // eslint-disable-line react-hooks/exhaustive-deps

  const formatsOfType = useMemo(
    () => formatsForPart.filter(f => f.type === selectedType),
    [formatsForPart, selectedType]
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
  const [userZoom, setUserZoom] = useState(1)

  const viewerRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [toolbarVisible, setToolbarVisible] = useState(true)

  const supportsNativeFullscreen = !!document.fullscreenEnabled

  useEffect(() => {
    if (!supportsNativeFullscreen) return
    const onChange = () => {
      const fs = !!document.fullscreenElement
      setIsFullscreen(fs)
      if (!fs) setToolbarVisible(true)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Lock body scroll when using simulated fullscreen on mobile
  useEffect(() => {
    if (!supportsNativeFullscreen && isFullscreen) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [isFullscreen, supportsNativeFullscreen])

  function toggleFullscreen() {
    if (!viewerRef.current) return
    if (supportsNativeFullscreen) {
      if (document.fullscreenElement) {
        document.exitFullscreen()
      } else {
        viewerRef.current.requestFullscreen()
      }
    } else {
      setIsFullscreen(prev => {
        if (prev) setToolbarVisible(true)
        return !prev
      })
    }
  }

  const ZOOM_STEP = 0.1
  const ZOOM_MIN = 0.25
  const ZOOM_MAX = 2.5

  function zoomIn() { setUserZoom(z => Math.min(ZOOM_MAX, parseFloat((z + ZOOM_STEP).toFixed(2)))) }
  function zoomOut() { setUserZoom(z => Math.max(ZOOM_MIN, parseFloat((z - ZOOM_STEP).toFixed(2)))) }
  function fitWidth() { setUserZoom(1) }
  function fitToPage() {
    if (!containerRef.current) return
    const svg = containerRef.current.querySelector('svg')
    if (!svg) return
    const svgRect = svg.getBoundingClientRect()
    if (svgRect.height <= 0) return
    const naturalH = svgRect.height / userZoom
    // Available height = from the SVG's current top edge to the bottom of the viewport
    const availableH = window.innerHeight - svgRect.top
    const newZoom = Math.min(1, availableH / naturalH)
    setUserZoom(Math.max(ZOOM_MIN, parseFloat(newZoom.toFixed(2))))
  }

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

        // Stamp inline color-scheme on every rendered SVG so Chrome's
        // #enable-force-dark flag cannot override it (inline > author CSS > UA).
        container.querySelectorAll('svg').forEach(svg => {
          svg.style.colorScheme = 'only light'
          svg.style.backgroundColor = '#ffffff'
        })

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

  const fullscreenBtn = (
    <button
      className="btn-fullscreen"
      onClick={toggleFullscreen}
      title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
    >
      {isFullscreen ? (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 14 10 14 10 20"/>
          <polyline points="20 10 14 10 14 4"/>
          <line x1="10" y1="14" x2="3" y2="21"/>
          <line x1="21" y1="3" x2="14" y2="10"/>
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 3 21 3 21 9"/>
          <polyline points="9 21 3 21 3 15"/>
          <line x1="21" y1="3" x2="14" y2="10"/>
          <line x1="3" y1="21" x2="10" y2="14"/>
        </svg>
      )}
    </button>
  )

  const hideToolbarBtn = isFullscreen ? (
    <button
      className="btn-hide-toolbar"
      onClick={() => setToolbarVisible(false)}
      title="Hide controls"
      aria-label="Hide controls"
    >
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="18 15 12 9 6 15"/>
      </svg>
    </button>
  ) : null

  return (
    <div className={`chart-viewer${!supportsNativeFullscreen && isFullscreen ? ' simulated-fullscreen' : ''}`} ref={viewerRef}>
      <div className={`viewer-controls${isFullscreen && !toolbarVisible ? ' controls-hidden' : ''}`}>
        {availableParts.length > 1 && (
          <div className="part-selector">
            <label className="part-selector-label" htmlFor="part-select">Part</label>
            <select
              id="part-select"
              className="part-select"
              value={selectedPart}
              onChange={e => setSelectedPart(e.target.value)}
            >
              {availableParts.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        )}

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
            <div className="xml-tools-main">
              <TransposeControl
                originalFifths={originalFifths}
                transpose={transpose}
                onChange={setTranspose}
              />
              {hideToolbarBtn}
              {fullscreenBtn}
            </div>
            <div className="zoom-controls">
              <button className="zoom-step" onClick={zoomOut} disabled={userZoom <= ZOOM_MIN} aria-label="Zoom out">−</button>
              <span className="zoom-pct">{Math.round(userZoom * 100)}%</span>
              <button className="zoom-step" onClick={zoomIn} disabled={userZoom >= ZOOM_MAX} aria-label="Zoom in">+</button>
              <div className="zoom-divider" />
              <button className={`zoom-btn${userZoom === 1 ? ' active' : ''}`} onClick={fitWidth}>Fit Width</button>
              <button className="zoom-btn" onClick={fitToPage} disabled={status !== 'ready'}>Fit Page</button>
            </div>
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
            <div style={{ flex: 1 }} />
            {hideToolbarBtn}
            {fullscreenBtn}
          </div>
        )}
      </div>

      {isFullscreen && !toolbarVisible && (
        <div
          className="toolbar-reveal-strip"
          onClick={() => setToolbarVisible(true)}
          role="button"
          tabIndex={0}
          aria-label="Show controls"
          onKeyDown={e => e.key === 'Enter' && setToolbarVisible(true)}
        />
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
          ? { visibility: status === 'ready' ? 'visible' : 'hidden', '--music-zoom': userZoom } as React.CSSProperties
          : { display: 'none' }
        }
      />
    </div>
  )
}
