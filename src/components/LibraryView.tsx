import { useEffect, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { subscribeToCharts, uploadChart, deleteChart, getChartXml, parseChartMeta, type ChartDoc } from '../lib/charts'
import { extractXmlFromMxl } from '../utils/mxlExtract'
import type { Chart } from '../App'
import './LibraryView.css'

interface Props {
  user: User
  onOpen: (chart: Chart) => void
}

export default function LibraryView({ user, onOpen }: Props) {
  const [charts, setCharts] = useState<ChartDoc[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [pending, setPending] = useState<{ file: File; xmlContent: string; title: string; composer: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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
    const validExts = ['.xml', '.musicxml', '.mxl']
    if (!validExts.some(ext => file.name.toLowerCase().endsWith(ext))) {
      setUploadError('Please upload a .xml, .musicxml, or .mxl file.')
      return
    }
    setUploadError(null)
    try {
      const xmlContent = file.name.toLowerCase().endsWith('.mxl')
        ? await extractXmlFromMxl(file)
        : await file.text()
      const { title, composer } = parseChartMeta(xmlContent)
      setPending({ file, xmlContent, title, composer })
    } catch (err) {
      setUploadError(`Failed to read file: ${(err as Error).message}`)
    }
  }

  async function confirmUpload() {
    if (!pending) return
    setUploading(true)
    setPending(null)
    try {
      await uploadChart(pending.file, pending.xmlContent, user.uid, {
        title: pending.title,
        composer: pending.composer,
      })
    } catch (err) {
      setUploadError(`Upload failed: ${(err as Error).message}`)
    } finally {
      setUploading(false)
    }
  }

  async function handleOpen(c: ChartDoc) {
    setOpening(c.id)
    try {
      const xmlContent = await getChartXml(c.storagePath)
      onOpen({ name: c.title || c.filename, xmlContent })
    } catch (err) {
      console.error('Failed to load chart', err)
    } finally {
      setOpening(null)
    }
  }

  async function handleDelete(c: ChartDoc, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`Delete "${c.title || c.filename}"?`)) return
    try {
      await deleteChart(c.id, c.storagePath)
    } catch (err) {
      console.error('Failed to delete chart', err)
    }
  }

  return (
    <div className="library">
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
          accept=".xml,.musicxml,.mxl"
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
          <p>Upload a MusicXML file to get started.</p>
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
              className={`chart-card${opening === c.id ? ' loading' : ''}`}
              onClick={() => opening ? undefined : handleOpen(c)}
            >
              {opening === c.id ? (
                <div className="card-loading"><div className="spinner" /></div>
              ) : (
                <>
                  <div className="card-body">
                    <p className="card-title">{c.title || c.filename}</p>
                    {c.composer && <p className="card-composer">{c.composer}</p>}
                    <p className="card-filename">{c.filename}</p>
                  </div>
                  <button
                    className="btn-delete"
                    onClick={e => handleDelete(c, e)}
                    title="Delete chart"
                    aria-label="Delete chart"
                  >
                    ×
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {pending && (
        <div className="upload-modal-backdrop" onClick={() => setPending(null)}>
          <div className="upload-modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Confirm chart details</h3>
            <p className="modal-filename">{pending.file.name}</p>
            <label className="modal-label">
              Title
              <input
                className="modal-input"
                type="text"
                value={pending.title}
                onChange={e => setPending(p => p && { ...p, title: e.target.value })}
                placeholder="Untitled"
                autoFocus
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
