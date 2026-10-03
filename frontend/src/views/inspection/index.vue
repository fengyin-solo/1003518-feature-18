<template>
  <section class="page" data-module="inspection">
    <header class="page-head">
      <div>
        <h2>巡检记录管理</h2>
        <p class="page-desc">巡检终端离线补录：现场先暂存检查项目，恢复网络后按站点和日期回放；台账、故障清单、站房维护待办读取同一批巡检数据。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记巡检记录</button>
        <button class="btn" type="button" @click="exportRows">导出巡检记录清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <section class="offline-panel">
      <header class="panel-head">
        <div>
          <h3>现场离线补录（终端暂存区）</h3>
          <p class="page-desc">现场无网络时先保存检查项目，暂存在本机；恢复网络后按站点和日期回放，重复回放不生成两份记录。</p>
        </div>
        <div class="panel-actions">
          <button class="btn primary" type="button" @click="runReplay(false)">恢复网络后回放</button>
          <button class="btn" type="button" @click="runReplay(true)">模拟中断（回放1条）</button>
          <button class="btn" type="button" :disabled="legacyCount === 0" @click="runMigrate">
            迁移旧暂存（{{ legacyCount }}条）
          </button>
          <button class="btn ghost" type="button" @click="resetDemo">重置演示数据</button>
        </div>
      </header>

      <form class="filter-bar replay-bar" @submit.prevent="runReplay(false)">
        <label class="filter-item">
          <span>按站点回放</span>
          <input v-model="replayFilter.stationCode" placeholder="如 STAT-0002" />
        </label>
        <label class="filter-item">
          <span>按日期回放</span>
          <input v-model="replayFilter.inspectDate" type="date" />
        </label>
        <span class="replay-hint">只处理待同步/中断的记录，按录入时间从早到晚；已同步、冲突跳过的不会重复处理。</span>
      </form>

      <form class="draft-form" @submit.prevent="saveLocalDraft">
        <label class="filter-item">
          <span>站点编号</span>
          <input v-model="draftForm.stationCode" placeholder="现场所在站点" />
        </label>
        <label class="filter-item">
          <span>巡检日期</span>
          <input v-model="draftForm.inspectDate" type="date" />
        </label>
        <label class="filter-item">
          <span>巡检人员</span>
          <input v-model="draftForm.inspector" placeholder="巡检人员" />
        </label>
        <label class="filter-item">
          <span>巡检结果</span>
          <select v-model="draftForm.outcome">
            <option value="空巡检">空巡检</option>
            <option value="发现故障">发现故障</option>
            <option value="已处置">已处置</option>
          </select>
        </label>
        <label class="filter-item grow">
          <span>检查项目（现场先保存）</span>
          <input v-model="draftForm.checkItems" placeholder="如：水位计、雨量筒、供电系统" />
        </label>
        <label class="filter-item grow">
          <span>发现问题</span>
          <input v-model="draftForm.foundIssue" :disabled="draftForm.outcome === '空巡检'" placeholder="发现故障时填写" />
        </label>
        <label class="filter-item grow">
          <span>处理措施</span>
          <input v-model="draftForm.measure" :disabled="draftForm.outcome !== '已处置'" placeholder="已处置时填写" />
        </label>
        <button class="btn primary" type="submit">现场保存（暂存）</button>
      </form>

      <table class="data-table draft-table">
        <thead>
          <tr>
            <th>暂存编号</th><th>站点编号</th><th>巡检日期</th><th>巡检人员</th>
            <th>巡检结果</th><th>录入时间</th><th>同步状态</th><th>台账记录 / 跳过原因</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="draft in drafts" :key="draft.draftId" :class="{ interrupted: draft.syncState === '同步中' }">
            <td>{{ draft.draftId }}</td>
            <td>{{ draft.stationCode }}</td>
            <td>{{ draft.inspectDate }}</td>
            <td>{{ draft.inspector }}</td>
            <td>{{ draft.outcome }}</td>
            <td>{{ draft.enteredAt }}</td>
            <td>
              <span class="sync-state" :class="stateClass(draft.syncState)">{{ draft.syncState }}</span>
            </td>
            <td>{{ draft.syncedRecordNo || draft.skipReason || '—' }}</td>
          </tr>
          <tr v-if="!drafts.length">
            <td colspan="8" class="empty-state">暂存区为空，可在上方现场保存检查项目</td>
          </tr>
        </tbody>
      </table>
      <p v-if="reportMessage" class="report-text" :class="{ interrupted: reportInterrupted }">{{ reportMessage }}</p>
    </section>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <h3 class="section-title">巡检台账（回放后写入这里）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>数据来源</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td>{{ row['数据来源'] || '在线登记' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无巡检记录，可先在现场暂存后回放</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">故障清单（读回放后的巡检结果）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>记录编号</th><th>站点编号</th><th>巡检日期</th><th>巡检人员</th>
          <th>发现问题</th><th>处理措施</th><th>故障状态</th><th>数据来源</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="fault in faultRows" :key="String(fault.id)">
          <td>{{ fault['记录编号'] }}</td>
          <td>{{ fault['站点编号'] }}</td>
          <td>{{ fault['巡检日期'] }}</td>
          <td>{{ fault['巡检人员'] }}</td>
          <td>{{ fault['发现问题'] || '—' }}</td>
          <td>{{ fault['处理措施'] || '待处置' }}</td>
          <td>{{ fault.status }}</td>
          <td>{{ fault['数据来源'] || '在线登记' }}</td>
        </tr>
        <tr v-if="!faultRows.length">
          <td colspan="8" class="empty-state">暂无故障记录</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">站房维护待办（故障即待办，处置后办结）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>来源记录</th><th>站点编号</th><th>巡检日期</th><th>维护内容</th>
          <th>待办状态</th><th>处理措施</th><th>数据来源</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="todo in todoRows" :key="`${String(todo.id)}-todo`">
          <td>{{ todo['记录编号'] }}</td>
          <td>{{ todo['站点编号'] }}</td>
          <td>{{ todo['巡检日期'] }}</td>
          <td>{{ todo['发现问题'] }}</td>
          <td>{{ todo.status === '发现故障' ? '待维护' : '已办结' }}</td>
          <td>{{ todo['处理措施'] || '待安排维护' }}</td>
          <td>{{ todo['数据来源'] || '在线登记' }}</td>
        </tr>
        <tr v-if="!todoRows.length">
          <td colspan="7" class="empty-state">暂无站房维护待办</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条巡检台账记录，其中待处置故障 {{ pendingFaultCount }} 条</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  filterRows,
  moduleMeta,
  resetModule,
  runAction as applyAction,
} from '@/api/local-service'
import {
  legacyDraftCount,
  listDrafts,
  migrateLegacyDrafts,
  replayDrafts,
  resetOfflineDrafts,
  saveDraft,
  inspectionView,
} from '@/data/inspection-sync'
import type { InspectionDraft, InspectionOutcome } from '@/data/inspection-sync'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('inspection')
const columns = ["记录编号", "站点编号", "巡检日期", "巡检人员", "检查项目", "发现问题", "处理措施", "巡检状态"]
const actions = ["完成巡检", "报告故障", "确认处置"]
const statuses = ["已巡检", "发现故障", "已处置"]

const rows = ref<EntryRow[]>([])
const faultRows = ref<EntryRow[]>([])
const todoRows = ref<EntryRow[]>([])
const total = ref(0)
const pendingFaultCount = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const drafts = ref<InspectionDraft[]>([])
const legacyCount = ref(0)
const reportMessage = ref('')
const reportInterrupted = ref(false)
const replayFilter = ref<{ stationCode: string; inspectDate: string }>({ stationCode: '', inspectDate: '' })

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const draftForm = ref({
  stationCode: '',
  inspectDate: new Date().toISOString().slice(0, 10),
  inspector: '',
  outcome: '空巡检' as InspectionOutcome,
  checkItems: '',
  foundIssue: '',
  measure: '',
})

const stats = computed(() => [
  { label: '巡检台账总数', value: total.value },
  { label: '已巡检站点', value: new Set(rows.value.map((row) => String(row['站点编号'] ?? ''))).size },
  { label: '待处置故障', value: pendingFaultCount.value },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function stateClass(state: string): string {
  if (state === '已同步') return 'is-done'
  if (state === '冲突跳过') return 'is-skip'
  if (state === '同步中') return 'is-syncing'
  return 'is-wait'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '巡检记录登记入口尚未接入审批流，现场补录请使用下方离线暂存'
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

function loadDrafts() {
  drafts.value = listDrafts()
  legacyCount.value = legacyDraftCount()
}

// 台账、故障清单、站房维护待办一次取同一个快照，保证回放前后读到的是同一批数据。
function reload() {
  errorMessage.value = ''
  try {
    const snapshot = inspectionView()
    rows.value = filterRows(snapshot.ledger, filters.value)
    faultRows.value = snapshot.faults
    todoRows.value = snapshot.maintenanceTodos
    total.value = snapshot.ledger.length
    pendingFaultCount.value = snapshot.pendingFaults.length
    loadDrafts()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '巡检数据读取失败'
  }
}

function saveLocalDraft() {
  errorMessage.value = ''
  reportMessage.value = ''
  const form = draftForm.value
  if (!form.stationCode.trim() || !form.inspectDate || !form.inspector.trim() || !form.checkItems.trim()) {
    errorMessage.value = '站点编号、巡检日期、巡检人员、检查项目为现场必填项'
    return
  }
  if (form.outcome === '发现故障' && !form.foundIssue.trim()) {
    errorMessage.value = '发现故障时必须填写发现问题'
    return
  }
  if (form.outcome === '已处置' && !form.measure.trim()) {
    errorMessage.value = '已处置时必须填写处理措施'
    return
  }
  saveDraft({
    stationCode: form.stationCode.trim(),
    inspectDate: form.inspectDate,
    inspector: form.inspector.trim(),
    checkItems: form.checkItems.trim(),
    foundIssue: form.outcome === '空巡检' ? '' : form.foundIssue.trim(),
    measure: form.outcome === '已处置' ? form.measure.trim() : '',
    outcome: form.outcome,
    enteredAt: nowText(),
  })
  reportMessage.value = '已保存在终端暂存区，恢复网络后可按站点和日期回放'
  draftForm.value = {
    stationCode: '',
    inspectDate: new Date().toISOString().slice(0, 10),
    inspector: '',
    outcome: '空巡检',
    checkItems: '',
    foundIssue: '',
    measure: '',
  }
  loadDrafts()
}

function runReplay(simulateInterrupt: boolean) {
  errorMessage.value = ''
  const report = replayDrafts(
    replayFilter.value,
    simulateInterrupt ? 1 : undefined,
  )
  reportMessage.value = report.message
  reportInterrupted.value = report.interrupted
  reload()
}

function runMigrate() {
  errorMessage.value = ''
  const report = migrateLegacyDrafts()
  reportMessage.value = report.message
  reportInterrupted.value = false
  reload()
}

function resetDemo() {
  resetOfflineDrafts()
  resetModule(meta.key)
  replayFilter.value = { stationCode: '', inspectDate: '' }
  reportMessage.value = '已恢复三类离线示例、旧暂存记录与初始台账'
  reportInterrupted.value = false
  reload()
}

onMounted(reload)
</script>

<style scoped>
.offline-panel {
  background: #fff;
  border: 1px solid var(--border);
  border-left: 4px solid var(--brand);
  border-radius: 8px;
  padding: 12px 14px;
  margin: 12px 0 16px;
}
.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
}
.panel-head h3 {
  margin: 0 0 4px;
  font-size: 15px;
}
.panel-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.replay-bar {
  margin-top: 10px;
  align-items: center;
}
.replay-hint {
  font-size: 12px;
  color: var(--muted);
}
.draft-form {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: flex-end;
  margin: 10px 0;
  padding: 10px;
  background: #f6f8fb;
  border-radius: 6px;
}
.filter-item.grow {
  flex: 1 1 220px;
}
.filter-item select,
.filter-item input {
  width: 100%;
}
.draft-table {
  margin-top: 6px;
}
tr.interrupted {
  background: #fff7ed;
}
.sync-state {
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
}
.sync-state.is-wait {
  background: #e2e8f0;
  color: #334155;
}
.sync-state.is-syncing {
  background: #fef3c7;
  color: #92400e;
}
.sync-state.is-done {
  background: #dcfce7;
  color: #166534;
}
.sync-state.is-skip {
  background: #fee2e2;
  color: #991b1b;
}
.report-text {
  margin: 8px 0 0;
  font-size: 13px;
  color: #166534;
}
.report-text.interrupted {
  color: #92400e;
}
.section-title {
  font-size: 14px;
  margin: 18px 0 8px;
}
</style>
