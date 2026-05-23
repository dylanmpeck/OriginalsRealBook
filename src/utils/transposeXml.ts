const STEP_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

type NoteSpelling = [string, number]

const SHARP_SPELLING: NoteSpelling[] = [
  ['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0],
  ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0],
]
const FLAT_SPELLING: NoteSpelling[] = [
  ['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0],
  ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0],
]

// Preferred key signature (fifths) for each pitch class 0-11
const PREFERRED_FIFTHS = [0, -5, 2, -3, 4, -1, -6, 1, -4, 3, -2, 5]

const FIFTHS_KEY_NAMES: Record<number, string> = {
  [-7]: 'Cb', [-6]: 'Gb', [-5]: 'Db', [-4]: 'Ab', [-3]: 'Eb', [-2]: 'Bb', [-1]: 'F',
  0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#',
}

function fifthsToSemitone(fifths: number): number {
  return ((fifths * 7) % 12 + 12) % 12
}

function newFifthsAfterTranspose(originalFifths: number, semitones: number): number {
  const tonic = fifthsToSemitone(originalFifths)
  const newTonic = ((tonic + semitones) % 12 + 12) % 12
  return PREFERRED_FIFTHS[newTonic]
}

function spelling(pc: number, preferFlats: boolean): NoteSpelling {
  return (preferFlats ? FLAT_SPELLING : SHARP_SPELLING)[((pc % 12) + 12) % 12]
}

export function getKeyFifths(xml: string): number {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const el = doc.querySelector('key fifths')
  return el ? parseInt(el.textContent ?? '0', 10) : 0
}

export function keyName(fifths: number): string {
  return FIFTHS_KEY_NAMES[fifths] ?? 'C'
}

export function transposedKeyName(originalFifths: number, semitones: number): string {
  return keyName(newFifthsAfterTranspose(originalFifths, semitones))
}

export function transposeXml(xmlString: string, semitones: number): string {
  if (semitones === 0) return xmlString

  const doc = new DOMParser().parseFromString(xmlString, 'text/xml')

  // Determine accidental preference from first key signature
  const firstFifthsEl = doc.querySelector('key fifths')
  const originalFifths = firstFifthsEl ? parseInt(firstFifthsEl.textContent ?? '0', 10) : 0
  const targetFifths = newFifthsAfterTranspose(originalFifths, semitones)
  const preferFlats = targetFifths <= 0

  // Transpose all key signatures
  for (const keyEl of Array.from(doc.querySelectorAll('key'))) {
    const fifthsEl = keyEl.querySelector('fifths')
    if (!fifthsEl) continue
    const oldFifths = parseInt(fifthsEl.textContent ?? '0', 10)
    fifthsEl.textContent = String(newFifthsAfterTranspose(oldFifths, semitones))
  }

  // Transpose note pitches
  for (const pitchEl of Array.from(doc.querySelectorAll('pitch'))) {
    const stepEl = pitchEl.querySelector('step')
    const alterEl = pitchEl.querySelector('alter')
    const octaveEl = pitchEl.querySelector('octave')
    if (!stepEl || !octaveEl) continue

    const step = stepEl.textContent ?? 'C'
    const alter = Math.round(parseFloat(alterEl?.textContent ?? '0'))
    const octave = parseInt(octaveEl.textContent ?? '4', 10)

    const midi = (octave + 1) * 12 + (STEP_SEMITONE[step] ?? 0) + alter
    const newMidi = midi + semitones
    const newOctave = Math.floor(newMidi / 12) - 1
    const newPc = ((newMidi % 12) + 12) % 12
    const [newStep, newAlter] = spelling(newPc, preferFlats)

    stepEl.textContent = newStep
    octaveEl.textContent = String(newOctave)
    if (newAlter === 0) {
      alterEl?.remove()
    } else if (alterEl) {
      alterEl.textContent = String(newAlter)
    } else {
      const el = doc.createElement('alter')
      el.textContent = String(newAlter)
      pitchEl.insertBefore(el, octaveEl)
    }
  }

  // Transpose harmony roots and optional bass notes
  for (const harmonyEl of Array.from(doc.querySelectorAll('harmony'))) {
    for (const [containerTag, stepTag, alterTag] of [
      ['root', 'root-step', 'root-alter'],
      ['bass', 'bass-step', 'bass-alter'],
    ] as [string, string, string][]) {
      const containerEl = harmonyEl.querySelector(containerTag)
      if (!containerEl) continue
      const stepEl = containerEl.querySelector(stepTag)
      if (!stepEl) continue
      const alterEl = containerEl.querySelector(alterTag)

      const step = stepEl.textContent ?? 'C'
      const alter = Math.round(parseFloat(alterEl?.textContent ?? '0'))
      const pc = (((STEP_SEMITONE[step] ?? 0) + alter) % 12 + 12) % 12
      const newPc = ((pc + semitones) % 12 + 12) % 12
      const [newStep, newAlter] = spelling(newPc, preferFlats)

      stepEl.textContent = newStep
      if (newAlter === 0) {
        alterEl?.remove()
      } else if (alterEl) {
        alterEl.textContent = String(newAlter)
      } else {
        const el = doc.createElement(alterTag)
        el.textContent = String(newAlter)
        containerEl.appendChild(el)
      }
    }
  }

  return new XMLSerializer().serializeToString(doc)
}
