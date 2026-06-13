import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Copy, FileText, LineChart, ArrowRightLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function PromptsPage() {
  const templates = [
    {
      icon: FileText,
      name: '持仓诊断',
      desc: '导出全部持仓的代码、成本、收益率，附带投资领域分类，供 AI 进行全面诊断',
    },
    {
      icon: LineChart,
      name: 'ETF K线增强',
      desc: '为场外 ETF 自动查找对应场内 ETF，附带 K 线技术分析数据',
    },
    {
      icon: ArrowRightLeft,
      name: '调仓建议',
      desc: '结合当前持仓、投资计划触发情况，生成调仓 Prompt',
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Prompt 生成</h1>
        <p className="text-sm text-muted-foreground mt-1">选择持仓基金，一键生成可复制的投资分析 Prompt</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {templates.map((t) => (
          <Card key={t.name} className="hover:shadow-md transition-shadow cursor-pointer">
            <CardHeader>
              <t.icon className="h-5 w-5 text-primary mb-2" />
              <CardTitle className="text-base">{t.name}</CardTitle>
              <CardDescription className="text-xs">{t.desc}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" className="w-full">
                <Copy className="h-3 w-3 mr-2" />生成 & 复制
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
