import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { WalletCards, TrendingUp, PieChart, Bell, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNavigate } from 'react-router-dom'

export default function DashboardPage() {
  const navigate = useNavigate()

  const quickActions = [
    { icon: Plus, label: '添加持仓', path: '/holdings', color: 'text-blue-500' },
    { icon: TrendingUp, label: '新建计划', path: '/plans', color: 'text-green-500' },
    { icon: PieChart, label: '导出诊断', path: '/prompts', color: 'text-purple-500' },
    { icon: Bell, label: '通知设置', path: '/notifications', color: 'text-orange-500' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">概览</h1>
        <p className="text-sm text-muted-foreground mt-1">欢迎回来，这是你的投资总览</p>
      </div>

      {/* Stats grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">总持仓</CardTitle>
            <WalletCards className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">--</div>
            <p className="text-xs text-muted-foreground">0 只基金</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">持仓市值</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">¥0.00</div>
            <p className="text-xs text-muted-foreground">--</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">累计盈亏</CardTitle>
            <PieChart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">¥0.00</div>
            <p className="text-xs text-muted-foreground">--</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">今日提醒</CardTitle>
            <Bell className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground">条待处理</p>
          </CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">快捷操作</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {quickActions.map((action) => (
              <Button
                key={action.label}
                variant="outline"
                className="h-auto flex-col gap-2 py-4"
                onClick={() => navigate(action.path)}
              >
                <action.icon className={`h-5 w-5 ${action.color}`} />
                <span className="text-xs">{action.label}</span>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Getting started */}
      <Card className="border-dashed">
        <CardContent className="py-8 text-center">
          <WalletCards className="mx-auto h-8 w-8 text-muted-foreground/50 mb-3" />
          <h3 className="font-medium mb-1">开始使用基金投资助手</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
            添加你的第一笔基金持仓，即可查看实时盈亏、生成投资建议 Prompt、制定买卖计划。
          </p>
          <Button onClick={() => navigate('/holdings')}>添加持仓</Button>
        </CardContent>
      </Card>
    </div>
  )
}
