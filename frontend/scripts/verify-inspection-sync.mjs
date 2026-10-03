// 离线补录回放流程的端到端验证：用内存版 localStorage 模拟终端环境。
// 运行：node scripts/verify-inspection-sync.mjs
function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
    dump: () => Object.fromEntries(map),
  }
}

const storage = createMemoryStorage()
globalThis.window = { localStorage: storage }

const bundle = await import('./dist-bundle/test-barrel.mjs')
const sync = bundle
const store = bundle

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name} ${detail}`)
  }
}

function ledger() {
  return store.listRows('inspection')
}
function findByKey(rows, station, date) {
  return rows.find((r) => r['站点编号'] === station && r['巡检日期'] === date)
}

console.log('1) 初始本地示例：三类台账 + 5 条待回放暂存（含无录入日期的旧暂存）')
{
  const drafts = sync.listDrafts()
  check('待回放暂存 5 条', sync.pendingDrafts().length === 5)
  const migrated = drafts.find((d) => d.draftId === 'draft-seed-1')
  check('旧暂存已按巡检日期迁移 entryDate', migrated && migrated.entryDate === '2026-09-28', JSON.stringify(migrated))
  const statuses = ledger().map((r) => r.status)
  check('台账含空巡检(已巡检)/发现故障/已处置三类',
    statuses.includes('已巡检') && statuses.includes('发现故障') && statuses.includes('已处置'),
    JSON.stringify(statuses))
  check('回放前故障清单可见待回放暂存（同一批数据）',
    sync.inspectionFaultList().some((f) => f.syncState === '待回放'))
  check('回放前站房待办预览故障暂存',
    sync.stationhouseTodos().some((t) => t['同步状态'] === '待回放'))
}

console.log('2) 回放前台账不包含 09-28 暂存')
check('09-28 尚未入库', !findByKey(ledger(), 'STAT-0001', '2026-09-28'))

console.log('3) 模拟中断：只回放 1 条，按录入日期从早到晚（最早是迁移旧暂存 09-28）')
{
  const r = sync.replayDrafts({}, 1)
  check('中断标记为 true', r.interrupted === true, JSON.stringify(r.items.map((i) => i.outcome)))
  check('仅处理 1 条', r.items.length === 1)
  check('处理的是录入最早的迁移暂存 STAT-0001/09-28',
    r.items[0].draft.stationCode === 'STAT-0001' && r.items[0].draft.inspectDate === '2026-09-28')
  check('该条已写入台账', !!findByKey(ledger(), 'STAT-0001', '2026-09-28'))
  check('剩余未同步 4 条', r.remaining === 4, `remaining=${r.remaining}`)
}

console.log('4) 重复回放同一条：幂等，不生成第二份记录')
{
  const beforeCount = ledger().length
  const r = sync.replayDrafts({ stationCode: 'STAT-0001', inspectDate: '2026-09-28' })
  check('无任何处理项（已同步不再进队列）', r.items.length === 0, JSON.stringify(r))
  check('台账数量不变', ledger().length === beforeCount)
  check('同站点同日期仍只有一条',
    ledger().filter((x) => x['站点编号'] === 'STAT-0001' && x['巡检日期'] === '2026-09-28').length === 1)
}

console.log('5) 断点续传：继续回放全部剩余 4 条')
{
  const r = sync.replayDrafts()
  check('续传未再中断', r.interrupted === false)
  // 预期：09-29 故障新建 + 待办, 09-30 已处置新建, 09-03 冲突跳过, 09-05 补全待巡检槽位
  const outcomes = r.items.map((i) => `${i.draft.stationCode}/${i.draft.inspectDate}:${i.outcome}`)
  check('09-29 新建', outcomes.includes('STAT-0002/2026-09-29:created'), outcomes.join('|'))
  check('09-30 新建', outcomes.includes('STAT-0003/2026-09-30:created'), outcomes.join('|'))
  check('09-03 命中已确认结果跳过', outcomes.includes('STAT-0003/2026-09-03:conflict-skipped'), outcomes.join('|'))
  check('09-05 补全待巡检槽位', outcomes.includes('STAT-0002/2026-09-05:filled-planned'), outcomes.join('|'))
  // 09-29 故障新建 + 09-05 故障补全待巡检槽位，两处发现故障各生成 1 条维修待办
  check('新建 2、补全 1、冲突 1、待办 2',
    r.created === 2 && r.filledPlanned === 1 && r.conflictSkipped === 1 && r.todosCreated === 2,
    JSON.stringify({ c: r.created, f: r.filledPlanned, s: r.conflictSkipped, t: r.todosCreated }))
}

console.log('6) 不覆盖已确认结果')
{
  const row0903 = findByKey(ledger(), 'STAT-0003', '2026-09-03')
  check('09-03 保留原已处置记录编号 INSP-20260903', row0903['记录编号'] === 'INSP-20260903', row0903['记录编号'])
  check('09-03 巡检人员仍是赵海涛原记录（空巡检暂存未覆盖）', row0903['巡检人员'] === '赵海涛')
  check('09-03 状态仍为已处置', row0903.status === '已处置')
}

console.log('7) 回放结果落台账，三类状态正确，来源标记离线回放')
{
  const d0929 = findByKey(ledger(), 'STAT-0002', '2026-09-29')
  check('09-29 状态发现故障/abnormal', d0929.status === '发现故障' && d0929.abnormal === true)
  check('09-29 来源=离线回放', d0929['数据来源'] === '离线回放')
  const d0930 = findByKey(ledger(), 'STAT-0003', '2026-09-30')
  check('09-30 状态已处置/pending=false', d0930.status === '已处置' && d0930.pending === false)
  const d0905 = findByKey(ledger(), 'STAT-0002', '2026-09-05')
  check('09-05 沿用原计划记录编号 INSP-20260905', d0905['记录编号'] === 'INSP-20260905', d0905['记录编号'])
  check('09-05 被补全为发现故障', d0905.status === '发现故障')
  check('台账没有待回放虚拟行残留', sync.unifiedInspectionRows().every((r) => r['同步状态'] === '已入库'))
}

console.log('8) 故障清单与站房待办读取回放后的同一批数据')
{
  const faults = sync.inspectionFaultList()
  check('故障清单 3 条（种子 09-02 + 回放 09-29 + 补全 09-05）', faults.length === 3, `len=${faults.length}`)
  check('无待回放项', faults.every((f) => f.syncState === '已入库'))
  const todos = sync.stationhouseTodos()
  const generated = todos.filter((t) => t['同步状态'] === '巡检回放')
  check('站房待办含 2 条巡检回放（09-29、09-05）', generated.length === 2, `len=${generated.length}`)
  const linked0929 = generated.find((t) => t['站点编号'] === 'STAT-0002' && t['维护日期'] === '2026-09-29')
  check('09-29 待办关联新建巡检记录 INSP-20260929',
    linked0929 && linked0929['关联巡检'] === 'INSP-20260929', JSON.stringify(linked0929))
  const linked0905 = generated.find((t) => t['站点编号'] === 'STAT-0002' && t['维护日期'] === '2026-09-05')
  check('09-05 待办沿用补全槽位的巡检编号 INSP-20260905',
    linked0905 && linked0905['关联巡检'] === 'INSP-20260905', JSON.stringify(linked0905))
}

console.log('9) 再次全量回放：完全幂等，台账与待办不增长')
{
  const beforeLedger = ledger().length
  const beforeTodos = store.listRows('stationhouse').length
  const r = sync.replayDrafts()
  check('无处理项', r.items.length === 0 && r.created === 0)
  check('台账不增长', ledger().length === beforeLedger)
  check('待办不增长', store.listRows('stationhouse').length === beforeTodos)
}

console.log('10) 现场新补录同站点同日期：覆盖暂存不新增；入库不重复')
{
  sync.saveDraft({
    stationCode: 'STAT-0009', inspectDate: '2026-10-02', inspector: '甲',
    checkItems: 'A', result: 'empty', entryDate: '2026-10-02 08:00',
  })
  sync.saveDraft({
    stationCode: 'STAT-0009', inspectDate: '2026-10-02', inspector: '乙',
    checkItems: 'B', result: 'fault', foundIssue: '天线损坏', entryDate: '2026-10-02 09:00',
  })
  const queue = sync.pendingDrafts().filter((d) => d.stationCode === 'STAT-0009')
  check('同键暂存只有 1 条且为后保存内容', queue.length === 1 && queue[0].checkItems === 'B' && queue[0].result === 'fault')
  sync.replayDrafts({ stationCode: 'STAT-0009' })
  sync.replayDrafts({ stationCode: 'STAT-0009' })
  check('回放两次仍只 1 条台账',
    ledger().filter((x) => x['站点编号'] === 'STAT-0009' && x['巡检日期'] === '2026-10-02').length === 1)
  check('故障待办只生成 1 条',
    store.listRows('stationhouse').filter((t) => t['站点编号'] === 'STAT-0009').length === 1)
}

console.log('11) 旧版暂存键（offlineInspection）迁移：按录入日期排队，不覆盖已确认')
{
  // 先重置回全新状态，再模拟「旧版本终端」：暂存存在通用 entries 的 offlineInspection 键下，
  // 新版本的迁移标记尚未写入
  storage.clear()
  const { SEED_ROWS } = bundle
  const oldEntries = JSON.parse(JSON.stringify(SEED_ROWS))
  oldEntries.offlineInspection = [
    {
      id: 91, status: '发现故障', pending: true, abnormal: true,
      记录编号: 'OLD-91', 站点编号: 'STAT-0007', 巡检日期: '2026-09-11',
      巡检人员: '旧终端', 检查项目: '通讯模块', 发现问题: '模块损坏', 处理措施: '',
      录入日期: '2026-09-11 08:30',
    },
  ]
  storage.setItem('hydrology-monitor-station:entries', JSON.stringify(oldEntries))
  // 模拟升级后首次加载：重新实例化模块
  const migrated = await import(`./dist-bundle/test-barrel.mjs?v=${Date.now()}`)
  const drafts = migrated.listDrafts()
  const old = drafts.find((d) => d.draftId === 'legacy-91')
  check('旧暂存已迁移到独立暂存区', !!old, JSON.stringify(drafts.map((d) => d.draftId)))
  check('迁移保留录入日期', old && old.entryDate === '2026-09-11 08:30')
  check('迁移结果类型为发现故障', old && old.result === 'fault')
  const r = migrated.replayDrafts({ stationCode: 'STAT-0007' })
  check('迁移暂存可正常回放', r.created === 1 && r.todosCreated === 1, JSON.stringify({ c: r.created, t: r.todosCreated }))
  const row = migrated.listRows('inspection').find(
    (x) => x['站点编号'] === 'STAT-0007' && x['巡检日期'] === '2026-09-11',
  )
  check('迁移暂存回放后进入台账', !!row && row.status === '发现故障')
  // 迁移只执行一次：再次读取不应产生重复暂存
  const again = migrated.listDrafts().filter((d) => d.draftId === 'legacy-91').length
  check('迁移只执行一次', again === 1)
  // 同一迁移暂存重复回放不产生第二条
  const againReplay = migrated.replayDrafts({ stationCode: 'STAT-0007' })
  check('迁移暂存重复回放幂等', againReplay.items.length === 0)
}

console.log('12) 重置演示数据')
{
  sync.resetInspectionSync()
  check('暂存恢复 5 条', sync.pendingDrafts().length === 5)
  check('回放产生的 09-28 记录已清除', !findByKey(ledger(), 'STAT-0001', '2026-09-28'))
  check('待办恢复为种子（无巡检回放待办）',
    sync.stationhouseTodos().every((t) => t['同步状态'] !== '巡检回放'))
  check('故障清单回到 1 条种子 + 待回放暂存预览', sync.inspectionFaultList().length >= 1)
}

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
