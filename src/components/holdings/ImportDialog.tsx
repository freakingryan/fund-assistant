import { useState, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle } from 'lucide-react'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { useHoldingsStore } from '@/stores/holdings'
import { autoClassify } from '@/lib/classification'
import type { FundHolding, Market, FundType, FundSector } from '@/types'

// 常见中文列名映射
const COLUMN_ALIASES: Record<string, string> = {
  '基金代码': 'code', '代码': 'code', 'code': 'code', 'fund_code': 'code',
  '基金名称': 'name', '名称': 'name', 'name': 'name', 'fund_name': 'name',
  '市场': 'market', 'market': 'market',
  '基金类型': 'type', '类型': 'type', 'type': 'type',
  '投资领域': 'sector', '领域': 'sector', 'sector': 'sector',
  '持仓成本': 'costNAV', '成本净值': 'costNAV', '成本': 'costNAV', 'cost': 'costNAV',
  '持有份额': 'shares', '份额': 'shares', 'shares': 'shares',
  '购买日期': 'purchaseDate', '日期': 'purchaseDate', 'date': 'purchaseDate',
  '标签': 'tags', 'tags': 'tags',
  '备注': 'notes', '备注': 'notes', 'notes': 'notes',
}

type ImportRow = Partial<Record<string, string | number>>

const MARKET_OPTIONS: Market[] = ['A', 'HK', 'US']
const TYPE_OPTIONS: FundType[] = ['stock', 'mixed', 'bond', 'index', 'qdii', 'money', 'etf', 'other']
const SECTOR_OPTIONS: FundSector[] = [
  'tech', 'consumer', 'healthcare', 'new_energy', 'finance',
  'manufacturing', 'broad_market', 'global', 'bond_market', 'commodity', 'other',
]

const TYPE_LABELS: Record<FundType, string> = {
  stock: '股票型', mixed: '混合型', bond: '债券型', index: '指数型',
  qdii: 'QDII', money: '货币型', etf: 'ETF', other: '其他',
}
const MARKET_LABELS: Record<Market, string> = { A: 'A股', HK: '港股', US: '美股' }
const SECTOR_LABELS: Record<FundSector, string> = {
  tech: '科技', consumer: '消费', healthcare: '医药', new_energy: '新能源',
  finance: '金融', manufacturing: '制造', broad_market: '宽基',
  global: '全球', bond_market: '债市', commodity: '大宗商品',
  real_estate: '地产', other: '其他',
}

interface ParsedRow {
  code: string
  name: string
  market: Market
  type: FundType
  sector: FundSector
  costNAV: number
  shares: number
  purchaseDate: string
  tags: string
  notes: string
}

function parseFile(file: File): Promise<ImportRow[]> {
  return new Promise((resolve, reject) => {
    const ext = file.name.split('.').pop()?.toLowerCase()

    if (ext === 'csv') {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => resolve(results.data as ImportRow[]),
        error: (err) => reject(err),
      })
    } else if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader()
      reader.onload = (e) => {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const json = XLSX.utils.sheet_to_json<ImportRow>(sheet)
        resolve(json)
      }
      reader.onerror = reject
      reader.readAsArrayBuffer(file)
    } else {
      reject(new Error('不支持的文件格式，请上传 .csv 或 .xlsx 文件'))
    }
  })
}

function normalizeRow(row: ImportRow): ParsedRow | null {
  const mapped: Record<string, string> = {}
  for (const [key, val] of Object.entries(row)) {
    const normalized = COLUMN_ALIASES[key.trim()] || key.trim().toLowerCase()
    mapped[normalized] = String(val ?? '')
  }

  const code = mapped.code?.trim()
  const name = mapped.name?.trim()
  if (!code || !name) return null

  const auto = autoClassify(code, name)

  return {
    code,
    name,
    market: (mapped.market as Market) || auto.market,
    type: (mapped.type as FundType) || auto.type,
    sector: (mapped.sector as FundSector) || auto.sector,
    costNAV: Number(mapped.costNAV) || 0,
    shares: Number(mapped.shares) || 0,
    purchaseDate: mapped.purchaseDate || new Date().toISOString().slice(0, 10),
    tags: mapped.tags || '',
    notes: mapped.notes || '',
  }
}

