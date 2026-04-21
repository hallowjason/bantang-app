import type { UserRole } from '../../src/types'

export interface TestUser {
  uid: string
  email: string
  name: string
  role: UserRole
  classId?: string
}

export const TEST_USERS: Record<string, TestUser> = {
  leader: {
    uid: 'e2e-leader-001',
    email: 'leader@e2e.test',
    name: 'E2E 領班',
    role: 'leader',
  },
  headLeader: {
    uid: 'e2e-head-001',
    email: 'head@e2e.test',
    name: 'E2E 大領班',
    role: 'head_leader',
  },
  classMaster: {
    uid: 'e2e-master-001',
    email: 'master@e2e.test',
    name: 'E2E 主班',
    role: 'class_master',
  },
  juniorLeader: {
    uid: 'e2e-junior-001',
    email: 'junior@e2e.test',
    name: 'E2E 小班長',
    role: 'junior_leader',
  },
}
