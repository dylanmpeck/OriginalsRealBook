import { useEffect, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import {
  subscribeToCharts, uploadChart, addFormatToChart, deleteChart, deleteFormat,
  parseChartMeta, type ChartDoc, type ChartFormat, type FormatType, type UploadFormat, type ChartKey,
} from '../lib/charts'
import { extractXmlFromMxl } from '../utils/mxlExtract'
import './LibraryView.css'

interface Props {
  user: User
  onOpen: (chart: ChartDoc) => void
}

const CHART_KEYS: ChartKey[] = ['C', 'Bb', 'Eb']

const COMMON_PARTS = [
  'Lead Sheet',
  'Trumpet (Bb)',
  'Alto Sax (Eb)',
  'Tenor Sax (Bb)',
  'Trombone',
  'Bass',
  'Piano',
  'Guitar',
  'Drum Set',
  'Full Score',
]

interface PendingUpload {
  file: File
  extractedXml?: string
  formatType: FormatType
  title: string
  composer: string
  matchingChart: ChartDoc | null
  addToExisting: boolean
  key: ChartKey
  part: string
}

function formatLabel(type: FormatType): string {
  return type === 'musicxml' ? 'MusicXML' : type === 'pdf' ? 'PDF' : 'Image'
}

function formatShortLabel(type: FormatType): string {
  return type === 'musicxml' ? 'MXL' : type === 'pdf' ? 'PDF' : 'IMG'
}

function keyLabel(key: ChartKey): string {
  return key.replace('b', '♭')
}


export default function LibraryView({ user, onOpen }: Props) {
  const [charts, setCharts] = useState<ChartDoc[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [pending, setPending] = useState<PendingUpload | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dragCounter = useRef(0)

  const filtered = searchQuery.trim()
    ? charts.filter(c => {
        const q = searchQuery.toLowerCase()
        return c.title.toLowerCase().includes(q) || c.composer.toLowerCase().includes(q)
      })
    : charts

  useEffect(() => {
    const unsub = subscribeToCharts(data => {
      setCharts(data)
      setListLoading(false)
    })
    return unsub
  }, [])

  async function handleFile(file: File) {
    const lower = file.name.toLowerCase()
    const isXml = ['.xml', '.musicxml', '.mxl'].some(ext => lower.endsWith(ext))
    const isPdf = lower.endsWith('.pdf')
    const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].some(ext => lower.endsWith(ext))

    if (!isXml && !isPdf && !isImage) {
      setUploadError('Please upload a .xml, .musicxml, .mxl, .pdf, or image file.')
      return
    }
    setUploadError(null)

    let extractedXml: string | undefined
    let title = ''
    let composer = ''
    let formatType: FormatType

    try {
      if (isXml) {
        extractedXml = lower.endsWith('.mxl')
          ? await extractXmlFromMxl(file)
          : await file.text()
        const meta = parseChartMeta(extractedXml)
        title = meta.title
        composer = meta.composer
        formatType = 'musicxml'
      } else {
        formatType = isPdf ? 'pdf' : 'image'
      }

      const matchingChart = title
        ? charts.find(c => c.title.toLowerCase() === title.toLowerCase()) ?? null
        : null

      setPending({ file, extractedXml, formatType, title, composer, matchingChart, addToExisting: matchingChart !== null, key: 'C', part: 'Lead Sheet' })
    } catch (err) {
      setUploadError(`Failed to read file: ${(err as Error).message}`)
    }
  }

  async function confirmUpload() {
    if (!pending) return
    setUploading(true)
    const { file, extractedXml, formatType, title, composer, matchingChart, addToExisting, key, part } = pending
    setPending(null)
    try {
      const format: UploadFormat = {
        type: formatType,
        file,
        extractedXml,
        part,
        ...(formatType !== 'musicxml' && { key }),
      }
      if (addToExisting && matchingChart) {
        await addFormatToChart(matchingChart.id, format)
      } else {
        await uploadChart(user.uid, { title, composer }, format)
      }
    } catch (err) {
      setUploadError(`Upload failed: ${(err as Error).message}`)
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(c: ChartDoc, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`Delete "${c.title}"?`)) return
    try {
      await deleteChart(c)
    } catch (err) {
      console.error('Failed to delete chart', err)
    }
  }

  async function handleDeleteFormat(c: ChartDoc, f: ChartFormat, e: React.MouseEvent) {
    e.stopPropagation()
    const label = `${f.part}${f.key ? ` (${keyLabel(f.key)})` : ''}`
    const msg = c.formats.length === 1
      ? `Delete the ${label} version? This is the only version — the chart will be removed entirely.`
      : `Delete the ${label} version?`
    if (!confirm(msg)) return
    try {
      await deleteFormat(c, f)
    } catch (err) {
      console.error('Failed to delete format', err)
    }
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault()
    dragCounter.current++
    if (dragCounter.current === 1) setIsDragOver(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    dragCounter.current--
    if (dragCounter.current === 0) setIsDragOver(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    dragCounter.current = 0
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  return (
    <div
      className={`library${isDragOver ? ' drag-over' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={e => e.preventDefault()}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="library-header">
        <h2 className="library-title">Chart Library</h2>
        <button
          className="btn-upload"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? 'Uploading…' : '+ Upload Chart'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".xml,.musicxml,.mxl,.pdf,.png,.jpg,.jpeg,.gif,.webp"
          style={{ display: 'none' }}
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) handleFile(f)
            e.target.value = ''
          }}
        />
      </div>

      {uploadError && <p className="upload-error">{uploadError}</p>}

      {!listLoading && charts.length > 0 && (
        <input
          className="library-search"
          type="search"
          placeholder="Search by title or composer…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
      )}

      {listLoading ? (
        <div className="library-status">
          <div className="spinner" />
          <span>Loading charts…</span>
        </div>
      ) : charts.length === 0 ? (
        <div className="library-empty">
          <p>No charts yet.</p>
          <p>Upload a MusicXML, PDF, or image file to get started.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="library-empty">
          <p>No charts match "{searchQuery}".</p>
        </div>
      ) : (
        <div className="chart-grid">
          {filtered.map(c => (
            <div
              key={c.id}
              className="chart-card"
              onClick={() => onOpen(c)}
            >
              <div className="card-body">
                <p className="card-title">{c.title}</p>
                <div className="card-meta">
                  {c.composer && <span className="card-composer">{c.composer}</span>}
                  <div className="card-file-types">
                    {[...new Set(c.formats.map(f => f.type))].map(type => (
                      <span key={type} className={`file-type-tag file-type-tag-${type}`}>
                        {formatShortLabel(type)}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="card-formats">
                  {c.formats.map(f => (
                    <span key={f.storagePath} className={`format-badge format-badge-${f.type}`}>
                      {f.part}{f.key ? ` · ${keyLabel(f.key)}` : ''}
                      <button
                        className="btn-delete-format"
                        onClick={e => handleDeleteFormat(c, f, e)}
                        title={`Delete ${f.part}${f.key ? ` (${keyLabel(f.key)})` : ''} version`}
                        aria-label="Delete this version"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
              <button
                className="btn-delete"
                onClick={e => handleDelete(c, e)}
                title="Delete chart"
                aria-label="Delete chart"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {pending && (
        <div className="upload-modal-backdrop" onClick={() => setPending(null)}>
          <div className="upload-modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Confirm chart details</h3>
            <p className="modal-filename">{pending.file.name}</p>

            {pending.matchingChart && (
              <div className="modal-existing-notice">
                <p>A chart named <strong>"{pending.matchingChart.title}"</strong> already exists.</p>
                <div className="modal-existing-options">
                  <label className="modal-radio-label">
                    <input
                      type="radio"
                      name="upload-mode"
                      checked={pending.addToExisting}
                      onChange={() => setPending(p => p && { ...p, addToExisting: true })}
                    />
                    Add {formatLabel(pending.formatType)} to existing chart
                  </label>
                  <label className="modal-radio-label">
                    <input
                      type="radio"
                      name="upload-mode"
                      checked={!pending.addToExisting}
                      onChange={() => setPending(p => p && { ...p, addToExisting: false })}
                    />
                    Create as new chart
                  </label>
                </div>
              </div>
            )}

            {!pending.addToExisting && (
              <>
                <label className="modal-label">
                  Title
                  <input
                    className="modal-input"
                    type="text"
                    value={pending.title}
                    onChange={e => {
                      const newTitle = e.target.value
                      const match = newTitle.trim()
                        ? charts.find(c => c.title.toLowerCase() === newTitle.trim().toLowerCase()) ?? null
                        : null
                      setPending(p => p && { ...p, title: newTitle, matchingChart: match, addToExisting: match !== null })
                    }}
                    placeholder="Untitled"
                    autoFocus={!pending.matchingChart}
                  />
                </label>
                <label className="modal-label">
                  Composer
                  <input
                    className="modal-input"
                    type="text"
                    value={pending.composer}
                    onChange={e => setPending(p => p && { ...p, composer: e.target.value })}
                    placeholder="Unknown"
                  />
                </label>
              </>
            )}

            {(pending.formatType === 'pdf' || pending.formatType === 'image') && (
              <label className="modal-label">
                Key
                <div className="modal-key-selector">
                  {CHART_KEYS.map(k => (
                    <button
                      key={k}
                      type="button"
                      className={`key-btn${pending.key === k ? ' active' : ''}`}
                      onClick={() => setPending(p => p && { ...p, key: k })}
                    >
                      {keyLabel(k)}
                    </button>
                  ))}
                </div>
              </label>
            )}

            <label className="modal-label">
              Part
              <input
                className="modal-input"
                type="text"
                list="common-parts"
                value={pending.part}
                onChange={e => setPending(p => p && { ...p, part: e.target.value })}
                placeholder="Lead Sheet"
              />
              <datalist id="common-parts">
                {COMMON_PARTS.map(p => <option key={p} value={p} />)}
              </datalist>
            </label>

            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setPending(null)}>Cancel</button>
              <button className="btn-upload" onClick={confirmUpload}>Upload</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
