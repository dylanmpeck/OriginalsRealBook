import { useRef, useState, type DragEvent, type ChangeEvent } from 'react'
import type { Chart } from '../App'
import { extractXmlFromMxl } from '../utils/mxlExtract'
import './FileUpload.css'

interface Props {
  onLoad: (chart: Chart) => void
}

export default function FileUpload({ onLoad }: Props) {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleFile(file: File) {
    const validExts = ['.xml', '.musicxml', '.mxl']
    const lower = file.name.toLowerCase()
    if (!validExts.some(ext => lower.endsWith(ext))) {
      setError('Please upload a .xml or .musicxml file.')
      return
    }
    setError(null)
    if (lower.endsWith('.mxl')) {
      extractXmlFromMxl(file)
        .then(xmlContent => onLoad({ name: file.name, xmlContent }))
        .catch(err => setError(`Failed to read .mxl: ${(err as Error).message}`))
    } else {
      const reader = new FileReader()
      reader.onload = (e) => {
        onLoad({ name: file.name, xmlContent: e.target!.result as string })
      }
      reader.readAsText(file)
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  return (
    <div
      className={`drop-zone${dragging ? ' dragging' : ''}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xml,.musicxml,.mxl"
        onChange={onChange}
        style={{ display: 'none' }}
      />
      <div className="drop-icon">♩</div>
      <p className="drop-primary">Drop your MusicXML file here</p>
      <p className="drop-secondary">or click to browse</p>
      {error && <p className="drop-error">{error}</p>}
    </div>
  )
}
