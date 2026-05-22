import { unzip } from 'fflate'

export async function extractXmlFromMxl(file: File): Promise<string> {
  const uint8 = new Uint8Array(await file.arrayBuffer())

  return new Promise((resolve, reject) => {
    unzip(uint8, {}, (err, files) => {
      if (err) { reject(err); return }

      // Prefer the rootfile declared in META-INF/container.xml
      const containerBytes = files['META-INF/container.xml']
      if (containerBytes) {
        const containerXml = new TextDecoder().decode(containerBytes)
        const match = containerXml.match(/full-path="([^"]+)"/)
        if (match) {
          const rootBytes = files[match[1]]
          if (rootBytes) { resolve(new TextDecoder().decode(rootBytes)); return }
        }
      }

      // Fallback: first .xml / .musicxml file outside META-INF
      const key = Object.keys(files).find(
        k => (k.endsWith('.xml') || k.endsWith('.musicxml')) && !k.startsWith('META-INF')
      )
      if (key) {
        resolve(new TextDecoder().decode(files[key]))
      } else {
        reject(new Error('No MusicXML content found inside .mxl archive'))
      }
    })
  })
}
