import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MongoMemoryServer } from 'mongodb-memory-server'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RUNTIME_DIR = resolve(__dirname, '.runtime')
const STATE_FILE = resolve(RUNTIME_DIR, 'state.json')

let mongo: MongoMemoryServer
let emulatorProc: ChildProcess
let serverProc: ChildProcess

async function waitFor(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // keep polling
    }
    await new Promise(r => setTimeout(r, 300))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

export default async function globalSetup(): Promise<void> {
  mkdirSync(RUNTIME_DIR, { recursive: true })

  // 1. Mongo Memory Server
  mongo = await MongoMemoryServer.create()
  const mongoUri = mongo.getUri()

  // 2. Firebase Auth Emulator
  const emulatorHost = 'localhost:9099'
  emulatorProc = spawn(
    'npx',
    ['firebase', 'emulators:start', '--only', 'auth', '--project', 'bantang-e2e'],
    {
      cwd: resolve(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    },
  )
  emulatorProc.stdout?.on('data', d => process.stdout.write(`[emu] ${d}`))
  emulatorProc.stderr?.on('data', d => process.stderr.write(`[emu] ${d}`))
  await waitFor(`http://${emulatorHost}/`)

  // 3. Backend (bantang-server)
  const serverEnv = {
    ...process.env,
    MONGODB_URI: mongoUri,
    FIREBASE_AUTH_EMULATOR_HOST: emulatorHost,
    GCLOUD_PROJECT: 'bantang-e2e',
    PORT: '3101',
    FRONTEND_URL: 'http://localhost:5174',
    NODE_ENV: 'test',
  }
  serverProc = spawn('npm', ['--prefix', 'server', 'run', 'dev'], {
    cwd: resolve(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: serverEnv,
  })
  serverProc.stdout?.on('data', d => process.stdout.write(`[srv] ${d}`))
  serverProc.stderr?.on('data', d => process.stderr.write(`[srv] ${d}`))
  await waitFor('http://localhost:3101/ready')

  // Persist handles for teardown
  writeFileSync(
    STATE_FILE,
    JSON.stringify({
      mongoUri,
      emulatorHost,
      apiUrl: 'http://localhost:3101',
      emulatorPid: emulatorProc.pid,
      serverPid: serverProc.pid,
    }),
  )
  // Keep references alive by stashing on globalThis (accessible in teardown same process)
  ;(globalThis as unknown as {
    __E2E_STATE__: { mongo: MongoMemoryServer; emulator: ChildProcess; server: ChildProcess }
  }).__E2E_STATE__ = { mongo, emulator: emulatorProc, server: serverProc }
}
