import {
  collection, addDoc, onSnapshot, deleteDoc, doc,
  query, orderBy, Timestamp,
} from 'firebase/firestore'
import { ref, uploadBytes, deleteObject, getBlob } from 'firebase/storage'
import { db, storage } from './firebase'

export interface ChartDoc {
  id: string
  title: string
  composer: string
  filename: string
  storagePath: string
  uploadedAt: Date
  uploadedBy: string
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

export async function uploadChart(
  file: File,
  xmlContent: string,
  uid: string,
  meta: { title: string; composer: string },
): Promise<void> {
  const storageRef = ref(storage, `charts/${Date.now()}_${file.name}`)
  await uploadBytes(storageRef, new Blob([xmlContent], { type: 'application/xml' }))
  await addDoc(collection(db, 'charts'), {
    title: meta.title || file.name,
    composer: meta.composer,
    filename: file.name,
    storagePath: storageRef.fullPath,
    uploadedAt: Timestamp.now(),
    uploadedBy: uid,
  })
}

export function subscribeToCharts(cb: (charts: ChartDoc[]) => void): () => void {
  const q = query(collection(db, 'charts'), orderBy('uploadedAt', 'desc'))
  return onSnapshot(q, snap => {
    cb(
      snap.docs.map(d => ({
        id: d.id,
        ...(d.data() as Omit<ChartDoc, 'id' | 'uploadedAt'>),
        uploadedAt: (d.data().uploadedAt as Timestamp).toDate(),
      }))
    )
  })
}

export async function getChartXml(storagePath: string): Promise<string> {
  const blob = await getBlob(ref(storage, storagePath))
  return blob.text()
}

export async function deleteChart(id: string, storagePath: string): Promise<void> {
  await deleteDoc(doc(db, 'charts', id))
  await deleteObject(ref(storage, storagePath))
}
