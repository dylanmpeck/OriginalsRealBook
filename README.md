# Originals Jam Group — Chart Viewer

**Live site: [originalsirealb.web.app](https://originalsirealb.web.app/)**

A web app for sharing and practicing original jazz compositions within a small musician group. Our ensemble writes difficult, original music together and needed a simple way to upload, organize, and view charts during rehearsal and personal practice — without emailing PDFs or hunting through folders.

## Features

### Library
- **Multi-format chart library** — upload MusicXML, PDF, or image files for each piece
- **Multi-part support** — attach multiple parts to a single chart (Lead Sheet, Trumpet, Alto Sax, Trombone, Bass, etc.) and switch between them in the viewer
- **Per-key versioning** — store separate versions of a chart in different transpositions (C, B♭, E♭) for different instruments
- **Batch upload** — drag and drop or select multiple files at once; the app detects a shared title from common filename prefixes/suffixes, infers the part name from keywords in the filename (e.g. "Alto" → Alto Sax, "Drums" → Drum Set), and groups same-title files into one chart automatically
- **Drag-and-drop upload** — drop files anywhere on the library view to start the upload flow
- **Live search** — filter charts by title or composer instantly
- **Google authentication** — access is gated behind sign-in so the library stays private to the group

### Viewer
- **MusicXML rendering** — sheet music renders directly in the browser via OpenSheetMusicDisplay, with no plugins required
- **PDF rendering** — PDFs are rendered to canvas via PDF.js rather than a native iframe, giving consistent zoom and fit controls on all platforms including iOS and Android
- **Key transposition** — transpose any MusicXML chart up or down in real time without re-uploading
- **Zoom & fit controls** — zoom in/out, fit to container width, or fit a single page to the viewport; available for both MusicXML and PDF formats
- **Fullscreen mode** — fills the entire screen with music; uses the native Fullscreen API on desktop and a simulated fixed-position overlay on iOS/mobile where the API is unavailable
- **Collapsible toolbar** — hide the controls in fullscreen for a clean view; a hover strip at the top reveals them again

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite |
| Music rendering | OpenSheetMusicDisplay (OSMD) |
| PDF rendering | PDF.js (pdfjs-dist) |
| MXL decompression | fflate |
| Database | Firebase Firestore |
| File storage | Firebase Storage |
| Authentication | Firebase Auth (Google Sign-In) |
| Hosting | Firebase Hosting |
| CI/CD | GitHub Actions |

## Architecture

Charts are stored as Firestore documents containing metadata (title, composer, upload date) and an array of format entries. Each format entry references a file in Firebase Storage and carries its type (`musicxml`, `pdf`, or `image`), the part name, and an optional key. This schema allows a single chart to accumulate multiple parts and transpositions over time without duplicating top-level documents.

MusicXML files are rendered client-side by OSMD. Transposition is applied by manipulating the XML's `<key>` and note pitch elements before passing the document to OSMD, avoiding a round-trip to any server.

PDF files are rendered page-by-page to canvas elements using PDF.js. The viewer is lazy-loaded so the ~1.2 MB worker only downloads when a PDF is first opened. The PDF.js worker is bundled with the app (via Vite's `?url` import) rather than fetched from a CDN, so it works offline and without external dependencies.

Batch uploads group files by their target chart at confirm time — the first file in a new-chart group creates the Firestore document and returns its ID, and subsequent files in the group are added via `arrayUnion` using that ID. This ensures multiple parts uploaded together land in the same chart even before any of them exist in the database.

## Local Development

```bash
# 1. Clone and install
npm install

# 2. Create .env.local with your Firebase project credentials
cp .env.example .env.local
# fill in VITE_FIREBASE_* values

# 3. Start the dev server
npm run dev
```

## Roadmap

- **Playback** — audio playback of MusicXML charts directly in the browser
- **PDF to MusicXML conversion** — automatically convert uploaded PDFs into editable MusicXML so they can be transposed and rendered as sheet music

## Deployment

Merges to `main` automatically build and deploy to Firebase Hosting via GitHub Actions. Firebase credentials are injected at build time from GitHub environment secrets so no keys are stored in the repository.