export default function ImportDialog() {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload')

  const importHoldings = useHoldingsStore((s) => s.importHoldings)

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const data = await parseFile(file)
      const parsed: ParsedRow[] = []
      const errs: string[] = []

      for (let i = 0; i < data.length; i++) {
        const normalized = normalizeRow(data[i])
        if (normalized) {
          parsed.push(normalized)
        } else {
          errs.push(`第 ${i + 1} 行缺少基金代码或名称`)
        }
      }

      if (parsed.length === 0) {
        setErrors(['没有解析到有效数据。请检查文件格式。'])
        return
      }

      setRows(parsed)
      setErrors(errs)
      setStep('preview')
    } catch (err) {
      setErrors([String(err)])
    }
  }, [])

  const updateRow = (index: number, field: keyof ParsedRow, value: string | number) => {
    setRows((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })
  }

  const handleImport = useCallback(async () => {
    const records = rows.map((r) => ({
      code: r.code,
      name: r.name,
      market: r.market,
      type: r.type,
      sector: r.sector,
      costNAV: r.costNAV,
      shares: r.shares,
      purchaseDate: r.purchaseDate,
      tags: r.tags ? r.tags.split(/[,，]/g).map((s: string) => s.trim()).filter(Boolean) : [],
      notes: r.notes,
    }))
    await importHoldings(records)
    setStep('done')
  }, [rows, importHoldings])

  const reset = () => {
    setOpen(false)
    setTimeout(() => {
      setRows([])
      setErrors([])
      setStep('upload')
    }, 300)
  }

  const validCount = useMemo(() => rows.filter((r) => r.costNAV > 0).length, [rows])

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="h-4 w-4 mr-2" />导入
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>导入持仓数据</DialogTitle>
          <DialogDescription>上传 CSV 或 Excel 文件，支持自动识别字段</DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div className="space-y-4">
            <div className="border-2 border-dashed rounded-lg p-8 text-center">
              <FileSpreadsheet className="h-10 w-10 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mb-2">拖放文件到此处，或点击下方按钮</p>
              <Input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFile}
                className="max-w-xs mx-auto"
              />
              <p className="text-xs text-muted-foreground mt-2">支持 .csv, .xlsx 格式</p>
            </div>

            {errors.length > 0 && (
              <div className="space-y-1 rounded-md border border-destructive/50 bg-destructive/10 p-3">
                {errors.map((e, i) => (
                  <p key={i} className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> {e}
                  </p>
                ))}
              </div>
            )}

            <div>
              <p className="text-xs text-muted-foreground mb-1">支持的列名（自动识别）：</p>
              <div className="flex flex-wrap gap-1">
                {['基金代码', '基金名称', '市场', '基金类型', '投资领域', '持仓成本', '持有份额', '购买日期', '标签', '备注'].map((col) => (
                  <Badge key={col} variant="secondary" className="text-[10px]">{col}</Badge>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm">
                解析到 <strong>{rows.length}</strong> 条记录
                {validCount < rows.length && (
                  <span className="text-muted-foreground">（{validCount} 条有持仓成本）</span>
                )}
              </p>
            </div>

            <div className="border rounded-md max-h-60 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[80px]">代码</TableHead>
                    <TableHead>名称</TableHead>
                    <TableHead className="w-[70px]">市场</TableHead>
                    <TableHead className="w-[80px]">类型</TableHead>
                    <TableHead className="w-[70px]">成本</TableHead>
                    <TableHead className="w-[70px]">份额</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 20).map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-mono">{row.code}</TableCell>
                      <TableCell className="text-xs">{row.name}</TableCell>
                      <TableCell>
                        <Select value={row.market} onValueChange={(v) => updateRow(i, 'market', v)}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {MARKET_OPTIONS.map((m) => (
                              <SelectItem key={m} value={m}>{MARKET_LABELS[m]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select value={row.type} onValueChange={(v) => updateRow(i, 'type', v)}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {TYPE_OPTIONS.map((t) => (
                              <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-xs">{row.costNAV || '-'}</TableCell>
                      <TableCell className="text-xs">{row.shares || '-'}</TableCell>
                    </TableRow>
                  ))}
                  {rows.length > 20 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-xs text-muted-foreground text-center">
                        ... 还有 {rows.length - 20} 条记录
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setStep('upload')}>返回</Button>
              <Button size="sm" onClick={handleImport}>
                <CheckCircle className="h-3 w-3 mr-2" />确认导入 {rows.length} 条
              </Button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="text-center py-6 space-y-3">
            <CheckCircle className="h-12 w-12 mx-auto text-green-500" />
            <p className="text-lg font-semibold">导入成功</p>
            <p className="text-sm text-muted-foreground">已导入 {rows.length} 条持仓记录</p>
            <Button onClick={reset}>完成</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
