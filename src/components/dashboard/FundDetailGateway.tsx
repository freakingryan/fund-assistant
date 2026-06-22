import { useEffect } from 'react'
import { useHoldingsStore } from '@/stores/holdings'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, LineChart } from 'lucide-react'

/** 基金详情入口 — 自动跳转到第一个持仓的详情页 */
export default function FundDetailGateway() {
  const holdings = useHoldingsStore((s) => s.holdings)
  const loadHoldings = useHoldingsStore((s) => s.loadHoldings)
  const loading = useHoldingsStore((s) => s.loading)
  const navigate = useNavigate()

  useEffect(() => { loadHoldings() }, [loadHoldings])

  useEffect(() => {
    if (!loading && holdings.length > 0) {
      navigate(`/detail/${holdings[0].id}`, { replace: true })
    }
  }, [loading, holdings, navigate])

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">基金详情</h1>
        <Card><CardContent className="text-center py-16"><Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" /></CardContent></Card>
      </div>
    )
  }

  if (holdings.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">基金详情</h1>
        <Card>
          <CardContent className="text-center py-16 space-y-3">
            <LineChart className="h-12 w-12 mx-auto text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">暂无持仓数据，请先在「持仓管理」中添加基金</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">基金详情</h1>
      <Card><CardContent className="text-center py-16"><Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" /></CardContent></Card>
    </div>
  )
}
