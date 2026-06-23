import { useEffect, useState, useMemo, useCallback } from 'react'
import { dataSourceService } from '@/adapters/datasource/service'
import { getRankCache, setRankCache } from '@/services/klineCache'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Loader2, Search, Plus, TrendingUp, TrendingDown, Check } from 'lucide-react'

type FundRankItem = {
  code: string
  name: string
  type: string
  nav: number
  month1: number
  month3: number
  year1: number
}

const SYMBOLS = ['全部', '股票型', '混合型', '债券型', '指数型', 'QDII', 'FOF']

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSelect: (funds: { code: string; name: string }[]) => void
}

export default function FundRankDialog({ open, onOpenChange, onSelect }: Props) {
  const [symbol, setSymbol] = useState('全部')
  const [sortBy, setSortBy] = useState<'month3' | 'year1' | 'month1'>('month3')
  const [data, setData] = useState<FundRankItem[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setLoading(true); setError('')

    const load = async () => {
      // 尝试缓存
      const cached = await getRankCache(symbol)
      if (cached && cached.length > 0) {
        setData(cached.map((r: any) => ({
          code: r.code, name: r.name, type: r.type || '',
          nav: r.nav, month1: r.month1, month3: r.month3, year1: r.year1,
        })))
        setLoading(false); return
      }

      // 调用 API
      const raw = await dataSourceService.fetchFundRank(symbol, 100)
      if (raw.length > 0) {
        setRankCache(symbol, raw)
        setData(raw.map((r: any) => ({
          code: r.code, name: r.name, type: r.type || '',
          nav: r.nav, month1: r.month1, month3: r.month3, year1: r.year1,
        })))
      } else {
        setError('加载排行失败')
      }
      setLoading(false)
    }
    load()
  }, [open, symbol])

  const sorted = useMemo(() => {
    const filtered = search
      ? data.filter((f) => f.code.includes(search) || f.name.includes(search))
      : data
    return [...filtered].sort((a, b) => b[sortBy] - a[sortBy])
  }, [data, search, sortBy])

  const toggleSelect = useCallback((code: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code); else next.add(code)
      return next
    })
  }, [])

  const handleAdd = () => {
    const funds = data.filter((f) => selected.has(f.code)).map((f) => ({ code: f.code, name: f.name }))
    if (funds.length === 0) return
    onSelect(funds)
    setSelected(new Set())
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />基金排行推荐
          </DialogTitle>
        </DialogHeader>

        {/* 筛选栏 */}
        <div className="flex items-center gap-2 flex-wrap">
          {SYMBOLS.map((s) => (
            <button key={s}
              onClick={() => { setSymbol(s); setSelected(new Set()) }}
              className={`text-xs px-2.5 py-1 rounded-full transition-colors cursor-pointer ${
                symbol === s ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70'
              }`}
            >{s}</button>
          ))}
          <div className="flex-1" />
          <div className="relative w-40">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input className="h-7 pl-7 text-xs" placeholder="搜索代码/名称..." value={search}
              onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {/* 排序切换 */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>排序：</span>
          {(['month1', 'month3', 'year1'] as const).map((key) => (
            <button key={key}
              onClick={() => setSortBy(key)}
              className={`px-2 py-0.5 rounded cursor-pointer ${
                sortBy === key ? 'bg-accent font-medium' : 'hover:text-foreground'
              }`}
            >
              {key === 'month1' ? '近1月' : key === 'month3' ? '近3月' : '近1年'}
            </button>
          ))}
          <Badge variant="outline" className="text-[10px] ml-auto">{sorted.length} 只</Badge>
        </div>

        {/* 表格 */}
        <div className="flex-1 overflow-auto border rounded-md">
          {loading ? (
            <div className="flex items-center justify-center h-40"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : error ? (
            <div className="text-center py-10 text-sm text-muted-foreground">{error}</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50 sticky top-0">
                  <th className="w-8 p-2 text-left"><input type="checkbox" className="cursor-pointer"
                    checked={sorted.length > 0 && selected.size === sorted.length}
                    onChange={() => {
                      if (selected.size === sorted.length) setSelected(new Set())
                      else setSelected(new Set(sorted.map((f) => f.code)))
                    }} /></th>
                  <th className="p-2 text-left">代码</th>
                  <th className="p-2 text-left">名称</th>
                  <th className="p-2 text-right">净值</th>
                  <th className="p-2 text-right">近1月</th>
                  <th className="p-2 text-right">近3月</th>
                  <th className="p-2 text-right">近1年</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((f) => {
                  const isSel = selected.has(f.code)
                  return (
                    <tr key={f.code}
                      className={`border-t cursor-pointer transition-colors hover:bg-muted/30 ${isSel ? 'bg-accent/30' : ''}`}
                      onClick={() => toggleSelect(f.code)}
                    >
                      <td className="p-2"><input type="checkbox" checked={isSel} readOnly className="cursor-pointer" /></td>
                      <td className="p-2 font-mono">{f.code}</td>
                      <td className="p-2 max-w-[200px] truncate">{f.name}</td>
                      <td className="p-2 text-right font-mono">{f.nav.toFixed(4)}</td>
                      <td className={`p-2 text-right font-mono ${f.month1 >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                        {f.month1 >= 0 ? '+' : ''}{f.month1.toFixed(2)}%</td>
                      <td className={`p-2 text-right font-mono ${f.month3 >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                        {f.month3 >= 0 ? '+' : ''}{f.month3.toFixed(2)}%</td>
                      <td className={`p-2 text-right font-mono ${f.year1 >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                        {f.year1 >= 0 ? '+' : ''}{f.year1.toFixed(2)}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-between pt-2 border-t">
          <span className="text-xs text-muted-foreground">已选 {selected.size} 只</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="text-xs" onClick={() => onOpenChange(false)}>取消</Button>
            <Button size="sm" className="text-xs" disabled={selected.size === 0} onClick={handleAdd}>
              <Plus className="h-3 w-3 mr-1" />添加{selected.size > 0 ? ` (${selected.size})` : ''}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
