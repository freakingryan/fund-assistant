# 基金投资助手 · UI/UX 体验优化提案

> 视角：**全新用户首次使用** · 范围：在不改动核心数据逻辑前提下，仅优化「用户直观感受」
> 方法论：沿主操作路径走查 → 四类标准评估（反馈 / 一致性 / 易用陷阱 / 响应式与 a11y）
> 优先级标签：🟢 低成本·高感知｜🟡 中成本·中感知｜🔴 高收益·需谨慎
> 实测基线：当前仓库 `main`（`src/` 2462 模块）。以下每条均附 `文件:行` 与可落地改法。

---

## 0. 模拟新用户路径（痛点基线）

| 步骤 | 用户预期 | 实际体验（痛点） |
|------|----------|------------------|
| 首次打开 | 看到引导/空状态 | 底部弹出安装横幅（与 Toast 重叠风险），主面板仅一个**转圈**，无骨架屏、无任何「先添加一只基金」引导 |
| 添加基金 | 输入→看到反馈 | `AddFundDialog` 提交时按钮**无 loading、无成功 Toast**，导入异常会冒泡为未捕获错误 |
| 持仓列表 | 增删改查顺滑 | 单行删除 / 批量删除**无二次确认、无 Toast、不可撤销**；本地搜索**无防抖** |
| 看行情 | 实时、可感知失败 | 行情请求失败被**静默吞掉**（写了错误 state 但从不渲染）；实时估值失败只显示 `-` |
| 详情跳转 | SPA 顺滑 | `DashboardPage` 用 `window.location.href` **整页刷新**跳转，丢失已加载缓存 |
| 投资计划 | 扫描有反馈 | 扫描**无命中时界面零变化**，用户不知「扫过没中」还是「没扫」 |
| 设置/备份 | 安全 | 备份导入**直接覆盖全量数据且无确认**，结束 `window.location.reload()` 硬刷新 |
| 全局搜索 | 点击即达 | 点击搜索结果**被忽略**，只跳回 `/holdings` 顶部 |

---

## 1. 视觉美观度（Visual Beauty）

### V1 🟢 涨跌色收敛为语义 token（最高一致性收益）
- **问题**：`pnlColor()` 直接返回 `'text-red-500'`/`'text-green-500'`（`lib/format.ts:17-19`），且 `KlinePatternCard:114-115`、`SettingsPage:207/209/491/521/545` 等处散落硬编码红绿。项目 `index.css:44-45` 已声明 `--color-up:#ef4444; --color-down:#22c55e` 并位于 `@theme` 内 → **`text-up`/`bg-up`/`border-up`/`text-down` 工具类已自动可用**，却没用。
- **影响**：红=涨绿=跌（A 股惯例）散落各处，未来想支持「绿涨红跌」切换或深色模式微调将极难。
- **改法**：
```ts
// lib/format.ts
export function pnlColor(value: number | boolean): string {
  const isUp = typeof value === 'boolean' ? value : value > 0
  return isUp ? 'text-up' : 'text-down'   // 替换 text-red-500 / text-green-500
}
```
```tsx
// KlinePatternCard / SettingsPage 散落处
<span className="text-up">支撑</span>  <span className="text-down">阻力</span>
// 安装横幅/成功提示
<CheckCircle className="h-3.5 w-3.5 text-up" />
```

### V2 🟢 内联 style 写死涨红跌绿 → 语义边框
- **问题**：`PlansPage.tsx:380` `<Card style={{ borderLeftColor: isUp ? '#ef4444' : '#22c55e' }}>` 绕开主题，深色模式不匹配。
- **改法**：`<Card className="border-l-4 border-l-up">` / `border-l-down`（token 已存在）。

### V3 🟢 统一 hover 过渡动效（用户点名项）
- **问题**：卡片、表格行、对话框按钮多数无过渡，hover 时「硬切」，缺乏精致感与可点击暗示。
- **改法**（低成本高感知，全站统一）：
```tsx
<Card className="transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
<TableRow className="transition-colors duration-150 hover:bg-muted/60 cursor-pointer">
<Button className="transition-all duration-200 active:scale-95">
```
> 建议抽成两个工具类 `.card-hover` / `.row-hover` 复用，避免逐处粘贴。

