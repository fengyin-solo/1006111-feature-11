import { SEED_ROWS } from './seed'
import { DEFAULT_ALLOW_MM, OWNER_UNITS, leaderOf } from './ownership'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'shield-tunnel-construction:entries'
const VERSION_KEY = 'shield-tunnel-construction:version'
const STORAGE_VERSION = 2

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 解析带 mm 的沉降数值；老数据里的占位文字（如“建筑监测样例1”）一律视为无效。
function parseMm(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value !== 'string') {
    return null
  }
  const text = value.trim()
  if (!text) {
    return null
  }
  const matched = text.match(/^-?\d+(\.\d+)?/)
  if (!matched) {
    return null
  }
  const rest = text.slice(matched[0].length).trim().toLowerCase()
  if (rest && !/^mm$/.test(rest)) {
    return null
  }
  return Number(matched[0])
}

// 存量记录回填：按布点时间排序补全权属单位、监测负责人和新增字段，兼容老数据。
function backfillBuildingRows(rows: EntryRow[]): EntryRow[] {
  const sorted = [...rows].sort((a, b) => {
    const da = String(a['监测日期'] ?? a['布点时间'] ?? '')
    const db = String(b['监测日期'] ?? b['布点时间'] ?? '')
    if (da && db) return da < db ? -1 : da > db ? 1 : 0
    return Number(a.id) - Number(b.id)
  })
  return sorted.map((row) => {
    const next: EntryRow = { ...row }
    if (!next['权属单位']) {
      const fallback = OWNER_UNITS[(Number(next.id) - 1) % OWNER_UNITS.length]
      next['权属单位'] = fallback.name
    }
    if (!next['监测负责人']) {
      next['监测负责人'] = leaderOf(String(next['权属单位']))
    }
    const isPending = String(next.status) === '待布点'
    if (!next['布点时间']) {
      // 存量记录按布点时间回填：待布点的留空，其余沿用最早监测日期，没有就按序兜底。
      next['布点时间'] = isPending ? '' : String(next['监测日期'] ?? '2026-09-01')
    }
    if (!next['监测频次']) {
      next['监测频次'] = '1次/天'
    }
    if (parseMm(next['允许沉降']) === null) {
      next['允许沉降'] = `${DEFAULT_ALLOW_MM}mm`
    }
    if (parseMm(next['实测沉降']) === null) {
      next['实测沉降'] = isPending ? '' : '0mm'
    }
    if (!next['监测状态']) {
      next['监测状态'] = String(next.status ?? '待布点')
    }
    if (!next['权属轨迹']) {
      next['权属轨迹'] = `${next['权属单位']}（${next['布点时间'] || '历史布点'}起）`
    }
    return next
  }).sort((a, b) => Number(a.id) - Number(b.id))
}

function migrate(data: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  if (data.building) {
    data.building = backfillBuildingRows(data.building)
  }
  return data
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = migrate(clone(SEED_ROWS))
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    persist(fallback)
    return fallback
  }
  try {
    const parsed = migrate(JSON.parse(raw) as Record<string, EntryRow[]>)
    // 合并时新模块用种子补齐，但已有模块（含 building）保留浏览器里那份。
    const merged = { ...fallback, ...parsed }
    const version = Number(window.localStorage.getItem(VERSION_KEY) ?? '0')
    if (version < STORAGE_VERSION) {
      persist(merged)
    }
    return merged
  } catch {
    persist(fallback)
    return fallback
  }
}

// 整包原子写入：localStorage 抛错（配额/隐私模式）时不改动内存缓存，整条抽回。
function persist(next: Record<string, EntryRow[]>): boolean {
  if (typeof window === 'undefined' || !window.localStorage) {
    return true
  }
  const previous = window.localStorage.getItem(STORAGE_KEY)
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    window.localStorage.setItem(VERSION_KEY, String(STORAGE_VERSION))
    return true
  } catch {
    if (previous !== null) {
      window.localStorage.setItem(STORAGE_KEY, previous)
    }
    return false
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

// 返回是否落盘成功：失败时缓存与存储都回退到写入前，调用方据此拒收整次提交。
export function saveRows(key: string, rows: EntryRow[]): boolean {
  const before = allRows()
  const next = { ...before, [key]: rows }
  if (!persist(next)) {
    return false
  }
  cache = next
  return true
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  const migrated = key === 'building' ? backfillBuildingRows(rows) : rows
  saveRows(key, migrated)
  return migrated
}

export function storageKey(): string {
  return STORAGE_KEY
}
