# iRealB — Project Plan

## Stack
- **Frontend**: React 19 + TypeScript + Vite
- **Score rendering**: OpenSheetMusicDisplay (OSMD) 1.8.9
- **MXL decompression**: fflate

---

## Completed

### File ingestion
- [x] Drag-and-drop / click-to-browse upload zone
- [x] `.xml` and `.musicxml` support (read as text)
- [x] `.mxl` support — ZIP extracted via fflate so OSMD always receives a plain XML string

### Score rendering
- [x] OSMD renders full lead sheets (staff notation + chord symbols)
- [x] System breaks respected from MusicXML (`newSystemFromXML`, `newPageFromXML`)
- [x] Adaptive render-width algorithm — starts at container width, widens in 30% steps until rendered system count matches the XML-specified count, minimising CSS scale-down
- [x] CSS `width: 100% / min-width: 900px` scales the SVG to fit the viewport while keeping notes readable

### Mobile
- [x] Minimum 900 px render width — scores scroll horizontally on narrow screens rather than shrinking below legibility
- [x] `overflow-x: auto` on the score container
- [x] Responsive padding, font sizes, and toolbar wrapping below 600 px

### Chord symbols
- [x] 6/9 chords render as "6/9" (OSMD hardcodes "69"; patched via `EngravingRules.renameChord`)
- [x] Maj7♭5 chords render correctly (was "(alt b5)"; patched via `EngravingRules.addChordName`)

---

## TODO

### Chart library
- [ ] Persist uploaded charts in `localStorage` (name + XML content)
- [ ] Library view — grid or list of saved charts with title and composer
- [ ] Delete / rename charts
- [ ] Import multiple files at once

### Search
- [ ] Parse title and composer from MusicXML `<work-title>` / `<creator>` on upload
- [ ] Filter/search library by title, composer, or key

### Playback
- [ ] Extract chord symbols and their beat positions from the parsed MusicXML
- [ ] Integrate **Tone.js** for chord audio synthesis
- [ ] Transport controls — play, pause, stop, tempo adjustment
- [ ] Cursor that advances through the score in sync with playback
- [ ] Metronome / click track option

### Viewer UX
- [ ] Zoom in / zoom out controls (adjust OSMD zoom + re-render)
- [ ] Fullscreen mode
- [ ] Print / export to PDF

### Chord symbol polish
- [ ] Audit other edge-case chord types (e.g. 7♯11, 7♭9, alt voicings) and patch as found
- [ ] Option to switch between chord symbol styles (e.g. "maj7" vs "M7" vs "△7")
