import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { signInWithE2EToken } from './lib/firebase/auth'
import './index.css'
import App from './App.tsx'

// E2E bootstrap: if ?e2e_token is present (dev + Auth Emulator only), sign in
// before React mounts so AuthProvider observes an authenticated user immediately.
async function bootstrap() {
  const params = new URLSearchParams(window.location.search)
  const e2eToken = params.get('e2e_token')
  if (e2eToken && import.meta.env.DEV && import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST) {
    try {
      await signInWithE2EToken(e2eToken)
    } catch (err) {
      console.error('E2E sign-in failed', err)
    }
    params.delete('e2e_token')
    const qs = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </StrictMode>,
  )
}

bootstrap()
