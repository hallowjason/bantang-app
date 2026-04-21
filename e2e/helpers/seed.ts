const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3101'

export interface SeedMember {
  id: string
  name: string
  regionUnit?: string
  regionNumber?: string
}

async function postJson(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`POST ${path} failed: ${res.status} ${await res.text()}`)
  }
}

export async function seedClass(
  classId: string,
  name: string,
  opts: { leaderIds?: string[]; iccfClassCode?: string } = {},
): Promise<void> {
  await postJson('/api/_test/seed-class', { classId, name, ...opts })
}

export async function seedMembers(classId: string, members: SeedMember[]): Promise<void> {
  await postJson('/api/_test/seed-members', { classId, members })
}

export async function resetSession(classId: string, date: string): Promise<void> {
  await postJson('/api/_test/reset-session', { classId, date })
}

/** Convenience: unique classId per test invocation. */
export function uniqueClassId(prefix = 'e2e-atd'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
