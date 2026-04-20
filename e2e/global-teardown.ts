import { readFileSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ChildProcess } from 'node:child_process'
import type { MongoMemoryServer } from 'mongodb-memory-server'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STATE_FILE = resolve(__dirname, '.runtime', 'state.json')

function killPid(pid: number | undefined, label: string) {
  if (!pid) return
  try {
    process.kill(pid, 'SIGTERM')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ESRCH') {
      console.warn(`[teardown] ${label} pid ${pid} kill failed:`, err)
    }
  }
}

export default async function globalTeardown(): Promise<void> {
  const state = (globalThis as unknown as {
    __E2E_STATE__?: { mongo: MongoMemoryServer; emulator: ChildProcess; server: ChildProcess }
  }).__E2E_STATE__

  if (state) {
    state.server.kill('SIGTERM')
    state.emulator.kill('SIGTERM')
    await state.mongo.stop()
  } else {
    // Fallback: the setup process may have crashed before globalThis was populated,
    // or teardown may be running in a different worker. Read PIDs from disk.
    try {
      const raw = readFileSync(STATE_FILE, 'utf-8')
      const { emulatorPid, serverPid } = JSON.parse(raw) as {
        emulatorPid?: number
        serverPid?: number
      }
      killPid(serverPid, 'server')
      killPid(emulatorPid, 'emulator')
    } catch {
      // state file absent — nothing to clean up
    }
  }

  try {
    rmSync(STATE_FILE, { force: true })
  } catch {
    // best-effort
  }
}
