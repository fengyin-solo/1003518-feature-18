import { listRows, resetRows, saveRows } from './local-store'
import { SEED_INSPECTION_DRAFTS } from './seed'
import type {
  ActionResult,
  EntryRow,
  InspectionDraft,
  InspectionResultKind,
} from './types'

// 巡检终端离线补录：现场把检查项目暂存在本机，恢复网络后按站点和日期回放。
// 台账（inspection）、故障清单、站房维护待办都回放这同一批数据，不另存第二份。

const INSPECTION_KEY = 'inspection'
const STATIONHOUSE_KEY = 'stationhouse'
const DRAFT_STORAGE_KEY = 'hydrology-monitor-station:inspection-drafts'
const MIGRATION_FLAG = 'hydrology-monitor-station:inspection-drafts-v2'

// 现场结果 -> 台账巡检状态
const RESULT_STATUS: Record<InspectionResultKind, string> = {
  empty: '已巡检',
  fault: '发现故障',
  handled: '已处置',
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function businessKey(stationCode: string, inspectDate: string): string {
  return `${stationCode.trim()}@${inspectDate.trim()}`
}

function draftKey(draft: InspectionDraft): string {
  return businessKey(draft.stationCode, draft.inspectDate)
}

function rowBusinessKey(row: EntryRow): string {
  return businessKey(String(row['站点编号'] ?? ''), String(row['巡检日期'] ?? ''))
}

// 台账里已确认的结果：已巡检 / 发现故障 / 已处置。待巡检只是计划槽位，可以被补录占用。
function isConfirmedStatus(status: string): boolean {
  return status === '已巡检' || status === '发现故障' || status === '已处置'
}

let draftCache: InspectionDraft[] | null = null

// 旧版本终端把暂存存在通用台账键里（v1）：首次进入新版本时按录入日期迁到独立暂存键，
// 迁完打标记，重复刷新不会再迁第二次。
function migrateLegacyDrafts(): InspectionDraft[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(SEED_INSPECTION_DRAFTS)
  }
  if (!window.localStorage.getItem(MIGRATION_FLAG)) {
    const legacyRaw = window.localStorage.getItem('hydrology-monitor-station:entries')
    if (legacyRaw) {
      try {
        const legacy = JSON.parse(legacyRaw) as Record<string, EntryRow[]>
        const existing = readDrafts()
        const legacyIds = new Set(existing.map((draft) => draft.draftId))
        const legacyDrafts = (legacy.offlineInspection ?? [])
          .map((row) => {
            const draft: InspectionDraft = {
              draftId: `legacy-${String(row.id)}`,
              stationCode: String(row['站点编号'] ?? ''),
              inspectDate: String(row['巡检日期'] ?? ''),
              inspector: String(row['巡检人员'] ?? ''),
              checkItems: String(row['检查项目'] ?? ''),
              foundIssue: String(row['发现问题'] ?? ''),
              handleMeasure: String(row['处理措施'] ?? ''),
              result: 'empty',
              entryDate: String(row['录入日期'] ?? row['巡检日期'] ?? ''),
              synced: false,
            }
            const status = String(row.status ?? '')
            if (status === '发现故障') draft.result = 'fault'
            if (status === '已处置') draft.result = 'handled'
            return draft
          })
          .filter((draft) => !legacyIds.has(draft.draftId))
        if (legacyDrafts.length > 0) {
          persistDrafts([...listDrafts(), ...legacyDrafts])
        }
      } catch {
        // 旧数据损坏时直接忽略，走种子数据
      }
    }
    window.localStorage.setItem(MIGRATION_FLAG, '1')
  }
  return readDrafts()
}

function readDrafts(): InspectionDraft[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(SEED_INSPECTION_DRAFTS)
  }
  const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY)
  let drafts: InspectionDraft[]
  if (!raw) {
    drafts = clone(SEED_INSPECTION_DRAFTS)
  } else {
    try {
      drafts = JSON.parse(raw) as InspectionDraft[]
    } catch {
      drafts = clone(SEED_INSPECTION_DRAFTS)
    }
  }
  // 旧终端暂存没有录入日期：按巡检日期补录为录入日期后落盘，回放按它排队，这一步只做一次
  let backfilled = false
  for (const draft of drafts) {
    if (!draft.entryDate) {
      draft.entryDate = draft.inspectDate
      backfilled = true
    }
  }
  if (backfilled || !raw) {
    persistDrafts(drafts)
  }
  return drafts
}

