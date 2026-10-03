import { listRows, saveRows } from './local-store'
import type { EntryRow } from './types'

// 巡检终端离线补录：现场把检查项目先暂存在本机，恢复网络后按站点和日期回放。
// 回放是幂等的——同一暂存记录（来源标识）或同一站点同一天的已确认结果都不会生成第二份台账。

const DRAFT_KEY = 'hydrology-monitor-station:inspection-drafts'
const LEGACY_KEY = 'hydrology-monitor-station:inspection-staging-legacy'

/** 巡检结果三类：空巡检、发现故障、已处置。 */
export type InspectionOutcome = '空巡检' | '发现故障' | '已处置'

/** 暂存同步状态：待同步 → 同步中（中断残留）→ 已同步 / 冲突跳过。 */
export type DraftSyncState = '待同步' | '同步中' | '已同步' | '冲突跳过'

export type InspectionDraft = {
  draftId: string
  stationCode: string
  inspectDate: string
  inspector: string
  checkItems: string
  foundIssue: string
  measure: string
  outcome: InspectionOutcome
  enteredAt: string
  syncState: DraftSyncState
  syncedRecordNo?: string
  skipReason?: string
}

export type AppliedOutcome =
  | { applied: true; recordId: number; recordNo: string }
  | { applied: false; reason: string }

export type ReplayItem = {
  draftId: string
  recordNo: string
  state: DraftSyncState
  message: string
}

export type ReplayReport = {
  items: ReplayItem[]
  inserted: number
  skipped: number
  interrupted: boolean
  message: string
}

export type InspectionView = {
  ledger: EntryRow[]
  faults: EntryRow[]
  pendingFaults: EntryRow[]
  handledFaults: EntryRow[]
  maintenanceTodos: EntryRow[]
  pendingTodos: EntryRow[]
  doneTodos: EntryRow[]
}

const OUTCOME_STATUS: Record<InspectionOutcome, string> = {
  空巡检: '已巡检',
  发现故障: '发现故障',
  已处置: '已处置',
}

// 本地开发示例：三类离线暂存数据各一条，回放前不进台账。
const SEED_DRAFTS: InspectionDraft[] = [
  {
    draftId: 'offline-1001',
    stationCode: 'STAT-0001',
    inspectDate: '2026-09-28',
    inspector: '王建国',
    checkItems: '水位计、雨量筒、供电系统、通信链路',
    foundIssue: '',
    measure: '',
    outcome: '空巡检',
    enteredAt: '2026-09-28 08:50',
    syncState: '待同步',
  },
  {
    draftId: 'offline-1002',
    stationCode: 'STAT-0002',
    inspectDate: '2026-09-29',
    inspector: '李志强',
    checkItems: '遥测终端机、太阳能板、蓄电池',
    foundIssue: '太阳能板接线端子松动，蓄电池充电中断',
    measure: '',
    outcome: '发现故障',
    enteredAt: '2026-09-29 11:20',
    syncState: '待同步',
  },
  {
    draftId: 'offline-1003',
    stationCode: 'STAT-0003',
    inspectDate: '2026-09-30',
    inspector: '赵海涛',
    checkItems: '缆道绞车、水位井、站房门窗、消防器材',
    foundIssue: '站房灭火器压力不足',
    measure: '已更换合格灭火器并登记台账',
    outcome: '已处置',
    enteredAt: '2026-09-30 14:05',
    syncState: '待同步',
  },
]

// 旧版暂存记录：升级时按录入日期迁移。其中 STAT-0003 在 2026-09-27 已有已处置确认结果，迁移回放不得覆盖。
const SEED_LEGACY_DRAFTS: InspectionDraft[] = [
  {
    draftId: 'legacy-0001',
    stationCode: 'STAT-0001',
    inspectDate: '2026-09-24',
    inspector: '王建国',
    checkItems: '雨量筒、围墙排水',
    foundIssue: '',
    measure: '',
    outcome: '空巡检',
    enteredAt: '2026-09-24 17:30',
    syncState: '待同步',
  },
  {
    draftId: 'legacy-0002',
    stationCode: 'STAT-0002',
    inspectDate: '2026-09-23',
    inspector: '李志强',
    checkItems: '遥测终端、通信天线',
    foundIssue: '通信天线馈线老化进水',
    measure: '',
    outcome: '发现故障',
    enteredAt: '2026-09-23 16:10',
    syncState: '待同步',
  },
  {
    draftId: 'legacy-0003',
    stationCode: 'STAT-0003',
    inspectDate: '2026-09-27',
    inspector: '旧终端补录',
    checkItems: '旧终端遗留：水位井、爬梯',
    foundIssue: '旧终端记录的问题描述',
    measure: '旧终端记录的处理描述',
    outcome: '发现故障',
    enteredAt: '2026-09-22 10:00',
    syncState: '待同步',
  },
]

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(fallback)
  }
  const raw = window.localStorage.getItem(key)
  if (raw === null) {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(key, JSON.stringify(value))
  }
}

