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

function predictBatchTitle(files: File[]): string {
  if (files.length < 2) return ''
  const basenames = files.map(f => f.name.replace(/\.[^.]+$/, ''))

  let prefix = basenames[0]
  for (const name of basenames.slice(1)) {
    while (!name.startsWith(prefix)) prefix = prefix.slice(0, -1)
    if (!prefix) break
  }

  let suffix = basenames[0]
  for (const name of basenames.slice(1)) {
    while (!name.endsWith(suffix)) suffix = suffix.slice(1)
    if (!suffix) break
  }

  const clean = (s: string) => s.replace(/^[\s\-_–—.,|:()\[\]]+|[\s\-_–—.,|:()\[\]]+$/g, '').trim()
  const cleanPrefix = clean(prefix)
  const cleanSuffix = clean(suffix)

  const MIN_LEN = 3
  if (cleanPrefix.length >= MIN_LEN && cleanPrefix.length >= cleanSuffix.length) return cleanPrefix
  if (cleanSuffix.length >= MIN_LEN) return cleanSuffix
  return ''
}


export default function LibraryView({ user, onOpen }: Props) {
  const [charts, setCharts] = useState<ChartDoc[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [pendingBatch, setPendingBatch] = useState<PendingUpload[]>([])
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

  function updateItem(i: number, update: Partial<PendingUpload>) {
    setPendingBatch(batch => batch.map((item, idx) => idx === i ? { ...item, ...update } : item))
  }

  function removeItem(i: number) {
    setPendingBatch(batch => batch.filter((_, idx) => idx !== i))
  }

  function makeFormat(item: PendingUpload): UploadFormat {
    return {
      type: item.formatType,
      file: item.file,
      extractedXml: item.extractedXml,
      part: item.part,
      ...(item.formatType !== 'musicxml' && { key: item.key }),
    }
  }

  async function handleFiles(files: File[]) {
    setUploadError(null)
    const skipped: string[] = []
    const items: PendingUpload[] = []

    // First pass: extract file type and XML metadata
    for (const file of files) {
      const lower = file.name.toLowerCase()
      const isXml = ['.xml', '.musicxml', '.mxl'].some(ext => lower.endsWith(ext))
      const isPdf = lower.endsWith('.pdf')
      const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].some(ext => lower.endsWith(ext))

      if (!isXml && !isPdf && !isImage) { skipped.push(file.name); continue }

      let extractedXml: string | undefined
      let title = ''
      let composer = ''
      let formatType: FormatType

      try {
        if (isXml) {
          extractedXml = lower.endsWith('.mxl') ? await extractXmlFromMxl(file) : await file.text()
          const meta = parseChartMeta(extractedXml)
          title = meta.title
          composer = meta.composer
          formatType = 'musicxml'
        } else {
          formatType = isPdf ? 'pdf' : 'image'
        }
        items.push({ file, extractedXml, formatType, title, composer, matchingChart: null, addToExisting: false, key: 'C', part: 'Lead Sheet' })
      } catch (err) {
        skipped.push(`${file.name} (${(err as Error).message})`)
      }
    }

    // Predict title from filenames for items that have no title (PDFs/images)
    if (items.length > 1) {
      const predicted = predictBatchTitle(items.map(i => i.file))
      if (predicted) {
        for (const item of items) {
          if (!item.title) item.title = predicted
        }
      }
    }

    // Second pass: compute matchingChart and intra-batch grouping based on final titles
    const batchTitles = new Map<string, ChartDoc>()
    for (const item of items) {
      const key = item.title.trim().toLowerCase()
      const matchingChart = key
        ? (charts.find(c => c.title.toLowerCase() === key) ?? batchTitles.get(key) ?? null)
        : null
      item.matchingChart = matchingChart
      item.addToExisting = matchingChart !== null
      if (key && !matchingChart) {
        batchTitles.set(key, { id: `batch:${key}`, title: item.title, composer: item.composer, formats: [], uploadedAt: new Date(), uploadedBy: user.uid })
      }
    }

    if (skipped.length > 0) setUploadError(`Skipped unsupported files: ${skipped.join(', ')}`)
    if (items.length > 0) setPendingBatch(items)
  }

  async function confirmUpload() {
    if (pendingBatch.length === 0) return
    setUploading(true)
    const batch = pendingBatch
    setPendingBatch([])
    const errors: string[] = []

    // Group items by target chart: existing DB chart ID, or normalized title for new charts
    // (intra-batch items sharing a title are grouped under the same new chart)
    const groups = new Map<string, PendingUpload[]>()
    for (const item of batch) {
      const groupKey = item.addToExisting && item.matchingChart && !item.matchingChart.id.startsWith('batch:')
        ? `db:${item.matchingChart.id}`
        : `new:${(item.title.trim() || item.file.name).toLowerCase()}`
      if (!groups.has(groupKey)) groups.set(groupKey, [])
      groups.get(groupKey)!.push(item)
    }

    await Promise.all([...groups.entries()].map(async ([groupKey, items]) => {
      if (groupKey.startsWith('db:')) {
        const chartId = groupKey.slice(3)
        await Promise.all(items.map(async item => {
          try { await addFormatToChart(chartId, makeFormat(item)) }
          catch (err) { errors.push(`"${item.file.name}": ${(err as Error).message}`) }
        }))
      } else {
        const [first, ...rest] = items
        try {
          const chartId = await uploadChart(user.uid, { title: first.title, composer: first.composer }, makeFormat(first))
          await Promise.all(rest.map(async item => {
            try { await addFormatToChart(chartId, makeFormat(item)) }
            catch (err) { errors.push(`"${item.file.name}": ${(err as Error).message}`) }
          }))
        } catch (err) {
          errors.push(`"${first.file.name}": ${(err as Error).message}`)
        }
      }
    }))

    setUploading(false)
    if (errors.length > 0) setUploadError(`Upload failed — ${errors.join('; ')}`)
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
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) handleFiles(files)
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
          multiple
          accept=".xml,.musicxml,.mxl,.pdf,.png,.jpg,.jpeg,.gif,.webp"
          style={{ display: 'none' }}
          onChange={e => {
            const files = Array.from(e.target.files ?? [])
            if (files.length > 0) handleFiles(files)
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

      {pendingBatch.length > 0 && (
        <div className="upload-modal-backdrop" onClick={() => setPendingBatch([])}>
          <div className="upload-modal upload-modal-batch" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">
              Upload {pendingBatch.length} {pendingBatch.length === 1 ? 'chart' : 'charts'}
            </h3>

            <datalist id="common-parts">
              {COMMON_PARTS.map(p => <option key={p} value={p} />)}
            </datalist>

            <div className="batch-list">
              {pendingBatch.map((item, i) => (
                <div key={item.file.name + i} className="batch-item">
                  <div className="batch-item-header">
                    <span className={`file-type-tag file-type-tag-${item.formatType}`}>
                      {formatShortLabel(item.formatType)}
                    </span>
                    <span className="batch-item-filename">{item.file.name}</span>
                    <button
                      className="batch-item-remove"
                      onClick={() => removeItem(i)}
                      aria-label="Remove from upload"
                    >×</button>
                  </div>

                  {item.matchingChart && (
                    <div className="batch-item-existing">
                      {item.matchingChart.id.startsWith('batch:') ? (
                        <p className="batch-item-group-hint">
                          Will be grouped with &ldquo;{item.matchingChart.title}&rdquo; above
                        </p>
                      ) : (
                        <>
                          <label className="modal-radio-label">
                            <input
                              type="radio"
                              name={`upload-mode-${i}`}
                              checked={item.addToExisting}
                              onChange={() => updateItem(i, { addToExisting: true })}
                            />
                            Add {formatLabel(item.formatType)} to &ldquo;{item.matchingChart.title}&rdquo;
                          </label>
                          <label className="modal-radio-label">
                            <input
                              type="radio"
                              name={`upload-mode-${i}`}
                              checked={!item.addToExisting}
                              onChange={() => updateItem(i, { addToExisting: false })}
                            />
                            Create as new chart
                          </label>
                        </>
                      )}
                    </div>
                  )}

                  {!item.addToExisting && (
                    <div className="batch-item-row">
                      <div className="batch-item-field">
                        <label className="batch-field-label">Title</label>
                        <input
                          className="modal-input"
                          type="text"
                          value={item.title}
                          placeholder="Untitled"
                          onChange={e => {
                            const newTitle = e.target.value
                            const match = newTitle.trim()
                              ? charts.find(c => c.title.toLowerCase() === newTitle.trim().toLowerCase()) ?? null
                              : null
                            updateItem(i, { title: newTitle, matchingChart: match, addToExisting: match !== null })
                          }}
                        />
                      </div>
                      <div className="batch-item-field">
                        <label className="batch-field-label">Composer</label>
                        <input
                          className="modal-input"
                          type="text"
                          value={item.composer}
                          placeholder="Unknown"
                          onChange={e => updateItem(i, { composer: e.target.value })}
                        />
                      </div>
                    </div>
                  )}

                  <div className="batch-item-row">
                    <div className="batch-item-field batch-item-field-part">
                      <label className="batch-field-label">Part</label>
                      <input
                        className="modal-input"
                        type="text"
                        list="common-parts"
                        value={item.part}
                        placeholder="Lead Sheet"
                        onChange={e => updateItem(i, { part: e.target.value })}
                      />
                    </div>
                    {(item.formatType === 'pdf' || item.formatType === 'image') && (
                      <div className="batch-item-field">
                        <label className="batch-field-label">Key</label>
                        <div className="modal-key-selector">
                          {CHART_KEYS.map(k => (
                            <button
                              key={k}
                              type="button"
                              className={`key-btn${item.key === k ? ' active' : ''}`}
                              onClick={() => updateItem(i, { key: k })}
                            >
                              {keyLabel(k)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setPendingBatch([])}>Cancel</button>
              <button className="btn-upload" onClick={confirmUpload}>
                Upload {pendingBatch.length === 1 ? 'chart' : `all ${pendingBatch.length}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