function persistDrafts(drafts: InspectionDraft[]): void {
  draftCache = drafts
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(drafts))
  }
}

// 内部使用：直接拿缓存数组，回放时在缓存内定位单条做原地更新
function draftCacheList(): InspectionDraft[] {
  if (draftCache === null) {
    draftCache = migrateLegacyDrafts()
  }
  return draftCache
}

export function listDrafts(): InspectionDraft[] {
  return clone(draftCacheList())
}

export function pendingDrafts(): InspectionDraft[] {
  return draftCacheList()
    .filter((draft) => !draft.synced && !draft.conflictSkipped)
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate))
    .map((draft) => clone(draft))
}

export type DraftInput = {
  stationCode: string
  inspectDate: string
  inspector: string
  checkItems: string
  foundIssue?: string
  handleMeasure?: string
  result: InspectionResultKind
  entryDate?: string
}

// 现场保存检查项目。同一站点同一天只保留一条暂存（重复保存覆盖，不产生两条）。
export function saveDraft(input: DraftInput): ActionResult & { draftId?: string } {
  const stationCode = input.stationCode.trim()
  const inspectDate = input.inspectDate.trim()
  if (!stationCode) {
    return { ok: false, message: '站点编号不能为空' }
  }
  if (!inspectDate) {
    return { ok: false, message: '巡检日期不能为空' }
  }
  if (!input.checkItems.trim()) {
    return { ok: false, message: '检查项目不能为空' }
  }
  const drafts = draftCacheList()
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  const entryDate =
    input.entryDate ??
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(
      now.getHours(),
    )}:${pad(now.getMinutes())}`
  const existing = drafts.find(
    (draft) => !draft.synced && draftKey(draft) === businessKey(stationCode, inspectDate),
  )
  if (existing) {
    existing.inspector = input.inspector.trim()
    existing.checkItems = input.checkItems.trim()
    existing.foundIssue = input.foundIssue?.trim() ?? ''
    existing.handleMeasure = input.handleMeasure?.trim() ?? ''
    existing.result = input.result
    persistDrafts([...drafts])
    return { ok: true, message: '已更新本机同站点同日期的暂存记录', draftId: existing.draftId }
  }
  const draft: InspectionDraft = {
    draftId: `draft-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    stationCode,
    inspectDate,
    inspector: input.inspector.trim(),
    checkItems: input.checkItems.trim(),
    foundIssue: input.foundIssue?.trim() ?? '',
    handleMeasure: input.handleMeasure?.trim() ?? '',
    result: input.result,
    entryDate,
    synced: false,
  }
  persistDrafts([...drafts, draft])
  return { ok: true, message: '检查项目已暂存到巡检终端，恢复网络后可回放', draftId: draft.draftId }
}

function nextLedgerId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function buildLedgerRow(draft: InspectionDraft, id: number, existing?: EntryRow): EntryRow {
  const status = RESULT_STATUS[draft.result]
  // 占用已有的待巡检计划槽位时沿用原记录编号；新增台账记录用 INSP-日期 编号。
  const existingCode = existing ? String(existing['记录编号'] ?? '') : ''
  const recordCode =
    existingCode || `INSP-${draft.inspectDate.replace(/-/g, '')}`
  return {
    ...(existing ?? {}),
    id,
    status,
    pending: status !== '已处置',
    abnormal: status === '发现故障',
    记录编号: recordCode,
    站点编号: draft.stationCode,
    巡检日期: draft.inspectDate,
    巡检人员: draft.inspector || '巡检终端补录',
    检查项目: draft.checkItems,
    发现问题: draft.foundIssue,
    处理措施: draft.handleMeasure,
    巡检状态: status,
    数据来源: '离线回放',
  }
}

