import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'

export default function PlansPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">投资计划</h1>
          <p className="text-sm text-muted-foreground mt-1">制定补仓、止盈、定投策略</p>
        </div>
        <Button size="sm"><Plus className="h-4 w-4 mr-2" />新建计划</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">计划列表</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground text-sm">
            暂无投资计划。点击"新建计划"开始配置。
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
