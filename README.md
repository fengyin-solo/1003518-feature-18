# 水文监测站网管理系统

面向水文监测站点运行、水位流量雨量数据采集、遥测设备维护与数据整编发布的水文站网管理平台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 监测站点 | `station` | 水文监测站 | 站点编号、站点名称、站点类型 |
| 水位监测 | `waterlevel` | 水位记录 | 记录编号、站点编号、观测时间 |
| 流量监测 | `discharge` | 流量记录 | 记录编号、站点编号、测量方法 |
| 雨量观测 | `rainfall` | 雨量记录 | 记录编号、站点编号、观测时段 |
| 水质检测 | `waterquality` | 水质检测报告 | 报告编号、采样站点、采样时间 |
| 断面测量 | `crosssection` | 断面测量记录 | 记录编号、站点编号、断面名称 |
| 遥测设备 | `telemetry` | 遥测设备 | 设备编号、设备类型、所属站点 |
| 数据整编 | `compilation` | 整编成果 | 成果编号、整编年份、站点编号 |
| 预警阈值 | `warning` | 预警阈值配置 | 配置编号、站点编号、监测类型 |
| 地下水观测 | `groundwater` | 地下水观测记录 | 记录编号、井点编号、观测日期 |
| 蒸发观测 | `evaporation` | 蒸发观测记录 | 记录编号、站点编号、观测日期 |
| 测流缆道 | `cableway` | 测流缆道 | 缆道编号、所属站点、跨度米数 |
| 泥沙监测 | `sediment` | 泥沙监测记录 | 记录编号、站点编号、采样时间 |
| 通讯系统 | `communication` | 通讯设备 | 设备编号、设备类型、所属站点 |
| 站房维护 | `stationhouse` | 站房维护记录 | 记录编号、站点编号、维护类型 |
| 仪器检定 | `calibration` | 仪器检定记录 | 记录编号、仪器编号、仪器名称 |
| 巡检记录 | `inspection` | 巡检记录 | 记录编号、站点编号、巡检日期 |
| 测报方案 | `plan` | 测报方案 | 方案编号、方案名称、适用范围 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `hydrology-monitor-station:entries` 这一项，或调用 `resetModule(模块)`。

## 巡检终端离线补录

巡检模块支持终端在断网现场补录、恢复网络后回放，域逻辑集中在
`frontend/src/data/inspection-sync.ts`：

1. **现场暂存**：检查项目先存入终端本机（localStorage 独立键
   `hydrology-monitor-station:inspection-drafts`），同一站点同一天重复保存覆盖原暂存。
   本地开发环境内置空巡检、发现故障、已处置三类示例（含无录入日期的旧暂存与冲突样本）。
2. **按站点和日期回放**：恢复网络后按「站点编号 + 巡检日期」筛选，按录入日期从早到晚入库；
   重复回放同一巡检幂等，不会生成两份记录。
3. **不覆盖已确认结果**：台账里同站点同日期已是「已巡检/发现故障/已处置」的，暂存标记冲突跳过、
   保留原结果；只有「待巡检」计划槽位会被现场结果补全（沿用原记录编号）。
4. **旧暂存迁移**：旧版存在 `offlineInspection` 键下的暂存首次进入新版本时按录入日期迁移，
   迁移只执行一次；缺失录入日期的按巡检日期回填。
5. **断点续传**：每条暂存处理完即时落盘，中断后再次回放从未同步记录继续。
6. **同源读取**：巡检台账、故障清单、站房维护待办由 `unifiedInspectionRows()` /
   `inspectionFaultList()` / `stationhouseTodos()` 从同一批数据投影；发现故障回放后自动在
   站房维护生成「巡检故障维修」待办（回放前以待回放形态预览），监测站点页的巡检故障台账也读取
   回放后的同一结果。

巡检页提供「模拟中断（回放1条）」与「中断续传」按钮演示断网恢复过程，「重置演示数据」可回到
初始示例。回放逻辑有 51 项 Node 断言（幂等、冲突不覆盖、续传、迁移、同源投影）：

```bash
cd frontend
npm run verify:inspection
```