// 发现故障的巡检回放后在站房维护待办里挂一条维修待办；已处置不生成待办。
function upsertStationhouseTodo(draft: InspectionDraft, recordCode: string): boolean {
  const todos = listRows(STATIONHOUSE_KEY)
  const sourceRef = `巡检:${businessKey(draft.stationCode, draft.inspectDate)}`
  if (todos.some((row) => String(row['来源单号'] ?? '') === sourceRef)) {
    return false
  }
  const todo: EntryRow = {
    id: nextLedgerId(todos),
    status: '待安排',
    pending: true,
    abnormal: false,
    记录编号: `MAINT-INSP-${draft.inspectDate.replace(/-/g, '')}`,
    站点编号: draft.stationCode,
    维护类型: '巡检故障维修',
    维护内容: draft.foundIssue || draft.checkItems,
    维护单位: '待安排',
    维护日期: draft.inspectDate,
    费用支出: 0,
    维护状态: '待安排',
    来源单号: sourceRef,
    关联巡检: recordCode,
  }
  saveRows(STATIONHOUSE_KEY, [...todos, todo])
  return true
}

export type ReplayFilter = {
  stationCode?: string
  inspectDate?: string
}

export type ReplayOutcome =
  | 'created' // 新写入一条台账记录
  | 'filled-planned' // 占用了原待巡检计划槽位
  | 'conflict-skipped' // 命中已确认结果，跳过不覆盖
  | 'already-synced' // 重复回放：幂等跳过，不生成第二份

export type ReplayItem = {
  draft: InspectionDraft
  outcome: ReplayOutcome
  recordCode?: string
}

export type ReplayResult = {
  items: ReplayItem[]
  created: number
  filledPlanned: number
  conflictSkipped: number
  alreadySynced: number
  todosCreated: number
  interrupted: boolean
  remaining: number
}

// 恢复网络后回放：按站点和日期筛选暂存，按录入日期从早到晚依次入库。
// maxProcessed 用于演示「中断后续传」：中断时未处理的暂存保持未同步，下次从未同步记录继续。
export function replayDrafts(filter: ReplayFilter = {}, maxProcessed?: number): ReplayResult {
  const stationCode = filter.stationCode?.trim() ?? ''
  const inspectDate = filter.inspectDate?.trim() ?? ''
  const queue = pendingDrafts().filter((draft) => {
    if (stationCode && draft.stationCode !== stationCode) return false
    if (inspectDate && draft.inspectDate !== inspectDate) return false
    return true
  })

  const result: ReplayResult = {
    items: [],
    created: 0,
    filledPlanned: 0,
    conflictSkipped: 0,
    alreadySynced: 0,
    todosCreated: 0,
    interrupted: false,
    remaining: 0,
  }

  let processed = 0
  for (const draft of queue) {
    if (typeof maxProcessed === 'number' && processed >= maxProcessed) {
      // 中断：剩下的暂存不动，已处理的每条都已即时落盘，下次从未同步记录继续
      result.interrupted = true
      break
    }

    const cache = draftCacheList()
    const stored = cache.find((item) => item.draftId === draft.draftId)
    if (!stored) {
      continue
    }
    if (stored.synced) {
      result.items.push({ draft: clone(stored), outcome: 'already-synced', recordCode: stored.recordCode })
      result.alreadySynced += 1
      processed += 1
      continue
    }

    const ledger = listRows(INSPECTION_KEY)
    const matched = ledger.find((row) => rowBusinessKey(row) === draftKey(stored))
    if (matched && isConfirmedStatus(String(matched.status))) {
      // 已确认结果不覆盖：暂存标记为冲突跳过，保留台账原结果
      stored.conflictSkipped = true
      persistDrafts([...cache])
      result.items.push({
        draft: clone(stored),
        outcome: 'conflict-skipped',
        recordCode: String(matched['记录编号'] ?? ''),
      })
      result.conflictSkipped += 1
      processed += 1
      continue
    }

    let outcome: ReplayOutcome
    let recordId: number
    let recordCode: string
    if (matched) {
      // 待巡检槽位：用现场结果补全，沿用原编号
      recordId = Number(matched.id)
      const updated = buildLedgerRow(stored, recordId, matched)
      recordCode = String(updated['记录编号'])
      const next = ledger.map((row) => (Number(row.id) === recordId ? updated : row))
      saveRows(INSPECTION_KEY, next)
      outcome = 'filled-planned'
      result.filledPlanned += 1
    } else {
      recordId = nextLedgerId(ledger)
      const row = buildLedgerRow(stored, recordId)
      recordCode = String(row['记录编号'])
      saveRows(INSPECTION_KEY, [...ledger, row])
      outcome = 'created'
      result.created += 1
    }

    if (stored.result === 'fault') {
      if (upsertStationhouseTodo(stored, recordCode)) {
        result.todosCreated += 1
      }
    }

    stored.synced = true
    stored.syncedAt = new Date().toISOString()
    stored.recordCode = recordCode
    stored.ledgerId = recordId
    persistDrafts([...cache])

    result.items.push({ draft: clone(stored), outcome, recordCode })
    processed += 1
  }

  result.remaining = pendingDrafts().filter((draft) => {
    if (stationCode && draft.stationCode !== stationCode) return false
    if (inspectDate && draft.inspectDate !== inspectDate) return false
    return true
  }).length
  return result
}

