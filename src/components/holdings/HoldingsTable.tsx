import { useMemo, useState, useCallback } from 'react'
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel,
  createColumnHelper, flexRender, type SortingState, type ColumnFiltersState, type VisibilityState,
} from '@tanstack/react-table'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { useHoldingsStore } from '@/stores/holdings'
import type { FundHolding } from '@/types'
import { Trash2, Search, ArrowUpDown, ChevronDown } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuCheckboxItem,
  DropdownMenuContent, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const columnHelper = createColumnHelper<FundHolding & { currentNAV?: number; pnl?: number }>()

const TYPE_LABELS: Record<string, string> = {
  stock: '股票型', mixed: '混合型', bond: '债券型', index: '指数型',
  qdii: 'QDII', money: '货币型', etf: 'ETF', other: '其他',
}
const MARKET_LABELS: Record<string, string> = { A: 'A股', HK: '港股', US: '美股' }
const SECTOR_LABELS: Record<string, string> = {
  tech: '科技', consumer: '消费', healthcare: '医药', new_energy: '新能源',
  finance: '金融', manufacturing: '制造', broad_market: '宽基',
  global: '全球', bond_market: '债市', commodity: '大宗商品',
  real_estate: '地产', other: '其他',
}

export default function HoldingsTable() {
  const holdings = useHoldingsStore((s) => s.holdings)
  const selectedIds = useHoldingsStore((s) => s.selectedIds)
  const toggleSelected = useHoldingsStore((s) => s.toggleSelected)
  const selectAll = useHoldingsStore((s) => s.selectAll)
  const clearSelection = useHoldingsStore((s) => s.clearSelection)
  const removeHolding = useHoldingsStore((s) => s.removeHolding)
  const removeHoldings = useHoldingsStore((s) => s.removeHoldings)

  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    holdingAmount: false,
    holdingProfit: false,
  })

  const filteredHoldings = useMemo(() => {
    return typeFilter === 'all'
      ? holdings
      : holdings.filter((h) => h.type === typeFilter)
  }, [holdings, typeFilter])

  const allSelected = holdings.length > 0 && selectedIds.length === holdings.length
  const someSelected = selectedIds.length > 0 && !allSelected

  const columns = useMemo(() => [
    columnHelper.display({
      id: 'select',
      header: () => (
        <Checkbox
          checked={allSelected}
          data-state={someSelected ? 'indeterminate' : undefined}
          onCheckedChange={() => allSelected ? clearSelection() : selectAll()}
        />
      ),
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
    columnHelper.accessor('costNAV', {
      header: '成本净值',
      cell: ({ getValue }) => {
        const v = getValue()
        return v ? <span className="font-mono text-sm">¥{v.toFixed(4)}</span> : <span className="text-xs text-muted-foreground">-</span>
      },
      size: 100,
    }),
    columnHelper.accessor('shares', {
      header: '份额',
      cell: ({ getValue }) => {
        const v = getValue()
        return v ? <span className="font-mono text-sm">{v.toFixed(2)}</span> : <span className="text-xs text-muted-foreground">-</span>
      },
      size: 90,
    }),
    columnHelper.accessor('holdingAmount', {
      header: '投入金额',
      cell: ({ getValue }) => {
        const v = getValue()
        return v ? <span className="font-mono text-sm">¥{v.toFixed(2)}</span> : <span className="text-xs text-muted-foreground">-</span>
      },
      size: 100,
    }),
    columnHelper.accessor('holdingProfit', {
      header: '持有收益',
      cell: ({ getValue }) => {
        const v = getValue()
        if (!v) return <span className="text-xs text-muted-foreground">-</span>
        const color = v >= 0 ? 'text-red-500' : 'text-green-500'
        const prefix = v >= 0 ? '+' : ''
        return <span className={`font-mono text-sm ${color}`}>{prefix}¥{v.toFixed(2)}</span>
      },
      size: 100,
    }),
    columnHelper.display({
      id: 'marketValue',
      header: '参考市值',
      cell: ({ row }) => {
        const { costNAV, shares, holdingAmount, holdingProfit } = row.original
        // 优先用方式一：成本×份额；否则用方式二：投入+收益
        const mv = (costNAV && shares) ? costNAV * shares
          : (holdingAmount) ? holdingAmount + (holdingProfit || 0)
          : 0
        return mv ? <span className="font-mono text-sm font-medium">¥{mv.toFixed(2)}</span> : <span className="text-xs text-muted-foreground">-</span>
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
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeHolding(row.original.id)}>
          <Trash2 className="h-3 w-3 text-muted-foreground" />
        </Button>
      ),
      size: 50,
    }),
  ], [allSelected, someSelected, selectedIds, toggleSelected, selectAll, clearSelection, removeHolding])

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
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
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
          {selectedIds.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              className="h-7 text-xs"
              onClick={() => removeHoldings(selectedIds)}
            >
              <Trash2 className="h-3 w-3 mr-1" />删除选中 ({selectedIds.length})
            </Button>
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
                   col.id === 'holdingAmount' ? '投入金额' :
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
      <div className="rounded-md border">
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
                <TableRow key={row.id} data-state={selectedIds.includes(row.original.id) ? 'selected' : undefined}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center py-12 text-muted-foreground">
                  {holdings.length === 0
                    ? '暂无持仓数据。点击上方"添加基金"或"导入"开始。'
                    : '没有匹配的持仓记录'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Summary */}
      <div className="text-xs text-muted-foreground">
        共 {holdings.length} 只基金
        {typeFilter !== 'all' && `（已筛选: ${TYPE_LABELS[typeFilter]}）`}
        {selectedIds.length > 0 && `，已选 ${selectedIds.length} 只`}
        {holdings.length > 0 && ` | 参考市值: ¥${holdings.reduce((sum, h) => sum + (
          (h.costNAV && h.shares) ? h.costNAV * h.shares
          : h.holdingAmount ? h.holdingAmount + (h.holdingProfit || 0)
          : 0
        ), 0).toFixed(2)}`}
      </div>
    </div>
  )
}
