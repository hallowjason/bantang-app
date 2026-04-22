import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../lib/firebase/config'
import {
  signInWithGoogle as firebaseSignIn,
  signOut as firebaseSignOut,
} from '../lib/firebase/auth'
import { apiFetch } from '../lib/api/client'
import type { AppUser, AuthContextType, UserRole } from '../types'

const AuthContext = createContext<AuthContextType | null>(null)

// Dev-only bypass: set VITE_DEV_USER in .env.local to skip Firebase auth.
// Never active in production builds (import.meta.env.DEV is false).
const DEV_USER: AppUser | null =
  import.meta.env.DEV && import.meta.env.VITE_DEV_USER
    ? (JSON.parse(import.meta.env.VITE_DEV_USER) as AppUser)
    : null

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(DEV_USER)
  const [loading, setLoading] = useState(!DEV_USER)

  useEffect(() => {
    if (DEV_USER) return   // bypass: skip Firebase subscription entirely

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null)
        setLoading(false)
        return
      }

      try {
        // Get ID token and fetch user profile from MongoDB via backend
        const token = await firebaseUser.getIdToken()

        // On first login, pass intentRole as a custom header so the backend
        // can create the user with the correct role
        const intentRole = localStorage.getItem('intentRole')
        if (intentRole) localStorage.removeItem('intentRole')

        const res = await fetch(
          `${import.meta.env.VITE_API_URL ?? 'http://localhost:3000'}/api/users/me`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
              // Pass intent role for first-login user creation
              ...(intentRole ? { 'x-intent-role': intentRole } : {}),
            },
          },
        )
        const body = await res.json()

        if (body.success) {
          const data = body.data
          setUser({
            uid: data.uid,
            name: data.name ?? firebaseUser.displayName ?? '',
            email: firebaseUser.email,
            photoURL: firebaseUser.photoURL,
            role: (data.role as UserRole) ?? 'leader',
            classId: data.classId ?? '',
          })
        }
      } catch (err) {
        console.error('Failed to load user profile:', err)
      }

      setLoading(false)
    })
    return unsubscribe
  }, [])

  /** Re-fetch user profile from backend (after role/class change) */
  const refreshUser = async () => {
    if (DEV_USER || !auth.currentUser) return
    try {
      const res = await apiFetch('/api/users/me')
      const body = await res.json()
      if (!body.success) return
      const data = body.data
      setUser(prev => prev ? {
        ...prev,
        role: (data.role as UserRole) ?? prev.role,
        classId: data.classId ?? prev.classId,
        name: data.name ?? prev.name,
      } : null)
    } catch (err) {
      console.error('Failed to refresh user:', err)
    }
  }

  const signInWithGoogle = async () => {
    await firebaseSignIn()
  }

  const signOut = async () => {
    await firebaseSignOut()
  }

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogle, signOut, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必須在 AuthProvider 內使用')
  return ctx
}