export type UnifiedInspectionRow = EntryRow & {
  数据来源: string
  同步状态: string
}

// 台账、故障清单、站房待办共用的同一批巡检数据：
// 已回放的以台账为准；尚未回放的暂存以「离线暂存（待回放）」形态并入，不与台账重复。
export function unifiedInspectionRows(): UnifiedInspectionRow[] {
  const ledger = listRows(INSPECTION_KEY)
  const pending = pendingDrafts()

  const rows: UnifiedInspectionRow[] = ledger.map((row) => ({
    ...row,
    数据来源: String(row['数据来源'] ?? '在线登记'),
    同步状态: '已入库',
  }))

  for (const draft of pending) {
    // 台账里已有待巡检槽位：投影直接以暂存内容展示，避免同站点同日期出现两行
    const planned = rows.find(
      (row) =>
        rowBusinessKey(row) === draftKey(draft) && !isConfirmedStatus(String(row.status)),
    )
    const status = RESULT_STATUS[draft.result]
    const virtual: UnifiedInspectionRow = {
      id: hashDraftId(draft.draftId),
      status,
      pending: status !== '已处置',
      abnormal: draft.result === 'fault',
      记录编号: planned ? String(planned['记录编号'] ?? '') : `暂存-${draft.draftId.slice(-6)}`,
      站点编号: draft.stationCode,
      巡检日期: draft.inspectDate,
      巡检人员: draft.inspector || '巡检终端',
      检查项目: draft.checkItems,
      发现问题: draft.foundIssue,
      处理措施: draft.handleMeasure,
      巡检状态: status,
      数据来源: '离线暂存',
      同步状态: '待回放',
    }
    if (planned) {
      const index = rows.indexOf(planned)
      rows[index] = virtual
    } else {
      rows.push(virtual)
    }
  }

  return rows.sort((a, b) =>
    String(b['巡检日期'] ?? '').localeCompare(String(a['巡检日期'] ?? '')),
  )
}

function hashDraftId(draftId: string): number {
  let hash = 0
  for (let i = 0; i < draftId.length; i += 1) {
    hash = (hash << 5) - hash + draftId.charCodeAt(i)
    hash |= 0
  }
  // 保持负数也能作 key，前端列表只做展示
  return Math.abs(hash) + 10_000_000
}

export type FaultListItem = {
  id: number | string
  recordCode: string
  stationCode: string
  inspectDate: string
  inspector: string
  issue: string
  measure: string
  status: string
  source: string
  syncState: string
  todoRecordCode?: string
}

