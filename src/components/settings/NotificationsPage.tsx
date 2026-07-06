import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { usePlansStore } from '@/stores/plans'
import { Bell, Clock, CheckCircle, XCircle, Inbox, Settings2, ArrowRight } from 'lucide-react'

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function NotificationsPage() {
  const alerts = usePlansStore((s) => s.alerts)
  const loadAlerts = usePlansStore((s) => s.loadAlerts)
  const dismissAlert = usePlansStore((s) => s.dismissAlert)
  const markAlertExecuted = usePlansStore((s) => s.markAlertExecuted)
  const navigate = useNavigate()

  useEffect(() => { loadAlerts() }, [loadAlerts])

  const pending = useMemo(() => alerts.filter((a) => !a.executed && !a.dismissed), [alerts])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">通知</h1>
        <p className="text-sm text-muted-foreground mt-1">管理浏览器通知、查看投资计划的提醒历史</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">浏览器推送</CardTitle>
            <Bell className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">投资计划触发时收到浏览器通知</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">定时推送</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">每个交易日收盘后推送持仓简报</p>
            <Button variant="link" size="sm" className="h-6 px-0 text-xs mt-1" onClick={() => navigate('/settings')}>
              前往设置开启推送 <Settings2 className="h-3 w-3 ml-1" />
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">通知记录</CardTitle>
            <CardDescription>
              {alerts.length > 0 ? `共 ${alerts.length} 条，其中 ${pending.length} 条待处理` : '投资计划触发后会出现在这里'}
            </CardDescription>
          </div>
          {pending.length > 0 && (
            <span className="rounded-full bg-primary/10 text-primary text-[10px] px-2 py-0.5">{pending.length} 待处理</span>
          )}
        </CardHeader>
        <CardContent>
          {alerts.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="暂无通知记录"
              desc="配置投资计划并点击「扫描」后，触发提醒会显示在这里"
              action={
                <Button variant="outline" size="sm" className="text-xs" onClick={() => navigate('/plans')}>
                  前往投资计划 <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              }
            />
          ) : (
            <div className="space-y-2">
              {alerts.map((a) => {
                const status = a.executed ? 'executed' : a.dismissed ? 'dismissed' : 'pending'
                return (
                  <div key={a.id} className="flex items-start gap-3 p-3 rounded-md border">
                    {status === 'executed' ? (
                      <CheckCircle className="h-4 w-4 text-up mt-0.5 shrink-0" />
                    ) : status === 'dismissed' ? (
                      <XCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    ) : (
                      <Bell className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{a.fundName}</p>
                      <p className="text-xs text-muted-foreground">{a.reason}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{formatTime(a.triggeredAt)}</p>
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      {!a.executed && !a.dismissed && (
                        <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => markAlertExecuted(a.id)}>
                          已完成
                        </Button>
                      )}
                      {!a.dismissed && (
                        <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => dismissAlert(a.id)}>
                          忽略
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
