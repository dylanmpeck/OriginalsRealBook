import {
  collection, addDoc, onSnapshot, deleteDoc, doc,
  query, orderBy, Timestamp, updateDoc, arrayUnion,
} from 'firebase/firestore'
import { ref, uploadBytes, deleteObject, getBlob, getDownloadURL } from 'firebase/storage'
import { db, storage } from './firebase'

export type FormatType = 'musicxml' | 'pdf' | 'image'
export type ChartKey = 'C' | 'Bb' | 'Eb'

export interface ChartFormat {
  type: FormatType
  filename: string
  storagePath: string
  uploadedAt: Date
  key?: ChartKey
}

export interface ChartDoc {
  id: string
  title: string
  composer: string
  uploadedAt: Date
  uploadedBy: string
  formats: ChartFormat[]
}

export interface UploadFormat {
  type: FormatType
  file: File
  extractedXml?: string
  key?: ChartKey
}

export function parseChartMeta(xml: string): { title: string; composer: string } {
  const domDoc = new DOMParser().parseFromString(xml, 'text/xml')
  const title =
    domDoc.querySelector('work-title')?.textContent?.trim() ||
    domDoc.querySelector('movement-title')?.textContent?.trim() ||
    ''
  const composer =
    domDoc.querySelector('creator[type="composer"]')?.textContent?.trim() || ''
  return { title, composer }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeDoc(id: string, data: Record<string, any>): ChartDoc {
  if (data.formats) {
    return {
      id,
      title: data.title,
      composer: data.composer || '',
      uploadedAt: (data.uploadedAt as Timestamp).toDate(),
      uploadedBy: data.uploadedBy,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formats: (data.formats as any[]).map(f => ({
        ...f,
        uploadedAt: (f.uploadedAt as Timestamp).toDate(),
      })),
    }
  }
  // Backward compat: old schema had storagePath/filename at top level
  return {
    id,
    title: data.title || data.filename,
    composer: data.composer || '',
    uploadedAt: (data.uploadedAt as Timestamp).toDate(),
    uploadedBy: data.uploadedBy,
    formats: [{
      type: 'musicxml' as FormatType,
      filename: data.filename,
      storagePath: data.storagePath,
      uploadedAt: (data.uploadedAt as Timestamp).toDate(),
    }],
  }
}

async function uploadFormatFile(format: UploadFormat): Promise<string> {
  const blob = format.extractedXml
    ? new Blob([format.extractedXml], { type: 'application/xml' })
    : format.file
  const storageRef = ref(storage, `charts/${Date.now()}_${format.file.name}`)
  await uploadBytes(storageRef, blob)
  return storageRef.fullPath
}

function formatEntry(format: UploadFormat, storagePath: string) {
  return {
    type: format.type,
    filename: format.file.name,
    storagePath,
    uploadedAt: Timestamp.now(),
    ...(format.key !== undefined && { key: format.key }),
  }
}

export async function uploadChart(
  uid: string,
  meta: { title: string; composer: string },
  format: UploadFormat,
): Promise<void> {
  const storagePath = await uploadFormatFile(format)
  await addDoc(collection(db, 'charts'), {
    title: meta.title || format.file.name,
    composer: meta.composer,
    uploadedAt: Timestamp.now(),
    uploadedBy: uid,
    formats: [formatEntry(format, storagePath)],
  })
}

export async function addFormatToChart(
  chartId: string,
  format: UploadFormat,
): Promise<void> {
  const storagePath = await uploadFormatFile(format)
  await updateDoc(doc(db, 'charts', chartId), {
    formats: arrayUnion(formatEntry(format, storagePath)),
  })
}

export function subscribeToCharts(cb: (charts: ChartDoc[]) => void): () => void {
  const q = query(collection(db, 'charts'), orderBy('uploadedAt', 'desc'))
  return onSnapshot(q, snap => {
    cb(snap.docs.map(d => normalizeDoc(d.id, d.data() as Record<string, unknown>)))
  })
}

export async function getChartXml(storagePath: string): Promise<string> {
  const blob = await getBlob(ref(storage, storagePath))
  return blob.text()
}

export async function getChartFileUrl(storagePath: string): Promise<string> {
  return getDownloadURL(ref(storage, storagePath))
}

export async function deleteChart(chart: ChartDoc): Promise<void> {
  await deleteDoc(doc(db, 'charts', chart.id))
  await Promise.all(
    chart.formats.map(f =>
      deleteObject(ref(storage, f.storagePath)).catch(() => {})
    )
  )
}

export async function deleteFormat(chart: ChartDoc, format: ChartFormat): Promise<void> {
  const remaining = chart.formats.filter(f => f.storagePath !== format.storagePath)
  if (remaining.length === 0) {
    await deleteChart(chart)
    return
  }
  await updateDoc(doc(db, 'charts', chart.id), {
    formats: remaining.map(f => ({
      type: f.type,
      filename: f.filename,
      storagePath: f.storagePath,
      uploadedAt: Timestamp.fromDate(f.uploadedAt),
      ...(f.key !== undefined && { key: f.key }),
    })),
  })
  await deleteObject(ref(storage, format.storagePath)).catch(() => {})
}
