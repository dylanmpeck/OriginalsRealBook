import { transposedKeyName } from '../utils/transposeXml'
import './TransposeControl.css'

interface Props {
  originalFifths: number
  transpose: number
  onChange: (semitones: number) => void
  disabled?: boolean
}

export default function TransposeControl({ originalFifths, transpose, onChange, disabled }: Props) {
  const keyDisplay = transposedKeyName(originalFifths, transpose)
  const offsetLabel = transpose === 0 ? '±0' : transpose > 0 ? `+${transpose}` : `${transpose}`

  return (
    <div className={`transpose-control${disabled ? ' disabled' : ''}`}>
      <span className="transpose-label">Key</span>
      <span className="transpose-bound">−12</span>
      <input
        type="range"
        className="transpose-slider"
        min={-12}
        max={12}
        value={transpose}
        disabled={disabled}
        onChange={e => onChange(parseInt(e.target.value, 10))}
        aria-label="Transpose semitones"
      />
      <span className="transpose-bound">+12</span>
      <span className="transpose-key">{keyDisplay}</span>
      <span className={`transpose-offset${transpose === 0 ? ' zero' : ''}`}>{offsetLabel}</span>
      {transpose !== 0 && (
        <button
          className="btn-transpose-reset"
          onClick={() => onChange(0)}
          title="Reset to original key"
          aria-label="Reset transposition"
        >↺</button>
      )}
    </div>
  )
}
