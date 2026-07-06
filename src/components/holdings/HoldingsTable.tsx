import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel,
  createColumnHelper, flexRender, type SortingState, type VisibilityState,
} from '@tanstack/react-table'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { useHoldingsStore } from '@/stores/holdings'
import { useRealtimeQuotes } from '@/hooks/useRealtimeQuotes'
import type { FundHolding } from '@/types'
import { pnlColor, formatSigned } from '@/lib/format'
import { TYPE_LABELS, MARKET_LABELS, SECTOR_LABELS } from '@/lib/labels'
import { RefreshButton } from '@/components/ui/refresh-button'
import { ConfirmAction } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { toast } from '@/components/ui/toast'
import { Trash2, Search, ArrowUpDown, ChevronDown, Pencil, TrendingUp, RefreshCw, PieChart, SearchX } from 'lucide-react'
import EditFundDialog from './EditFundDialog'
import QuickAdjustDialog from './QuickAdjustDialog'
import {
  DropdownMenu, DropdownMenuCheckboxItem,
  DropdownMenuContent, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const columnHelper = createColumnHelper<FundHolding & { currentNAV?: number; pnl?: number }>()

export default function HoldingsTable() {
  const holdings = useHoldingsStore((s) => s.holdings)
  const selectedIds = useHoldingsStore((s) => s.selectedIds)
  const toggleSelected = useHoldingsStore((s) => s.toggleSelected)
  const selectAll = useHoldingsStore((s) => s.selectAll)
  const clearSelection = useHoldingsStore((s) => s.clearSelection)
  const navigate = useNavigate()
  const removeHolding = useHoldingsStore((s) => s.removeHolding)
  const removeHoldings = useHoldingsStore((s) => s.removeHoldings)

  // F8: 全局搜索选中后跳转 /holdings?highlight=CODE，自动筛选并高亮该行 3 秒
  const [searchParams, setSearchParams] = useSearchParams()
  const highlightCode = searchParams.get('highlight')
  useEffect(() => {
    if (!highlightCode) return
    setGlobalFilter(highlightCode)
    const t = setTimeout(() => {
      setSearchParams((prev) => { prev.delete('highlight'); return prev }, { replace: true })
    }, 3000)
    return () => clearTimeout(t)
  }, [highlightCode, setGlobalFilter, setSearchParams])

  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  // F4: 搜索框防抖 300ms，与全局搜索/添加基金搜索保持一致，避免每键即触发 tanstack 重算
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebouncedValue(searchInput, 300)
  useEffect(() => {
    if (highlightCode) return // 高亮跳转模式优先，不覆盖用户输入
    setGlobalFilter(debouncedSearch)
  }, [debouncedSearch, highlightCode, setGlobalFilter])
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    holdingAmount: false,
    holdingProfit: false,
  })
  const [editingFund, setEditingFund] = useState<FundHolding | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [adjustFund, setAdjustFund] = useState<FundHolding | null>(null)
  const [adjustOpen, setAdjustOpen] = useState(false)

  // 实时行情（有 ETF 映射的持仓自动获取实时估值）
  const holdingCodes = useMemo(() => holdings.map((h) => h.code), [holdings])
  
  const { valuations, refresh: refreshQuotes, loading: quotesLoading, lastUpdated } = useRealtimeQuotes(holdingCodes, 0)

  // 根据类型筛选持仓
  const filteredHoldings = useMemo(() => {
    return typeFilter === 'all'
      ? holdings
      : holdings.filter((h) => h.type === typeFilter)
  }, [holdings, typeFilter])

  const columns = useMemo(() => [
    columnHelper.display({
      id: 'select',
      header: ({ table: _table }) => {
        const checked = holdings.length > 0 && selectedIds.length === holdings.length
        const indeterminate = selectedIds.length > 0 && !checked
        return (
          <Checkbox
            checked={checked}
            data-state={indeterminate ? 'indeterminate' : undefined}
            onCheckedChange={() => checked ? clearSelection() : selectAll()}
          />
        )
      },
      cell: ({ row }) => (
        <Checkbox
          checked={selectedIds.includes(row.original.id)}
          onCheckedChange={() => toggleSelected(row.original.id)}
        />
      ),
      size: 40,
    }),
    columnHelper.accessor('code', {
      header: '代码',
      cell: ({ getValue }) => <span className="font-mono text-xs">{getValue()}</span>,
      size: 90,
    }),
    columnHelper.accessor('name', {
      header: '名称',
      cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
      size: 160,
    }),
    columnHelper.accessor('market', {
      header: '市场',
      cell: ({ getValue }) => <Badge variant="outline" className="text-[10px]">{MARKET_LABELS[getValue()] || getValue()}</Badge>,
      size: 70,
    }),
    columnHelper.accessor('type', {
      header: '类型',
      cell: ({ getValue }) => <Badge variant="secondary" className="text-[10px]">{TYPE_LABELS[getValue()] || getValue()}</Badge>,
      size: 80,
    }),
    columnHelper.accessor('sector', {
      header: '领域',
      cell: ({ getValue }) => {
        const s = getValue()
        return <span className="text-xs text-muted-foreground">{s && s !== 'other' ? SECTOR_LABELS[s] : '-'}</span>
      },
      size: 80,
    }),
    columnHelper.display({
      id: 'costNAV',
      header: '成本净值',
      cell: ({ row }) => {
        const { costNAV: storedNAV, holdingAmount, holdingShares } = row.original
        const code = row.original.code
        const val = valuations[code]
        const currentNAV = val?.quote?.nav
        // 优先存储值，否则反算：投入本金 / 份额
        const investment = (storedNAV && holdingShares) ? storedNAV * holdingShares
          : (holdingAmount != null && row.original.holdingProfit != null) ? holdingAmount - row.original.holdingProfit
          : 0
        const shares = holdingShares || (currentNAV && currentNAV > 0 ? Math.round((holdingAmount || 0) / currentNAV * 100) / 100 : 0)
        const nav = storedNAV || (investment && shares ? investment / shares : 0)
        if (nav > 0) {
          return <span className="font-mono text-sm">{storedNAV ? '¥' : '≈¥'}{nav.toFixed(4)}</span>
        }
        return <span className="text-xs text-muted-foreground">-</span>
      },
      size: 100,
    }),
    columnHelper.display({
      id: 'shares',
      header: '份额',
      cell: ({ row }) => {
        const { shares: storedShares, holdingAmount } = row.original
        const code = row.original.code
        const val = valuations[code]
        const currentNAV = val?.quote?.nav
        // 优先存储值，否则反算
        const shares = storedShares || (currentNAV && currentNAV > 0 ? Math.round((holdingAmount || 0) / currentNAV * 100) / 100 : 0)
        if (shares > 0) {
          return <span className="font-mono text-sm">{storedShares ? shares.toFixed(2) : `≈${shares.toFixed(2)}`}</span>
        }
        return <span className="text-xs text-muted-foreground">-</span>
      },
      size: 90,
    }),
    // 实时估值列（基于 ETF 实时行情或盘后净值）
    columnHelper.display({
      id: 'realtimePrice',
      header: () => (
        <span className="flex items-center gap-1">
          实时净值
          {quotesLoading && <RefreshCw className="h-3 w-3 animate-spin" />}
        </span>
      ),
      cell: ({ row }) => {
        const code = row.original.code
        const val = valuations[code]
        
        if (!val || val.loading) return <span className="text-xs text-muted-foreground">加载中...</span>
        if (!val.quote) return <span className="text-xs text-muted-foreground">-</span>
        return (
          <div className="flex flex-col">
            <span className={`font-mono text-sm ${pnlColor(val.quote.dailyChange)}`}>
              ¥{val.quote.nav.toFixed(4)}
              {val.isRealtime && <span className="text-[10px] text-muted-foreground ml-1">实时</span>}
            </span>
            <span className={`font-mono text-[11px] ${pnlColor(val.quote.dailyChange)}`}>
              {formatSigned(val.quote.dailyChange)}{val.quote.dailyChange.toFixed(2)}%
            </span>
          </div>
        )
      },
      size: 110,
    }),
    columnHelper.display({
      id: 'realtimePnl',
      header: '实时盈亏',
      cell: ({ row }) => {
        const { costNAV, shares, holdingAmount, holdingProfit } = row.original
        const code = row.original.code
        const val = valuations[code]
        
        if (!val || val.loading) return <span className="text-xs text-muted-foreground">加载中...</span>
        if (!val.quote || val.quote.nav <= 0.001) return <span className="text-xs text-muted-foreground">-</span>

        // 计算实时市值
        const currentMV = (shares && val.quote.nav > 0.001) ? shares * val.quote.nav
          : holdingAmount || 0
        // 计算投入成本
        const cost = (costNAV && shares) ? costNAV * shares
          : (holdingAmount != null && holdingProfit != null) ? holdingAmount - holdingProfit
          : 0
        const pnl = currentMV - cost
        const pnlRate = cost > 0 ? (pnl / cost) * 100 : 0

        return (
          <div className="flex flex-col">
            <span className={`font-mono text-sm ${pnlColor(pnl)}`}>{formatSigned(pnl)}¥{pnl.toFixed(2)}</span>
            <span className={`font-mono text-[11px] ${pnlColor(pnl)}`}>{formatSigned(pnlRate)}{pnlRate.toFixed(2)}%</span>
          </div>
        )
      },
      size: 110,
    }),
    columnHelper.accessor('holdingAmount', {
      header: '投入金额',
      cell: ({ getValue }) => {
        const v = getValue()
        return v != null ? <span className="font-mono text-sm">¥{v.toFixed(2)}</span> : <span className="text-xs text-muted-foreground">-</span>
      },
      size: 100,
    }),
    columnHelper.accessor('holdingProfit', {
      header: '持有收益',
      cell: ({ getValue }) => {
        const v = getValue()
        if (!v) return <span className="text-xs text-muted-foreground">-</span>
        return <span className={`font-mono text-sm ${pnlColor(v)}`}>{formatSigned(v)}¥{v.toFixed(2)}</span>
      },
      size: 100,
    }),
    columnHelper.display({
      id: 'marketValue',
      header: '参考市值',
      cell: ({ row }) => {
        const { costNAV, shares, holdingAmount } = row.original
        // 优先用方式一：成本×份额；否则用方式二：持有金额（已含收益）
        const mv = (costNAV && shares) ? costNAV * shares
          : (holdingAmount) ? holdingAmount
          : 0
        return mv != null ? <span className="font-mono text-sm font-medium">¥{mv.toFixed(2)}</span> : <span className="text-xs text-muted-foreground">-</span>
      },
      size: 100,
    }),
    columnHelper.accessor('purchaseDate', {
      header: '购买日期',
      cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{getValue()}</span>,
      size: 100,
    }),
    columnHelper.accessor('tags', {
      header: '标签',
      cell: ({ getValue }) => {
        const tags = getValue()
        if (!tags || tags.length === 0) return <span className="text-xs text-muted-foreground">-</span>
        return (
          <div className="flex gap-1 flex-wrap">
            {tags.slice(0, 2).map((t, i) => (
              <Badge key={i} variant="secondary" className="text-[10px] px-1">{t}</Badge>
            ))}
            {tags.length > 2 && <span className="text-[10px] text-muted-foreground">+{tags.length - 2}</span>}
          </div>
        )
      },
      size: 100,
    }),
    columnHelper.display({
      id: 'actions',
      header: '操作',
      cell: ({ row }) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="补仓" onClick={() => { setAdjustFund(row.original); setAdjustOpen(true) }}>
            <TrendingUp className="h-3 w-3 text-green-500" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="编辑持仓" onClick={() => { setEditingFund(row.original); setEditOpen(true) }}>
            <Pencil className="h-3 w-3 text-muted-foreground" />
          </Button>
          <ConfirmAction
            title="删除该持仓？"
            description="此操作不可撤销，将从本地数据库永久移除。"
            confirmText="确认删除"
            onConfirm={() => { removeHolding(row.original.id); toast({ type: 'success', message: '已删除持仓' }) }}
          >
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="删除持仓">
              <Trash2 className="h-3 w-3 text-muted-foreground" />
            </Button>
          </ConfirmAction>
        </div>
      ),
      size: 100,
    }),
  ], [selectedIds, toggleSelected, selectAll, clearSelection, removeHolding, valuations, quotesLoading])

  const table = useReactTable({
    data: filteredHoldings,
    columns,
    state: { sorting, globalFilter, columnVisibility },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    enableRowSelection: true,
  })

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: holdings.length }
    for (const h of holdings) {
      counts[h.type] = (counts[h.type] || 0) + 1
    }
    return counts
  }, [holdings])

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索代码或名称..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>

        {/* Type filter buttons */}
        <div className="flex gap-1 flex-wrap">
          {Object.entries({ all: '全部', stock: '股票型', mixed: '混合型', bond: '债券型', index: '指数型', etf: 'ETF', qdii: 'QDII' }).map(([key, label]) => {
            const count = typeCounts[key] || 0
            if (count === 0 && key !== 'all') return null
            return (
              <Button
                key={key}
                variant={typeFilter === key ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs px-2"
                onClick={() => setTypeFilter(key)}
              >
                {label} ({count})
              </Button>
            )
          })}
        </div>

        <div className="ml-auto flex gap-2">
          <RefreshButton onClick={refreshQuotes} loading={quotesLoading} label="刷新估值" />
          {selectedIds.length > 0 && (
            <ConfirmAction
              title={`删除选中的 ${selectedIds.length} 只持仓？`}
              description="此操作不可撤销，将从本地数据库永久移除。"
              confirmText="确认删除"
              onConfirm={() => { removeHoldings(selectedIds); toast({ type: 'success', message: `已删除 ${selectedIds.length} 只持仓` }) }}
            >
              <Button
                variant="destructive"
                size="sm"
                className="h-7 text-xs"
              >
                <Trash2 className="h-3 w-3 mr-1" />删除选中 ({selectedIds.length})
              </Button>
            </ConfirmAction>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs">
                列 <ChevronDown className="h-3 w-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {table.getAllColumns().filter((c) => c.getCanHide()).map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.id}
                  checked={col.getIsVisible()}
                  onCheckedChange={(v) => col.toggleVisibility(!!v)}
                >
                  {col.id === 'select' ? '选择' :
                   col.id === 'marketValue' ? '参考市值' :
                   col.id === 'holdingAmount' ? '持有金额' :
                   col.id === 'holdingProfit' ? '持有收益' :
                   col.id === 'purchaseDate' ? '日期' :
                   col.id === 'tags' ? '标签' :
                   col.id === 'actions' ? '操作' :
                   typeof col.columnDef.header === 'string' ? col.columnDef.header : col.id}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                  >
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button
                        className="flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <ArrowUpDown className="h-3 w-3" />
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`查看 ${row.original.name || row.original.code} 详情`}
                  className={`row-hover cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm ${highlightCode && row.original.code === highlightCode ? 'ring-2 ring-primary' : ''}`}
                  data-state={selectedIds.includes(row.original.id) ? 'selected' : undefined}
                  onClick={() => navigate(`/detail/${row.original.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      navigate(`/detail/${row.original.id}`)
                    }
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="p-0">
                  {holdings.length === 0 ? (
                    <EmptyState
                      icon={PieChart}
                      title="还没有持仓"
                      desc="点击上方「添加基金」或「导入」开始记录你的基金"
                    />
                  ) : (
                    <EmptyState
                      icon={SearchX}
                      title="没有匹配的持仓记录"
                      desc="换个关键词或筛选条件试试"
                    />
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Summary */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div>
          共 {holdings.length} 只基金
          {typeFilter !== 'all' && `（已筛选: ${TYPE_LABELS[typeFilter]}）`}
          {selectedIds.length > 0 && `，已选 ${selectedIds.length} 只`}
          {holdings.length > 0 && ` | 参考市值: ¥${holdings.reduce((sum, h) => sum + (
            (h.costNAV && h.shares) ? h.costNAV * h.shares
            : h.holdingAmount ? h.holdingAmount
            : 0
          ), 0).toFixed(2)}`}
        </div>
        {lastUpdated && (
          <span>实时估值更新于 {lastUpdated.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
        )}
      </div>
      <EditFundDialog fund={editingFund} open={editOpen} onOpenChange={setEditOpen} />
      <QuickAdjustDialog fund={adjustFund} open={adjustOpen} onOpenChange={setAdjustOpen} />
    </div>
  )
}
