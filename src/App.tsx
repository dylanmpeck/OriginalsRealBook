import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { onAuthChange, isUserAllowed, signOut } from './lib/auth'
import AuthGate from './components/AuthGate'
import LibraryView from './components/LibraryView'
import ChartViewer from './components/ChartViewer'
import './App.css'

export interface Chart {
  name: string
  xmlContent: string
}

type AuthStatus = 'loading' | 'unauthenticated' | 'unauthorized' | 'authorized'

export default function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<User | null>(null)
  const [chart, setChart] = useState<Chart | null>(null)

  useEffect(() => {
    return onAuthChange(async u => {
      if (!u) {
        setUser(null)
        setChart(null)
        setAuthStatus('unauthenticated')
        return
      }
      const allowed = await isUserAllowed(u.email ?? '')
      setUser(u)
      setAuthStatus(allowed ? 'authorized' : 'unauthorized')
    })
  }, [])

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <h1 className="logo">iRealB</h1>
          <span className="logo-sub">Chart Viewer</span>
        </div>
        {user && (
          <div className="header-user">
            <span className="user-email">{user.email}</span>
            <button className="btn-signout" onClick={() => signOut()}>Sign out</button>
          </div>
        )}
      </header>

      <main className="app-main">
        {authStatus === 'loading' && (
          <div className="app-loading"><div className="spinner" /></div>
        )}

        {authStatus === 'unauthenticated' && <AuthGate />}

        {authStatus === 'unauthorized' && (
          <div className="access-denied">
            <p>Access denied.</p>
            <p className="access-denied-sub">
              Your account hasn't been added to the allowlist. Contact the app admin.
            </p>
            <button className="btn-back" onClick={() => signOut()}>Sign out</button>
          </div>
        )}

        {authStatus === 'authorized' && user && !chart && (
          <LibraryView user={user} onOpen={setChart} />
        )}

        {authStatus === 'authorized' && chart && (
          <div className="viewer-layout">
            <div className="viewer-toolbar">
              <button className="btn-back" onClick={() => setChart(null)}>← Library</button>
              <span className="chart-title">{chart.name}</span>
            </div>
            <ChartViewer chart={chart} />
          </div>
        )}
      </main>
    </div>
  )
}
