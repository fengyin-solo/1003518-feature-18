<template>
  <section class="page" data-module="inspection">
    <header class="page-head">
      <div>
        <h2>巡检记录管理</h2>
        <p class="page-desc">巡检终端离线补录：现场保存检查项目，恢复网络后按站点和日期回放，台账、故障清单与站房待办同源。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出巡检台账</button>
        <button class="btn ghost" type="button" @click="resetDemo">重置演示数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">本月巡检次数</span>
        <strong class="stat-value">{{ stats.monthCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已巡检站点</span>
        <strong class="stat-value">{{ stats.inspectedStations }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待处置故障</span>
        <strong class="stat-value">{{ stats.pendingFaults }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">终端待回放暂存</span>
        <strong class="stat-value">{{ stats.pendingDrafts }}</strong>
      </article>
    </div>

    <h3 class="panel-title">巡检终端离线补录</h3>
    <section class="offline-panel">
      <form class="draft-form" @submit.prevent="submitDraft">
        <label class="filter-item">
          <span>站点编号 *</span>
          <input v-model="draftForm.stationCode" placeholder="如 STAT-0001" list="station-options" />
          <datalist id="station-options">
            <option v-for="code in stationCodes" :key="code" :value="code" />
          </datalist>
        </label>
        <label class="filter-item">
          <span>巡检日期 *</span>
          <input v-model="draftForm.inspectDate" type="date" />
        </label>
        <label class="filter-item">
          <span>巡检人员</span>
          <input v-model="draftForm.inspector" placeholder="现场巡检人员" />
        </label>
        <label class="filter-item filter-wide">
          <span>检查项目 *</span>
          <input v-model="draftForm.checkItems" placeholder="现场已检查的项目，如 水位计、雨量筒、通讯天线" />
        </label>
        <label class="filter-item filter-wide">
          <span>现场结果</span>
          <span class="radio-inline">
            <label><input v-model="draftForm.result" type="radio" value="empty" /> 空巡检（无异常）</label>
            <label><input v-model="draftForm.result" type="radio" value="fault" /> 发现故障</label>
            <label><input v-model="draftForm.result" type="radio" value="handled" /> 已处置</label>
          </span>
        </label>
        <label v-if="draftForm.result !== 'empty'" class="filter-item filter-wide">
          <span>发现问题</span>
          <input v-model="draftForm.foundIssue" placeholder="现场发现的问题" />
        </label>
        <label v-if="draftForm.result === 'handled'" class="filter-item filter-wide">
          <span>处理措施</span>
          <input v-model="draftForm.handleMeasure" placeholder="现场已采取的处置措施" />
        </label>
        <div class="form-foot">
          <button class="btn primary" type="submit">保存到终端暂存</button>
          <span class="form-hint">断网时只写本机，不进入台账；同一站点同一天重复保存会覆盖原暂存</span>
        </div>
      </form>
      <p v-if="draftMessage" :class="draftOk ? 'ok-text' : 'error-text'">{{ draftMessage }}</p>
    </section>

    <h3 class="panel-title">
      终端暂存队列（{{ pendingQueue.length }} 条待回放）
    </h3>
    <section class="replay-bar">
      <label class="filter-item">
        <span>按站点回放</span>
        <input v-model="replayFilter.stationCode" placeholder="站点编号，空=全部站点" list="station-options" />
      </label>
      <label class="filter-item">
        <span>按日期回放</span>
        <input v-model="replayFilter.inspectDate" type="date" />
      </label>
      <button class="btn primary" type="button" @click="runReplay()">恢复网络 · 回放</button>
      <button class="btn" type="button" :disabled="!hasQueue" @click="runReplay(1)">模拟中断（回放1条）</button>
      <button class="btn" type="button" :disabled="!hasQueue" @click="resumeReplay">中断续传（从未同步继续）</button>
      <span class="form-hint">回放按录入日期从早到晚；再次回放同一巡检不会生成第二份记录</span>
    </section>
    <p v-if="replayMessage" class="ok-text">{{ replayMessage }}</p>

    <table class="data-table">
      <thead>
        <tr>
          <th>录入日期</th>
          <th>站点编号</th>
          <th>巡检日期</th>
          <th>巡检人员</th>
          <th>检查项目</th>
          <th>现场结果</th>
          <th>同步状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="draft in allDrafts" :key="draft.draftId" :class="{ 'row-synced': draft.synced || draft.conflictSkipped }">
          <td>{{ draft.entryDate || '（旧暂存，已按巡检日期迁移）' }}</td>
          <td>{{ draft.stationCode }}</td>
          <td>{{ draft.inspectDate }}</td>
          <td>{{ draft.inspector }}</td>
          <td>{{ draft.checkItems }}</td>
          <td>{{ resultLabel(draft.result) }}</td>
          <td>
            <span v-if="draft.synced" class="badge ok">已回放 → {{ draft.recordCode }}</span>
            <span v-else-if="draft.conflictSkipped" class="badge warn">已确认结果，未覆盖</span>
            <span v-else class="badge pending">待回放</span>
          </td>
        </tr>
        <tr v-if="!allDrafts.length">
          <td colspan="7" class="empty-state">终端暂无暂存记录，可在上方现场补录</td>
        </tr>
      </tbody>
    </table>

    <div class="sub-tabs">
      <button
        class="link tab-link"
        :class="{ active: tab === 'ledger' }"
        type="button"
        @click="tab = 'ledger'"
      >
        巡检台账
      </button>
      <button
        class="link tab-link"
        :class="{ active: tab === 'faults' }"
        type="button"
        @click="tab = 'faults'"
      >
        故障清单（{{ faults.length }}）
      </button>
    </div>

    <form class="filter-bar" @submit.prevent>
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table v-if="tab === 'ledger'" class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>数据来源</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in filteredLedger" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td>
            <span :class="row['同步状态'] === '待回放' ? 'badge pending' : 'badge'">
              {{ row['同步状态'] === '待回放' ? '离线暂存·待回放' : row['数据来源'] }}
            </span>
          </td>
          <td class="row-actions">
            <template v-if="row['同步状态'] === '待回放'">
              <span class="form-hint">回放后可操作</span>
            </template>
            <template v-else>
              <button
                v-for="action in actionsFor(row)"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </template>
          </td>
        </tr>
        <tr v-if="!filteredLedger.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无巡检台账数据</td>
        </tr>
      </tbody>
    </table>

    <table v-else class="data-table">
      <thead>
        <tr>
          <th>记录编号</th>
          <th>站点编号</th>
          <th>巡检日期</th>
          <th>巡检人员</th>
          <th>故障描述</th>
          <th>处理措施</th>
          <th>维修待办</th>
          <th>数据来源</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="fault in filteredFaults" :key="String(fault.id)">
          <td>{{ fault.recordCode }}</td>
          <td>{{ fault.stationCode }}</td>
          <td>{{ fault.inspectDate }}</td>
          <td>{{ fault.inspector }}</td>
          <td>{{ fault.issue }}</td>
          <td>{{ fault.measure || '待安排维修' }}</td>
          <td>{{ fault.todoRecordCode ?? (fault.syncState === '待回放' ? '回放后自动生成' : '—') }}</td>
          <td>
            <span :class="fault.syncState === '待回放' ? 'badge pending' : 'badge'">
              {{ fault.syncState === '待回放' ? '离线暂存·待回放' : fault.source }}
            </span>
          </td>
        </tr>
        <tr v-if="!filteredFaults.length">
          <td colspan="8" class="empty-state">暂无发现故障的巡检记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>台账、故障清单、站房维护待办读取同一批巡检数据；暂存回放后才进入正式台账</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  inspectionFaultList,
  inspectionStats,
  listDrafts,
  replayDrafts,
  resetInspectionSync,
  saveDraft,
  unifiedInspectionRows,
  type ReplayResult,
} from '@/data/inspection-sync'
import { listRows } from '@/data/local-store'
import type { EntryRow, InspectionDraft, InspectionResultKind } from '@/data/types'

const meta = moduleMeta('inspection')
const columns = ['记录编号', '站点编号', '巡检日期', '巡检人员', '检查项目', '发现问题', '处理措施']

const allDrafts = ref<InspectionDraft[]>([])
const stats = ref(inspectionStats('2026-09'))
const faults = ref(inspectionFaultList())
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['记录编号', '站点编号', '巡检日期']
const tab = ref<'ledger' | 'faults'>('ledger')

const draftForm = reactive({
  stationCode: '',
  inspectDate: '',
  inspector: '',
  checkItems: '',
  foundIssue: '',
  handleMeasure: '',
  result: 'empty' as InspectionResultKind,
})
const draftMessage = ref('')
const draftOk = ref(true)

const replayFilter = reactive({ stationCode: '', inspectDate: '' })
const replayMessage = ref('')

const stationCodes = computed(() =>
  [...new Set(listRows('station').map((row) => String(row['站点编号'] ?? '')).filter(Boolean))],
)
const pendingQueue = computed(() => allDrafts.value.filter((draft) => !draft.synced && !draft.conflictSkipped))
const hasQueue = computed(() => pendingQueue.value.length > 0)

const ledgerRows = computed(() => unifiedInspectionRows())
const filteredLedger = computed(() => {
  const pairs = Object.entries(filters.value).filter(([, value]) => value.trim() !== '')
  return ledgerRows.value.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
})

// 故障清单的筛选字段名与台账列名对应
const FAULT_FIELD_KEY: Record<string, keyof ReturnType<typeof inspectionFaultList>[number]> = {
  记录编号: 'recordCode',
  站点编号: 'stationCode',
  巡检日期: 'inspectDate',
}
const filteredFaults = computed(() => {
  const pairs = Object.entries(filters.value).filter(([, value]) => value.trim() !== '')
  return faults.value.filter((fault) =>
    pairs.every(([field, value]) => {
      const key = FAULT_FIELD_KEY[field]
      return key ? String(fault[key] ?? '').includes(value.trim()) : true
    }),
  )
})

function resultLabel(result: InspectionResultKind): string {
  if (result === 'empty') return '空巡检（无异常）'
  if (result === 'fault') return '发现故障'
  return '已处置'
}

// 已处置是终态，不再给动作按钮；待巡检的计划槽位现场补录走离线暂存
function actionsFor(row: EntryRow): string[] {
  if (String(row.status) === '已处置') return []
  if (String(row.status) === '待巡检') return ['完成巡检', '报告故障']
  if (String(row.status) === '已巡检') return ['报告故障']
  if (String(row.status) === '发现故障') return ['确认处置']
  return []
}

function resetFilters() {
  filters.value = {}
}

function exportRows() {
  downloadEntries(meta.key)
}

function submitDraft() {
  draftMessage.value = ''
  const result = saveDraft({
    stationCode: draftForm.stationCode,
    inspectDate: draftForm.inspectDate,
    inspector: draftForm.inspector,
    checkItems: draftForm.checkItems,
    foundIssue: draftForm.foundIssue,
    handleMeasure: draftForm.handleMeasure,
    result: draftForm.result,
  })
  draftOk.value = result.ok
  draftMessage.value = result.message
  if (result.ok) {
    draftForm.stationCode = ''
    draftForm.inspectDate = ''
    draftForm.checkItems = ''
    draftForm.foundIssue = ''
    draftForm.handleMeasure = ''
    draftForm.result = 'empty'
  }
  reload()
}

function describeReplay(result: ReplayResult): string {
  const parts = [
    `新写入台账 ${result.created} 条`,
    `补全待巡检 ${result.filledPlanned} 条`,
    `生成维修待办 ${result.todosCreated} 条`,
  ]
  if (result.alreadySynced > 0) parts.push(`重复回放幂等跳过 ${result.alreadySynced} 条`)
  if (result.conflictSkipped > 0) parts.push(`命中已确认结果跳过 ${result.conflictSkipped} 条`)
  parts.push(`剩余未同步 ${result.remaining} 条`)
  if (result.interrupted) parts.unshift('回放已中断：')
  return parts.join('，')
}

function runReplay(max?: number) {
  errorMessage.value = ''
  const result = replayDrafts(
    {
      stationCode: replayFilter.stationCode,
      inspectDate: replayFilter.inspectDate,
    },
    max,
  )
  replayMessage.value = describeReplay(result)
  reload()
}

function resumeReplay() {
  // 不带条数上限：队列里只剩从未同步的记录，已同步的不会再处理
  runReplay()
}

function resetDemo() {
  if (typeof window !== 'undefined') {
    const ok = window.confirm('确定清空暂存与回放结果，恢复三类示例数据吗？')
    if (!ok) return
  }
  resetInspectionSync()
  replayFilter.stationCode = ''
  replayFilter.inspectDate = ''
  replayMessage.value = '已恢复本地开发环境示例数据'
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  allDrafts.value = listDrafts()
  total.value = unifiedInspectionRows().length
  stats.value = inspectionStats('2026-09')
  faults.value = inspectionFaultList()
}

onMounted(reload)
</script>
