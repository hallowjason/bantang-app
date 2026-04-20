import type { ChildProcess } from 'node:child_process'
import type { MongoMemoryServer } from 'mongodb-memory-server'

export default async function globalTeardown(): Promise<void> {
  const state = (globalThis as unknown as {
    __E2E_STATE__?: { mongo: MongoMemoryServer; emulator: ChildProcess; server: ChildProcess }
  }).__E2E_STATE__
  if (!state) return

  state.server.kill('SIGTERM')
  state.emulator.kill('SIGTERM')
  await state.mongo.stop()
}