// 故障清单：从同一批巡检数据投影，状态为「发现故障」的记录（含待回放暂存）。
export function inspectionFaultList(): FaultListItem[] {
  const todos = listRows(STATIONHOUSE_KEY)
  return unifiedInspectionRows()
    .filter((row) => String(row.status) === '发现故障')
    .map((row) => {
      const key = businessKey(String(row['站点编号'] ?? ''), String(row['巡检日期'] ?? ''))
      const todo = todos.find((item) => String(item['来源单号'] ?? '') === `巡检:${key}`)
      return {
        id: row.id,
        recordCode: String(row['记录编号'] ?? ''),
        stationCode: String(row['站点编号'] ?? ''),
        inspectDate: String(row['巡检日期'] ?? ''),
        inspector: String(row['巡检人员'] ?? ''),
        issue: String(row['发现问题'] ?? ''),
        measure: String(row['处理措施'] ?? ''),
        status: String(row.status),
        source: String(row['数据来源'] ?? ''),
        syncState: String(row['同步状态'] ?? ''),
        todoRecordCode: todo ? String(todo['记录编号'] ?? '') : undefined,
      }
    })
}

export type StationhouseTodo = EntryRow & { 同步状态: string }

// 站房维护待办读取同一批巡检数据：回放后读真实待办，回放前故障暂存以待回放待办形态预览。
export function stationhouseTodos(): StationhouseTodo[] {
  const todos: StationhouseTodo[] = listRows(STATIONHOUSE_KEY).map((row) => ({
    ...row,
    同步状态: String(row['来源单号'] ?? '').startsWith('巡检:') ? '巡检回放' : '手工登记',
  }))
  const knownKeys = new Set(
    todos.map((row) => String(row['来源单号'] ?? '').replace(/^巡检:/, '')),
  )
  for (const draft of pendingDrafts()) {
    if (draft.result !== 'fault') continue
    if (knownKeys.has(draftKey(draft))) continue
    todos.push({
      id: hashDraftId(`todo-${draft.draftId}`),
      status: '待安排',
      pending: true,
      abnormal: false,
      记录编号: `待回放-${draft.draftId.slice(-6)}`,
      站点编号: draft.stationCode,
      维护类型: '巡检故障维修',
      维护内容: draft.foundIssue || draft.checkItems,
      维护单位: '待安排',
      维护日期: draft.inspectDate,
      费用支出: 0,
      维护状态: '待安排',
      来源单号: `巡检:${draftKey(draft)}`,
      关联巡检: `暂存-${draft.draftId.slice(-6)}`,
      同步状态: '待回放',
    })
  }
  return todos.sort((a, b) =>
    String(b['维护日期'] ?? '').localeCompare(String(a['维护日期'] ?? '')),
  )
}

export type InspectionStats = {
  monthCount: number
  inspectedStations: number
  pendingFaults: number
  pendingDrafts: number
}

// 统计也基于统一投影：回放前后台账、故障清单、待办口径一致。
export function inspectionStats(monthPrefix?: string): InspectionStats {
  const rows = unifiedInspectionRows()
  const prefix =
    monthPrefix ??
    (() => {
      const now = new Date()
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    })()
  const monthRows = rows.filter((row) => String(row['巡检日期'] ?? '').startsWith(prefix))
  return {
    monthCount: monthRows.filter((row) => isConfirmedStatus(String(row.status))).length,
    inspectedStations: new Set(
      monthRows
        .filter((row) => isConfirmedStatus(String(row.status)))
        .map((row) => String(row['站点编号'] ?? '')),
    ).size,
    pendingFaults: rows.filter((row) => String(row.status) === '发现故障').length,
    pendingDrafts: pendingDrafts().length,
  }
}

// 本地开发环境重置：清空暂存与回放产生的台账/待办，回到三类示例数据。
export function resetInspectionSync(): { drafts: InspectionDraft[] } {
  const drafts = clone(SEED_INSPECTION_DRAFTS)
  persistDrafts(drafts)
  resetRows(INSPECTION_KEY)
  // stationhouse 种子里没有「来源单号」，重置即可清掉回放生成的维修待办
  resetRows(STATIONHOUSE_KEY)
  return { drafts }
}
