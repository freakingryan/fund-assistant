import { useEffect, useState, useMemo, useCallback } from 'react'
import { usePlansStore } from '@/stores/plans'
import { useHoldingsStore } from '@/stores/holdings'
import { useSettingsStore } from '@/stores/settings'
import { sendAlertBatch, requestNotificationPermission } from '@/services/notification'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { CheckCircle, Eye, Trash2, Plus, Play, Loader2,
  Settings2, History, Activity, TrendingUp,
} from 'lucide-react'
import type { PlanRule, PlanRuleType, Comparator, PlanAlert } from '@/types'
import QuickAdjustDialog from '@/components/holdings/QuickAdjustDialog'
import type { FundHolding } from '@/types'
import { pnlColor, formatSigned } from '@/lib/format'

const RULE_TYPE_LABELS: Record<PlanRuleType, string> = {
  return: '收益率',
  price_diff: '净值价差',
  daily_change: '单日涨跌幅',
  dca: '定期定投',
  kline_pattern: 'K 线形态',
}
const COMPARATOR_LABELS: Record<Comparator, string> = {
  lt: '<', gt: '>', lte: '≤', gte: '≥',
}
const ACTION_LABELS: Record<string, string> = { buy: '买入', sell: '卖出' }

function RuleForm({ rule, onSave, onCancel }: {
  rule?: PlanRule
  onSave: (rule: Omit<PlanRule, 'id'>) => void
  onCancel: () => void
}) {
  const [type, setType] = useState<PlanRuleType>(rule?.type || 'return')
  const [comparator, setComparator] = useState<Comparator>(rule?.comparator || 'lte')
  const [threshold, setThreshold] = useState(String(rule?.threshold ?? ''))
  const [action, setAction] = useState<'buy' | 'sell'>(rule?.action || 'buy')
  const [shares, setShares] = useState(String(rule?.shares ?? ''))

  const thresholdHint = {
    return: '百分比（如 -10 = 收益率 ≤ -10%）',
    price_diff: '净值绝对值（如 0.5 = 价差 ≥ 0.5）',
    daily_change: '百分比（如 3 = 单日涨跌幅 ≤ -3%）',
    dca: '间隔天数（如 30 = 每 30 天）',
    kline_pattern: '仅在手动 AI 诊断时使用',
  }[type]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">触发条件</Label>
          <Select value={type} onValueChange={(v) => setType(v as PlanRuleType)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(RULE_TYPE_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">比较方向</Label>
          <Select value={comparator} onValueChange={(v) => setComparator(v as Comparator)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="lte">≤（小于等于）</SelectItem>
              <SelectItem value="gte">≥（大于等于）</SelectItem>
              <SelectItem value="lt">&lt;（小于）</SelectItem>
              <SelectItem value="gt">&gt;（大于）</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">阈值</Label>
        <Input type="number" step="0.01" value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          placeholder={thresholdHint}
          className="h-8 text-xs" />
        <p className="text-[10px] text-muted-foreground">{thresholdHint}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">操作</Label>
          <Select value={action} onValueChange={(v) => setAction(v as 'buy' | 'sell')}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="buy">买入</SelectItem>
              <SelectItem value="sell">卖出</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">份数（0=仅提醒）</Label>
          <Input type="number" min="0" value={shares}
            onChange={(e) => setShares(e.target.value)}
            className="h-8 text-xs" />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={onCancel}>取消</Button>
        <Button size="sm" onClick={() => {
          onSave({
            type, comparator,
            threshold: Number(threshold) || 0,
            action, shares: Number(shares) || 0,
            enabled: rule?.enabled ?? true,
          })
        }}>{rule ? '更新' : '添加'}</Button>
      </div>
    </div>
  )
}

export default function PlansPage() {
  const plan = usePlansStore((s) => s.plan)
  const alerts = usePlansStore((s) => s.alerts)
  const scanning = usePlansStore((s) => s.scanning)
  const loadPlan = usePlansStore((s) => s.loadPlan)
  const loadAlerts = usePlansStore((s) => s.loadAlerts)
  const addRule = usePlansStore((s) => s.addRule)
  const updateRule = usePlansStore((s) => s.updateRule)
  const removeRule = usePlansStore((s) => s.removeRule)
  const togglePlanEnabled = usePlansStore((s) => s.togglePlanEnabled)
  const scan = usePlansStore((s) => s.scan)
  const markAlertExecuted = usePlansStore((s) => s.markAlertExecuted)
  const dismissAlert = usePlansStore((s) => s.dismissAlert)

  const holdings = useHoldingsStore((s) => s.holdings)
  const settings = useSettingsStore((s) => s.settings)
  const loadHoldings = useHoldingsStore((s) => s.loadHoldings)

  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<PlanRule | null>(null)
  const [activeTab, setActiveTab] = useState<'rules' | 'alerts' | 'history'>('rules')
  const [adjustFund, setAdjustFund] = useState<FundHolding | null>(null)
  const [adjustOpen, setAdjustOpen] = useState(false)

  useEffect(() => {
    loadPlan()
    loadAlerts()
    loadHoldings()
  }, [loadPlan, loadAlerts, loadHoldings])

  const pendingAlerts = useMemo(() => alerts.filter((a) => !a.executed && !a.dismissed), [alerts])
  const historyAlerts = useMemo(() => alerts.filter((a) => a.executed || a.dismissed), [alerts])

  const handleScan = useCallback(async () => {
    if (!plan?.enabled) return
    const result = await scan(holdings)
    if (result.length > 0) {
      setActiveTab('alerts')
      // Web Push: 发送浏览器通知
      if (settings.notifications.browser) {
        await requestNotificationPermission()
        sendAlertBatch(result.map((a) => ({
          fundName: a.fundCode,
          reason: a.reason || '投资计划触发',
        })))
      }
    }
  }, [plan, holdings, scan, settings.notifications.browser])

  if (!plan) return null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">投资计划</h1>
          <p className="text-sm text-muted-foreground mt-1">
            所有持仓基金共用一套规则，手动扫描触发提醒
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={plan.enabled} onCheckedChange={togglePlanEnabled} />
          <span className="text-xs text-muted-foreground">{plan.enabled ? '已开启' : '已关闭'}</span>
          <Button
            size="sm"
            onClick={handleScan}
            disabled={scanning || !plan.enabled || holdings.length === 0}
          >
            {scanning ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
            检查
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b pb-2">
        <button
          className={`text-sm px-3 py-1 rounded-t ${activeTab === 'rules' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => setActiveTab('rules')}
        >
          <Settings2 className="h-3 w-3 inline mr-1" />规则配置
        </button>
        <button
          className={`text-sm px-3 py-1 rounded-t ${activeTab === 'alerts' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => setActiveTab('alerts')}
        >
          <Activity className="h-3 w-3 inline mr-1" />
          提醒面板
          {pendingAlerts.length > 0 && (
            <Badge variant="destructive" className="ml-1 text-[10px] px-1">{pendingAlerts.length}</Badge>
          )}
        </button>
        <button
          className={`text-sm px-3 py-1 rounded-t ${activeTab === 'history' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => setActiveTab('history')}
        >
          <History className="h-3 w-3 inline mr-1" />操作日志
        </button>
      </div>

      {/* Rules Tab */}
      {activeTab === 'rules' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">{plan.rules.length} 条规则</p>
            <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="h-7 text-xs">
                  <Plus className="h-3 w-3 mr-1" />添加规则
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-sm">
                <DialogHeader>
                  <DialogTitle>添加规则</DialogTitle>
                  <DialogDescription>设置触发条件和操作</DialogDescription>
                </DialogHeader>
                <RuleForm onSave={(r) => { addRule(r); setAddDialogOpen(false) }} onCancel={() => setAddDialogOpen(false)} />
              </DialogContent>
            </Dialog>
          </div>

          {plan.rules.length === 0 ? (
            <Card>
              <CardContent className="text-center py-8 text-muted-foreground text-sm">
                暂无规则。点击「添加规则」开始配置。
              </CardContent>
            </Card>
          ) : (
            plan.rules.map((rule) => (
              <Card key={rule.id}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <Switch
                        checked={rule.enabled}
                        onCheckedChange={(v) => updateRule(rule.id, { enabled: v })}
                      />
                      <Badge variant={rule.action === 'buy' ? 'default' : 'secondary'} className="text-[10px]">
                        {ACTION_LABELS[rule.action]}
                      </Badge>
                      <span className="text-xs font-medium">{RULE_TYPE_LABELS[rule.type]}</span>
                      <span className="text-xs text-muted-foreground">
                        {COMPARATOR_LABELS[rule.comparator]} {rule.threshold}
                        {rule.type === 'dca' ? '天' : rule.type === 'return' || rule.type === 'daily_change' ? '%' : ''}
                      </span>
                      {rule.shares > 0 && (
                        <span className="text-xs text-muted-foreground">{rule.shares} 份</span>
                      )}
                      {rule.shares === 0 && (
                        <span className="text-[10px] text-muted-foreground italic">仅提醒</span>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-6 w-6"
                        onClick={() => setEditingRule(rule)}>
                        <Settings2 className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive"
                        onClick={() => removeRule(rule.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}

          {/* Edit Rule Dialog */}
          <Dialog open={!!editingRule} onOpenChange={(v) => !v && setEditingRule(null)}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>编辑规则</DialogTitle>
              </DialogHeader>
              {editingRule && (
                <RuleForm
                  rule={editingRule}
                  onSave={(r) => { updateRule(editingRule.id, r); setEditingRule(null) }}
                  onCancel={() => setEditingRule(null)}
                />
              )}
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* Alerts Tab */}
      {activeTab === 'alerts' && (
        <div className="space-y-3">
          {pendingAlerts.length === 0 ? (
            <Card>
              <CardContent className="text-center py-8 space-y-2">
                <CheckCircle className="h-8 w-8 mx-auto text-green-500/60" />
                <p className="text-sm text-muted-foreground">暂无触发提醒</p>
                <p className="text-xs text-muted-foreground">点击「检查」按钮扫描当前持仓</p>
              </CardContent>
            </Card>
          ) : (
            pendingAlerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} onExecuted={markAlertExecuted} onDismiss={dismissAlert}
                onQuickAdjust={(fund) => { setAdjustFund(fund); setAdjustOpen(true) }}
                holdings={holdings} />
            ))
          )}
        </div>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div className="space-y-1">
          {historyAlerts.length === 0 ? (
            <Card>
              <CardContent className="text-center py-8 text-muted-foreground text-sm">
                暂无操作记录
              </CardContent>
            </Card>
          ) : (
            historyAlerts.map((alert) => (
              <div key={alert.id} className="flex items-center justify-between py-1.5 px-3 rounded hover:bg-muted/50 text-xs">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="font-mono shrink-0">{alert.fundCode}</span>
                  <span className="truncate">{alert.fundName}</span>
                  <Badge variant={alert.executed ? 'default' : 'outline'} className="text-[10px] shrink-0">
                    {alert.executed ? '已执行' : '已忽略'}
                  </Badge>
                  <span className="text-muted-foreground truncate">{alert.reason}</span>
                </div>
                <span className="text-muted-foreground text-[10px] shrink-0 ml-2">
                  {new Date(alert.triggeredAt).toLocaleDateString()}
                </span>
              </div>
            ))
          )}
        </div>
      )}
      <QuickAdjustDialog fund={adjustFund} open={adjustOpen} onOpenChange={setAdjustOpen} />
    </div>
  )
}

function AlertCard({ alert, onExecuted, onDismiss, onQuickAdjust, holdings }: {
  alert: PlanAlert
  onExecuted: (id: string) => void
  onDismiss: (id: string) => void
  onQuickAdjust: (fund: FundHolding) => void
  holdings: FundHolding[]
}) {
  const isUp = alert.returnRate >= 0
  const matchedHolding = holdings.find((h) => h.code === alert.fundCode)

  const handleQuick = () => {
    if (!matchedHolding) return
    onQuickAdjust(matchedHolding)
  }
  return (
    <Card className={`border-l-4 ${isUp ? 'border-l-up' : 'border-l-down'}`}>
      <CardContent className="p-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1 flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs">{alert.fundCode}</span>
              <span className="text-sm font-medium truncate">{alert.fundName}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={alert.action === 'buy' ? 'default' : 'secondary'} className="text-[10px]">
                {alert.action === 'buy' ? '买入' : '卖出'}
                {alert.shares > 0 && ` ${alert.shares}份`}
              </Badge>
              <span className="text-xs">{alert.reason}</span>
            </div>
            <div className="flex gap-3 text-[10px] text-muted-foreground">
              <span>成本: ¥{alert.costNAV.toFixed(4)}</span>
              <span>现价: ¥{alert.currentNAV.toFixed(4)}</span>
              <span className={pnlColor(isUp)}>
                收益率: {formatSigned(alert.returnRate)}{alert.returnRate.toFixed(2)}%
              </span>
              <span className={pnlColor(alert.dailyChange)}>
                今日: {formatSigned(alert.dailyChange)}{alert.dailyChange.toFixed(2)}%
              </span>
            </div>
          </div>
          <div className="flex gap-1 shrink-0 ml-2">
            {matchedHolding && (
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleQuick}>
                <TrendingUp className="h-3 w-3 mr-1 text-green-500" />
                {alert.action === 'buy' ? '快速补仓' : '快速减仓'}
              </Button>
            )}
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onExecuted(alert.id)}>
              <CheckCircle className="h-3 w-3 mr-1" />已执行
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onDismiss(alert.id)}>
              <Eye className="h-3 w-3 mr-1" />已读
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