### V4 🟢 图表图例文本跟随主题
- **问题**：`KlineChartCard.tsx:192-194` MA5/MA10/MA20 图例文字用 `style={{color:'#f59e0b'}}` 等硬编码 hex；`DashboardPage:24-27` 的 `TYPE_COLORS`/`SECTOR_COLORS` 是数据可视化配色（可保留），但图例**文本**应随主题。
- **改法**：折线/蜡烛 SVG `stroke` 可保留 hex（图表需稳定辨识度），但图例**文字**改用 `text-muted-foreground` / `text-foreground`；把 `TYPE_COLORS`/`SECTOR_COLORS` 抽到 `src/lib/chart-colors.ts` 并注释「数据可视化专用，非主题色」。

### V5 🟡 字号/尺寸偏离 shadcn 规范
- **问题**：高频出现 `text-[9px]/[10px]/[11px]`、`h-7/h-8/h-9` 等非标原子值（`KlineChartCard:179`、`HoldingsTable:176`、`AppLayout:160`），导致各页信息密度与点击目标参差。
- **改法**：在 `@theme` 增补 `--text-2xs` 并加 `text-2xs` 工具类统一极小字号；按钮高度统一 `h-9`（icon 按钮 `h-8 w-8`），保证 ≥44px 触摸目标。

### V6 🟢 安装横幅与 Toast 重叠
- **问题**：`InstallPrompt.tsx:40` 与 `toast.tsx` 容器均固定 `bottom-4`，桌面端相互遮挡。
- **改法**：安装横幅改为 `bottom-4 left-4`（靠左、窄），Toast 维持右下；或给横幅 `z-[60]` 并加 `mb-16` 避让。

### V7 🟡 K 线图固定 560px 宽 + 9px 图例（移动端可读）
- **问题**：`KlineChartCard.tsx:166` `width={560}`、`CandlestickChart.tsx:98` `width=560/height=320`，窄屏只能横向滚动；图例 `text-[9px]` 手机几乎不可读。
- **改法**：外层 `className="w-full overflow-x-auto"`；SVG 改用 `viewBox` + `width="100%"` 自适应；图例字号 ≥ `text-xs`，关键数值 `text-sm`。

### V8 🟢 详情页 Badge 写死蓝 → 语义主色
- **问题**：`FundDetailPage.tsx:307` `bg-blue-100 text-blue-700 border-blue-200` 深色模式对比度异常。
- **改法**：`bg-primary/10 text-primary border-primary/20`（跟随主题主色）。

---

## 2. 功能实用度（Functional Utility）

### F1 🔴 删除类操作全部缺二次确认（安全第一高感知）
- **问题**：全仓库**无任何** `AlertDialog` / `window.confirm`（`grep AlertDialog|confirm(` 零命中）。单删 `HoldingsTable:271`、批量删 `:341`、删计划规则 `PlansPage:283`、移除 ETF 映射 `EditFundDialog:229` 均为「点即删、不可撤销、无 Toast」。
- **影响**：误触即丢数据，是金融类 App 最致命的信任破坏点。
- **改法**：引入 shadcn `AlertDialog`（Radix 已有，`npx shadcn@latest add alert-dialog`），统一封装 `<ConfirmAction>`：
```tsx
<AlertDialog>
  <AlertDialogTrigger asChild>
    <Button variant="ghost" size="icon"><Trash2 /></Button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>删除该持仓？</AlertDialogTitle>
      <AlertDialogDescription>此操作不可撤销，将从本地数据库永久移除。</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>取消</AlertDialogCancel>
      <AlertDialogAction onClick={() => { removeHolding(id); toast.success('已删除') }}>
        确认删除
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

### F2 🟢 静默吞错 → 接 Toast
- **问题**：`DashboardPage.tsx:42,92` 写了 `setQuotesError` 但**从不渲染**；`AppLayout.tsx:56` 搜索失败 `catch { setSearchResults([]) }`；`useRealtimeQuotes.ts:97-101` 仅 `console.error`。用户看到空白/`-` 却不知失败。
- **改法**（复用现有 `toast`）：
```tsx
// AppLayout.tsx:56
} catch (e) { toast.error('搜索失败，请检查网络'); setSearchResults([]) }
// useRealtimeQuotes.ts
} catch (e) { toast.error('行情更新失败'); }
// DashboardPage:92 删除无用的 setQuotesError，改 toast.error
```

### F3 🟢 提交/导入无 loading + 防连点 + 防重复
- **问题**：`AddFundDialog.tsx:235-263` 提交无 `disabled`/spinner、无成功 Toast、store 无 try/catch；`ImportDialog.tsx:173-184,321` 「确认导入」无 loading，连点可重复触发，且**同一 CSV 导入两次产生重复持仓**。
- **改法**：
```tsx
const [submitting, setSubmitting] = useState(false)
<Button disabled={submitting}>
  {submitting && <Loader2 className="mr-1 h-3 w-3 animate-spin" />} 保存
