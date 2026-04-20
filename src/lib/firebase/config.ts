import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)

// E2E-only: connect to Firebase Auth Emulator when env is set. Dev + test builds only.
const emulatorHost = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST
if (emulatorHost && import.meta.env.DEV) {
  connectAuthEmulator(auth, `http://${emulatorHost}`, { disableWarnings: true })
}

export default app
