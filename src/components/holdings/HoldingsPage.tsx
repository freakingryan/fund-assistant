import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Plus, Upload } from 'lucide-react'

export default function HoldingsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">持仓管理</h1>
          <p className="text-sm text-muted-foreground mt-1">管理你的基金持仓、导入导出数据</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm"><Upload className="h-4 w-4 mr-2" />导入</Button>
          <Button size="sm"><Plus className="h-4 w-4 mr-2" />添加基金</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">持仓列表</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground text-sm">
            暂无持仓数据。点击"添加基金"或"导入"开始。
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
