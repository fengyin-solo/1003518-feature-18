/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// 巡检终端在断网现场补录的检查项目，先存本机，恢复网络后按站点和日期回放。
export type InspectionResultKind = 'empty' | 'fault' | 'handled'

export type InspectionDraft = {
  draftId: string
  stationCode: string
  inspectDate: string
  inspector: string
  checkItems: string
  foundIssue: string
  handleMeasure: string
  // 空巡检 / 发现故障 / 已处置，决定回放后台账记录的巡检状态
  result: InspectionResultKind
  // 录入日期：现场保存时刻，旧暂存按它迁移、回放也按它排队
  entryDate: string
  synced: boolean
  syncedAt?: string
  recordCode?: string
  ledgerId?: number
  // 回放时命中已确认结果被跳过：保留已确认结果，暂存只登记一个不覆盖结论
  conflictSkipped?: boolean
}