</Button>
// 导入：bulkAdd 前按 code 去重/合并已有份额；结束 toast.success(`已导入 ${n} 条`)
```

### F4 🟢 持仓本地搜索缺防抖
- **问题**：`HoldingsTable.tsx:310` `onChange={e=>setGlobalFilter(e.target.value)}` 每键即触发 tanstack 重算，而全局搜索（`AppLayout:51`）、添加基金搜索（`AddFundDialog:110-118`）都有 300ms 防抖，行为不一致。
- **改法**：复用一个 `useDebouncedValue(value, 300)` hook，与全局搜索保持一致。

### F5 🟢 详情跳转整页刷新
- **问题**：`DashboardPage.tsx:351` `window.location.href = '/detail/${id}'` 整页重载，丢失缓存、无 SPA 过渡；同文件 `RealtimePanel` 用 `navigate`，风格不一致。
- **改法**：`navigate('/detail/' + id)`（同文件已有 `useNavigate`）。

### F6 🟢 计划扫描无结果零反馈
- **问题**：`PlansPage.tsx:157-171` 仅 `result.length>0` 才切 tab + 通知；无命中时按钮转完界面毫无变化。
- **改法**：扫描结束无论有无命中都 `toast.success(result.length ? \`扫描命中 ${n} 条\` : '扫描完成，本期无触发')`。

### F7 🟡 NotificationsPage 是死路
- **问题**：整文件为静态占位 + 硬编码「暂无通知」，真正的推送开关在 `SettingsPage:428`。用户点进「通知」以为漏看功能。
- **改法（二选一）**：(a) 接入真实 plan 触发日志（已有 `planLogs` 数据）；(b) 改为说明卡片并加「去设置开启推送」按钮，或直接隐藏该导航项。

### F8 🟢 全局搜索点击被忽略
- **问题**：`AppLayout.tsx:74-78` `handleSearchSelect(_code,...)` 参数 `_code` 未使用，只 `navigate('/holdings')`，搜索白搜。
- **改法**：`navigate('/detail/' + code)` 或带 query `navigate('/holdings?highlight=' + code)` 并高亮该行。

### F9 🟡 表单无实时校验
- **问题**：`AddFundDialog`/`EditFundDialog` 仅 `code` 提交时校验；`costNAV`/`shares`/`holdingAmount` 允许空/字母/负数，无实时反馈。
- **改法**：
```tsx
<input type="number" min={0} step="0.0001"
  className={cn('transition-colors', err && 'border-destructive focus-visible:ring-destructive')} />
{err && <p className="text-xs text-destructive mt-1">成本净值需为非负数字</p>}
```

### F10 🟢 空状态缺失 → 建共享 EmptyState
- **问题**：`EmptyState` 组件此前规划但未落地（`grep function EmptyState` 零命中）；列表/搜索/通知页无空态。如 `AppLayout:165-181` 搜索无结果时不显示「未找到」。
- **改法**：新增 `src/components/ui/empty-state.tsx`，全站复用：
```tsx
<EmptyState icon={SearchX} title="未找到匹配结果" desc="换个关键词试试" />
<EmptyState icon={PieChart} title="还没有持仓" desc="点击「添加基金」开始记录" />
```

### F11 🟢 图标按钮缺 aria-label
- **问题**：`RefreshButton`（`refresh-button.tsx:30-42`）仅 `title`；`HoldingsTable:265-273` 补仓/编辑/删除、`PlansPage:278-285`、主题切换 `AppLayout:184` 等 8+ 处纯图标按钮无 `aria-label`。
- **改法**：`RefreshButton` 接收 `aria-label={title ?? '刷新'}`；其余补 `aria-label="删除持仓"` 等。

### F12 🟡 整行点击无键盘可达
- **问题**：`HoldingsTable:404-408`、`:102-104` 用 `onClick` 跳转但无 `role`/`tabIndex`/回车处理；而 `RealtimePanel:182-185` 排序头却实现了 `role="button" tabIndex={0}`，两处 a11y 待遇不一致。
- **改法**：统一为
```tsx
<div role="button" tabIndex={0}
  onClick={go} onKeyDown={e => (e.key==='Enter'||e.key===' ') && go()}
  className="... focus-visible:ring-2 focus-visible:ring-ring rounded">
```

### F13 🟢 备份导入静默覆盖 → 加确认
- **问题**：`SettingsPage.tsx:58-67` `importAllData` 整体覆盖、无「将覆盖 N 条」提示，结束 `window.location.reload()` 硬刷新；Gist 拉取（`:101-121`）同理。
- **改法**：读取文件后 `AlertDialog` 显示「将覆盖现有 X 条持仓 / Y 条计划，确认？」；成功后用 SPA 状态刷新（store 重载）替代整页 reload。

### F14 🟢 计划阈值留空存 0
- **问题**：`PlansPage.tsx:44,85-89` `threshold` 初值 `''`，保存时 `Number(threshold)||0` → 留空存为阈值 0，不提示，易建出永不当/永当的规则。
- **改法**：保存校验 `if (!(threshold > 0)) { setError('阈值需大于 0'); return }`。

---

## 3. 建议落地顺序（按性价比分阶段）

**Phase 1 · 半天搞定（全部 🟢 快速胜）**
V1 涨跌语义色 · V2 语义边框 · V3 hover 过渡 · V6 横幅避让 · V8 Badge 语义色 ·
F2 接 Toast · F3 提交/导入 loading · F4 搜索防抖 · F5 SPA 跳转 · F6 扫描反馈 · F8 搜索点击 · F10 空状态 · F11 aria-label · F13 导入确认

**Phase 2 · 1 天（🟡 中成本 + 🔴 关键安全）**
F1 全站 AlertDialog 二次确认（金融 App 信任基石）· F7 通知页改造 · F9 表单实时校验 · F12 键盘可达 · F14 阈值校验

**Phase 3 · 半天（视觉打磨）**
V5 字号 token 统一 · V4 图例主题色 · V7 K 线图响应式

---

## 4. 一页速览（优先级矩阵）

| 维度 | 🟢 立即可做 | 🟡 计划做 | 🔴 谨慎做 |
|------|-----------|-----------|-----------|
| 反馈 | F2/F3/F4/F5/F6/F8/F13 | F9 实时校验 | — |
| 一致性 | V1/V2/V3/V6/V8 | V4/V5 | — |
| 易用陷阱 | F10/F11/F14 | F7 通知页 | F1 删除确认（收益最高） |
| 响应式/a11y | F11 aria-label | V7 响应式/F12 键盘 | — |

> 结论：**F1（删除确认）+ V1（涨跌语义色）+ V3（hover 过渡）+ F2（错误 Toast）** 是「改一处、感知强、风险低」的首选四件套，建议作为第一批提交。