let draftCache: InspectionDraft[] | null = null

export function listDrafts(): InspectionDraft[] {
  if (draftCache === null) {
    draftCache = readJson(DRAFT_KEY, SEED_DRAFTS)
  }
  return draftCache
}

function saveDrafts(drafts: InspectionDraft[]): void {
  draftCache = drafts
  writeJson(DRAFT_KEY, drafts)
}

/** 现场保存检查项目：先落本机暂存，等网络恢复再回放，不直接写台账。 */
export function saveDraft(input: {
  stationCode: string
  inspectDate: string
  inspector: string
  checkItems: string
  foundIssue: string
  measure: string
  outcome: InspectionOutcome
  enteredAt: string
}): InspectionDraft {
  const drafts = listDrafts()
  const seq = drafts.length + 1004
  const draft: InspectionDraft = {
    draftId: `offline-${seq}`,
    ...input,
    syncState: '待同步',
  }
  saveDrafts([...drafts, draft])
  return draft
}

function nextLedgerId(): number {
  return listRows('inspection').reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function nextRecordNo(): string {
  const max = listRows('inspection').reduce((maxValue, row) => {
    const matched = /^INSP-(\d+)$/.exec(String(row['记录编号'] ?? ''))
    return matched ? Math.max(maxValue, Number(matched[1])) : maxValue
  }, 0)
  return `INSP-${String(max + 1).padStart(4, '0')}`
}

/**
 * 把一条暂存应用进巡检台账，回放与旧数据迁移共用同一套幂等规则：
 * 1. 来源标识已存在 → 重复回放，不生成第二份记录；
 * 2. 同站点同日期已有已确认（已处置）结果 → 跳过，不覆盖确认结果；
 * 3. 同站点同日期已有其他记录 → 同样跳过并说明，保证站点+日期回放唯一。
 */
export function applyDraft(draft: InspectionDraft): AppliedOutcome {
  const rows = listRows('inspection')
  const existing = rows.find((row) => String(row['来源标识'] ?? '') === draft.draftId)
  if (existing) {
    return { applied: false, reason: '该暂存记录已回放，不重复生成台账' }
  }
  const sameSlot = rows.find(
    (row) =>
      String(row['站点编号'] ?? '') === draft.stationCode &&
      String(row['巡检日期'] ?? '') === draft.inspectDate,
  )
  if (sameSlot) {
    if (String(sameSlot.status) === '已处置') {
      return { applied: false, reason: '该站点当日已有已处置的确认结果，不覆盖' }
    }
    return { applied: false, reason: '该站点当日已存在巡检记录，不重复生成' }
  }

  const status = OUTCOME_STATUS[draft.outcome]
  const recordId = nextLedgerId()
  const recordNo = nextRecordNo()
  const row: EntryRow = {
    id: recordId,
    status,
    pending: status !== '已处置',
    abnormal: status === '发现故障',
    记录编号: recordNo,
    站点编号: draft.stationCode,
    巡检日期: draft.inspectDate,
    巡检人员: draft.inspector,
    检查项目: draft.checkItems,
    发现问题: draft.foundIssue,
    处理措施: draft.measure,
    巡检状态: status,
    巡检结果: draft.outcome,
    数据来源: '终端离线补录',
    来源标识: draft.draftId,
    录入时间: draft.enteredAt,
  }
  saveRows('inspection', [...rows, row])
  return { applied: true, recordId, recordNo }
}

export type ReplayFilter = { stationCode?: string; inspectDate?: string }

function matchFilter(draft: InspectionDraft, filter: ReplayFilter): boolean {
  if (filter.stationCode && filter.stationCode.trim() !== '') {
    if (!draft.stationCode.includes(filter.stationCode.trim())) return false
  }
  if (filter.inspectDate && filter.inspectDate.trim() !== '') {
    if (draft.inspectDate !== filter.inspectDate.trim()) return false
  }
  return true
}

/**
 * 按站点和日期回放暂存记录。只处理未完成（待同步/中断残留的同步中）的记录，
 * 已同步与冲突跳过的不会再处理；处理顺序按录入时间从早到晚。
 * maxApplied 用来模拟现场中断：处理够指定条数后停下，下次从未同步的记录继续。
 */
export function replayDrafts(filter: ReplayFilter = {}, maxApplied?: number): ReplayReport {
  const drafts = listDrafts()
  const items: ReplayItem[] = []
  let inserted = 0
  let skipped = 0
  let processed = 0
  let interrupted = false

  const next = drafts.map((draft) => ({ ...draft }))
  for (const draft of next) {
    if (interrupted) break
    if (draft.syncState === '已同步' || draft.syncState === '冲突跳过') continue
    if (!matchFilter(draft, filter)) continue
    if (maxApplied !== undefined && processed >= maxApplied) {
      interrupted = true
      break
    }

    const index = next.findIndex((item) => item.draftId === draft.draftId)
    next[index] = { ...draft, syncState: '同步中' }
    saveDrafts(next)

    const outcome = applyDraft(draft)
    if (outcome.applied) {
      next[index] = { ...draft, syncState: '已同步', syncedRecordNo: outcome.recordNo }
      items.push({ draftId: draft.draftId, recordNo: outcome.recordNo, state: '已同步', message: '已写入巡检台账' })
      inserted += 1
    } else {
      next[index] = { ...draft, syncState: '冲突跳过', skipReason: outcome.reason }
      items.push({ draftId: draft.draftId, recordNo: '', state: '冲突跳过', message: outcome.reason })
      skipped += 1
    }
    processed += 1
    saveDrafts(next)
  }

  saveDrafts(next)
  const message = interrupted
    ? `回放中断：已处理 ${processed} 条（新增 ${inserted}、跳过 ${skipped}），恢复后可从未同步记录继续`
    : `回放完成：新增 ${inserted} 条，跳过 ${skipped} 条`
  return { items, inserted, skipped, interrupted, message }
}

export type MigrationReport = {
  items: ReplayItem[]
  migrated: number
  skipped: number
  message: string
}

/** 旧暂存记录按录入日期迁移：录入时间从早到晚逐条回放，已确认结果不会被覆盖；迁移后清空旧暂存区。 */
export function migrateLegacyDrafts(): MigrationReport {
  const legacy = readJson<InspectionDraft[]>(LEGACY_KEY, SEED_LEGACY_DRAFTS)
  const ordered = [...legacy].sort((a, b) => a.enteredAt.localeCompare(b.enteredAt))
  const items: ReplayItem[] = []
  let migrated = 0
  let skipped = 0
  for (const draft of ordered) {
    const outcome = applyDraft(draft)
    if (outcome.applied) {
      items.push({ draftId: draft.draftId, recordNo: outcome.recordNo, state: '已同步', message: '旧暂存已迁移并写入台账' })
      migrated += 1
    } else {
      items.push({ draftId: draft.draftId, recordNo: '', state: '冲突跳过', message: outcome.reason })
      skipped += 1
    }
  }
  writeJson(LEGACY_KEY, [])
  return {
    items,
    migrated,
    skipped,
    message: `旧暂存迁移完成：迁移 ${migrated} 条，跳过 ${skipped} 条（按录入日期排序，已确认结果未覆盖）`,
  }
}

export function legacyDraftCount(): number {
  return readJson<InspectionDraft[]>(LEGACY_KEY, SEED_LEGACY_DRAFTS).length
}

/**
 * 台账、故障清单、站房维护待办的统一数据视图：都来自回放后的同一批巡检记录，
 * 任何模块读故障台账都调这里，避免回放前后各读各的。
 */
export function inspectionView(filter: ReplayFilter = {}): InspectionView {
  const ledger = listRows('inspection').filter((row) => {
    if (filter.stationCode && filter.stationCode.trim() !== '') {
      if (!String(row['站点编号'] ?? '').includes(filter.stationCode.trim())) return false
    }
    if (filter.inspectDate && filter.inspectDate.trim() !== '') {
      if (String(row['巡检日期'] ?? '') !== filter.inspectDate.trim()) return false
    }
    return true
  })
  const faults = ledger.filter((row) => ['发现故障', '已处置'].includes(String(row.status)))
  const pendingFaults = ledger.filter((row) => String(row.status) === '发现故障')
  const handledFaults = ledger.filter((row) => String(row.status) === '已处置')
  // 站房维护待办：发现故障即生成待办，处置完成后转为已办结。
  const maintenanceTodos = faults.map((row) => ({ ...row }))
  const pendingTodos = pendingFaults.map((row) => ({ ...row }))
  const doneTodos = handledFaults.map((row) => ({ ...row }))
  return { ledger, faults, pendingFaults, handledFaults, maintenanceTodos, pendingTodos, doneTodos }
}

/** 供别的模块读取的故障台账：就是回放后巡检结果里的故障部分。 */
export function faultLedger(stationCode?: string): EntryRow[] {
  return inspectionView(stationCode ? { stationCode } : {}).faults
}

/** 本地开发：重置暂存区与旧数据，重新播种三类示例，方便反复演示回放。 */
export function resetOfflineDrafts(): void {
  draftCache = null
  writeJson(DRAFT_KEY, clone(SEED_DRAFTS))
  writeJson(LEGACY_KEY, clone(SEED_LEGACY_DRAFTS))
  draftCache = clone(SEED_DRAFTS)
}
