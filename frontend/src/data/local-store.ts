import { reconcileTables, SETTLEMENT_KEY, BUILDING_KEY } from './monitoring'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'shield-tunnel-construction:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function todayLabel(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seeded = reconcileTables(fallback, todayLabel()).tables
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    // 兼容老数据：示例字段缺失也不丢，合并后统一做一次回填 + 报警同源对账。
    const merged = { ...clone(SEED_ROWS), ...parsed }
    const { tables, changed } = reconcileTables(merged, todayLabel())
    if (changed) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tables))
    }
    return tables
  } catch {
    const seeded = reconcileTables(fallback, todayLabel()).tables
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

// 只写内存缓存，不碰 localStorage：commitTables 前任何一步出错都不会留下半截数据。
function stageTables(patch: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  return { ...allRows(), ...clone(patch) }
}

// 一次性原子提交多张表：序列化或写 localStorage 失败就抛错，调用方整条抽回，旧缓存保持不变。
export function commitTables(patch: Record<string, EntryRow[]>): void {
  const next = stageTables(patch)
  if (typeof window !== 'undefined' && window.localStorage) {
    // 先序列化验证（写失败演练），成功后才动缓存，保证「写失败就整条抽回」。
    const serialized = JSON.stringify(next)
    window.localStorage.setItem(STORAGE_KEY, serialized)
  }
  cache = next
}

export function saveRows(key: string, rows: EntryRow[]): void {
  commitTables({ [key]: rows })
}

// 业务写动作统一走这个钩子：写完建筑监测后顺带把报警台账对账到地表沉降，两处同源。
export function commitBuildingTables(
  buildings: EntryRow[],
  settlementRows: EntryRow[],
): void {
  commitTables({ [BUILDING_KEY]: buildings, [SETTLEMENT_KEY]: settlementRows })
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
