# Originals Jam Group — Chart Viewer

A web app for sharing and practicing original jazz compositions within a small musician group. Our ensemble writes difficult, original music together and needed a simple way to upload, organize, and view charts during rehearsal and personal practice — without emailing PDFs or hunting through folders.

## Features

- **Multi-format chart library** — upload MusicXML, PDF, or image files for each piece
- **Multi-part support** — attach multiple parts to a single chart (Lead Sheet, Trumpet, Alto Sax, Trombone, Bass, etc.) and switch between them in the viewer
- **Per-key versioning** — store separate versions of a chart in different transpositions (C, B♭, E♭) for different instruments
- **MusicXML rendering** — sheet music renders directly in the browser via OpenSheetMusicDisplay, with no plugins required
- **Key transposition** — transpose any MusicXML chart up or down in real time without re-uploading
- **Zoom & fit controls** — zoom in/out, fit to container width, or fit the full page to the viewport
- **Fullscreen mode** — collapse the toolbar and fill the screen with music during rehearsal
- **Live library search** — filter charts by title or composer instantly
- **Google authentication** — access is gated behind sign-in so the library stays private to the group

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite |
| Music rendering | OpenSheetMusicDisplay (OSMD) |
| MXL decompression | fflate |
| Database | Firebase Firestore |
| File storage | Firebase Storage |
| Authentication | Firebase Auth (Google Sign-In) |
| Hosting | Firebase Hosting |
| CI/CD | GitHub Actions |

## Architecture

Charts are stored as Firestore documents containing metadata (title, composer, upload date) and an array of format entries. Each format entry references a file in Firebase Storage and carries its type (`musicxml`, `pdf`, or `image`), the part name, and an optional key. This schema allows a single chart to accumulate multiple parts and transpositions over time without duplicating top-level documents.

MusicXML files are rendered client-side by OSMD. Transposition is applied by manipulating the XML's `<key>` and note pitch elements before passing the document to OSMD, avoiding a round-trip to any server.

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
