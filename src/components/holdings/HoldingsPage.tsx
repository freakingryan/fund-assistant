import { useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BarChart3 } from 'lucide-react'
import { useHoldingsStore } from '@/stores/holdings'
import ImportDialog from './ImportDialog'
import AddFundDialog from './AddFundDialog'
import HoldingsTable from './HoldingsTable'
import FundCodeRepair from './FundCodeRepair'

export default function HoldingsPage() {
  const holdings = useHoldingsStore((s) => s.holdings)
  const loadHoldings = useHoldingsStore((s) => s.loadHoldings)
  const loading = useHoldingsStore((s) => s.loading)

  useEffect(() => {
    loadHoldings()
  }, [loadHoldings])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">持仓管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            管理你的基金持仓、导入导出数据
          </p>
        </div>
        <div className="flex gap-2">
          <ImportDialog />
          <AddFundDialog />
        </div>
      </div>

      <FundCodeRepair />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">持仓列表</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              加载中...
            </div>
          ) : holdings.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">
                暂无持仓数据。点击上方「添加基金」手动录入，或「导入」批量导入。
              </p>
              <div className="flex gap-2 justify-center">
                <ImportDialog />
                <AddFundDialog />
              </div>
            </div>
          ) : (
            <HoldingsTable />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
