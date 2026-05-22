import { GoogleAuthProvider, signInWithPopup, signOut as fbSignOut, onAuthStateChanged, type User } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from './firebase'

const provider = new GoogleAuthProvider()

export function signInWithGoogle(): Promise<void> {
  return signInWithPopup(auth, provider).then(() => undefined)
}

export function signOut(): Promise<void> {
  return fbSignOut(auth)
}

export async function isUserAllowed(email: string): Promise<boolean> {
  const snap = await getDoc(doc(db, 'allowedUsers', email))
  return snap.exists()
}

export function onAuthChange(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, cb)
}
