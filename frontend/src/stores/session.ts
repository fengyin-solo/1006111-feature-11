import { defineStore } from 'pinia'

import {
  ADMIN_NAME,
  OWNER_UNITS,
  PLATFORM_UNIT,
  SUPERVISOR_NAME,
  SUPERVISOR_UNIT,
  getOwnerUnit,
} from '@/data/ownership'

export type RoleCode = 'leader' | 'member' | 'supervisor' | 'admin'

export const ROLE_LABELS: Record<RoleCode, string> = {
  leader: '权属单位监测负责人',
  member: '权属单位监测员',
  supervisor: '监理（只读）',
  admin: '值班管理员',
}

type Identity = {
  role: RoleCode
  unit: string
  name: string
}

function identityOf(role: RoleCode, unitName: string): Identity {
  switch (role) {
    case 'leader': {
      const unit = getOwnerUnit(unitName) ?? OWNER_UNITS[0]
      return { role, unit: unit.name, name: unit.leader }
    }
    case 'member': {
      const unit = getOwnerUnit(unitName) ?? OWNER_UNITS[0]
      return { role, unit: unit.name, name: unit.member }
    }
    case 'supervisor':
      return { role, unit: SUPERVISOR_UNIT, name: SUPERVISOR_NAME }
    case 'admin':
      return { role, unit: PLATFORM_UNIT, name: ADMIN_NAME }
  }
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    shiftLabel: '白班 08:00-20:00',
    scope: '盾构隧道掘进施工管理平台',
    role: 'leader' as RoleCode,
    unit: OWNER_UNITS[0].name,
    name: OWNER_UNITS[0].leader,
  }),
  getters: {
    operator: (state): string => state.name,
    canOperate: (state): boolean => state.role !== 'supervisor',
    isSupervisor: (state): boolean => state.role === 'supervisor',
    isAdmin: (state): boolean => state.role === 'admin',
    isLeader: (state): boolean => state.role === 'leader',
    identity(state): Identity {
      return identityOf(state.role, state.unit)
    },
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    // 切换身份/权属单位：监理与管理员的单位是固定的，不随选择器走。
    switchIdentity(role: RoleCode, unitName: string) {
      const next = identityOf(role, unitName)
      this.role = next.role
      this.unit = next.unit
      this.name = next.name
    },
  },
})
