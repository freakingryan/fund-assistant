import { useState, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle, Loader2, Camera } from 'lucide-react'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { useHoldingsStore } from '@/stores/holdings'
import { toast } from '@/components/ui/toast'
import { autoClassify } from '@/lib/classification'
import { extractFundInfoFromImage } from '@/services/ai'
import { getDefaultAI } from '@/services/ai'
import { fetchFundCodeByName } from '@/adapters/datasource/jsonp-utils'
import { fetchFundQuoteWithFallback } from '@/adapters/datasource/stock-api'
import type { Market, FundType, FundSector } from '@/types'
import { TYPE_LABELS, MARKET_LABELS } from '@/lib/labels'

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
  '备注': 'notes', 'notes': 'notes',
}

type ImportRow = Partial<Record<string, string | number>>

const MARKET_OPTIONS: Market[] = ['A', 'HK', 'US']
const TYPE_OPTIONS: FundType[] = ['stock', 'mixed', 'bond', 'index', 'qdii', 'money', 'etf', 'other']

interface ParsedRow {
  code: string
  name: string
  market: Market
  type: FundType
  sector: FundSector
  costNAV: number
  shares: number
  holdingAmount: number
  holdingProfit: number
  purchaseDate: string
  tags: string
  notes: string
  /** 导入校验时标记为「无法获取行情」（代码缺失/识别有误），需用户手动核对 */
  needsCodeCheck?: boolean
}

function parseFile(file: File): Promise<ImportRow[]> {
  return new Promise((resolve, reject) => {
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext === 'csv') {
      Papa.parse(file, {
        header: true, skipEmptyLines: true,
        complete: (r) => resolve(r.data as ImportRow[]),
        error: (e) => reject(e),
      })
    } else if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader()
      reader.onload = (e) => {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        resolve(XLSX.utils.sheet_to_json<ImportRow>(sheet))
      }
      reader.onerror = reject
      reader.readAsArrayBuffer(file)
    } else {
      reject(new Error('不支持的文件格式'))
    }
  })
}

function normalizeRow(row: ImportRow): ParsedRow | null {
  const mapped: Record<string, string> = {}
  for (const [key, val] of Object.entries(row)) {
    const nk = COLUMN_ALIASES[key.trim()] || key.trim().toLowerCase()
    mapped[nk] = String(val ?? '')
  }
  const code = mapped.code?.trim()
  const name = mapped.name?.trim()
  if (!code || !name) return null
  const auto = autoClassify(code, name)
  return {
    code, name,
    market: (mapped.market as Market) || auto.market,
    type: (mapped.type as FundType) || auto.type,
    sector: (mapped.sector as FundSector) || auto.sector,
    costNAV: Number(mapped.costNAV) || 0,
    shares: Number(mapped.shares) || 0,
    holdingAmount: Number(mapped.holdingAmount) || 0,
    holdingProfit: Number(mapped.holdingProfit) || 0,
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
  const [aiLoading, setAiLoading] = useState(false)
  const [aiConfigured, setAiConfigured] = useState(false)
  const [importing, setImporting] = useState(false)
  const importHoldings = useHoldingsStore((s) => s.importHoldings)

  useEffect(() => {
    if (open) setAiConfigured(!!getDefaultAI())
  }, [open])

  /**
   * 并发校验每只基金代码能否取到行情（带净值兜底）。
   * 取不到（代码缺失 / 识别有误 / 无数据源覆盖）的标记 needsCodeCheck。
   */
  const validateRows = useCallback(async (rows: ParsedRow[]): Promise<ParsedRow[]> => {
    const results = await Promise.allSettled(
      rows.map((r) =>
        r.code
          ? fetchFundQuoteWithFallback(r.code).then((q) => !!q)
          : Promise.resolve(false)
      )
    )
    return rows.map((r, i) => ({
      ...r,
      needsCodeCheck: !(results[i].status === 'fulfilled' && results[i].value),
    }))
  }, [])

  /** 校验后写入预览，并对无法获取行情的基金给出提示 */
  const validateAndPreview = useCallback(async (parsed: ParsedRow[], rowErrors: string[]) => {
    const validated = await validateRows(parsed)
    const failed = validated.filter((r) => r.needsCodeCheck)
    setRows(validated)
    if (failed.length > 0) {
      const examples = failed.slice(0, 3).map((r) => r.code || r.name).join('、')
      const msg = `有 ${failed.length} 只基金代码待核对（可能无法获取行情）：${examples}${failed.length > 3 ? ' 等' : ''}，导入后请补全代码`
      setErrors([...rowErrors, msg])
      toast({ type: 'warning', message: msg })
    } else {
      setErrors(rowErrors)
    }
    setStep('preview')
  }, [validateRows, toast])

  // ---- CSV/Excel ----
  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    try {
      const data = await parseFile(file)
      const parsed: ParsedRow[] = []; const errs: string[] = []
      for (let i = 0; i < data.length; i++) {
        const n = normalizeRow(data[i])
        if (n) { parsed.push(n) } else { errs.push(`第 ${i + 1} 行缺少基金代码或名称`) }
      }
      if (parsed.length === 0) { setErrors(['没有解析到有效数据']); return }
      await validateAndPreview(parsed, errs)
    } catch (err) { setErrors([String(err)]) }
  }, [validateAndPreview])

  // ---- Image + AI ----
  const handleImage = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setAiLoading(true); setErrors([])
    try {
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.readAsDataURL(file)
      })
      const result = await extractFundInfoFromImage(dataUrl)
      if (result.holdings.length === 0) {
        setErrors([`AI 未能识别出基金信息。原始回复：${result.raw.slice(0, 200)}`])
        setAiLoading(false)
        return
      }
      // 截图常缺基金代码（京东金融/支付宝等），按名称反查 6 位代码，使导入后可用行情
      let resolvedCount = 0
      const enriched = await Promise.all(result.holdings.map(async (h) => {
        let code = h.code
        if (!code && h.name) {
          try {
            const found = await fetchFundCodeByName(h.name)
            if (found) { code = found.code; resolvedCount++ }
          } catch { /* 解析失败则保留空码，导入后由用户手动补全 */ }
        }
        return { ...h, code }
      }))
      const parsed: ParsedRow[] = enriched.map((h) => {
        const auto = autoClassify(h.code, h.name)
        return {
          code: h.code, name: h.name,
          market: auto.market, type: auto.type, sector: auto.sector,
          costNAV: h.costNAV || 0,
          shares: h.shares || 0,
          holdingAmount: h.holdingAmount || 0,
          holdingProfit: h.holdingProfit || 0,
          purchaseDate: new Date().toISOString().slice(0, 10),
          tags: '', notes: '',
        }
      })
      if (resolvedCount > 0) {
        toast({ type: 'info', message: `已通过基金名称自动识别 ${resolvedCount} 只基金的代码` })
      }
      await validateAndPreview(parsed, [])
    } catch (err) {
      setErrors([String(err)])
    }
    setAiLoading(false)
  }, [])

  const updateRow = (index: number, field: keyof ParsedRow, value: string | number) => {
    setRows((prev) => { const next = [...prev]; next[index] = { ...next[index], [field]: value }; return next })
  }

  const handleImport = useCallback(async () => {
    setImporting(true)
    try {
      // 按 code 去重，避免同一 CSV 重复导入产生重复持仓
      const seen = new Set<string>()
      const deduped = rows.filter((r) => {
        if (seen.has(r.code)) return false
        seen.add(r.code)
        return true
      })
      const dupCount = rows.length - deduped.length
      const records = deduped.map((r) => ({
        code: r.code, name: r.name, market: r.market, type: r.type, sector: r.sector,
        costNAV: r.costNAV, shares: r.shares,
        holdingAmount: r.holdingAmount || 0, holdingProfit: r.holdingProfit || 0,
        purchaseDate: r.purchaseDate,
        tags: r.tags ? r.tags.split(/[,，]/).map((s: string) => s.trim()).filter(Boolean) : [],
        notes: r.notes,
      }))
      const result = await importHoldings(records)
      const parts: string[] = []
      if (result.added) parts.push(`新增 ${result.added}`)
      if (result.updated) parts.push(`更新 ${result.updated}`)
      const dupNote = dupCount > 0 ? `（已去重 ${dupCount} 条）` : ''
      const msg = parts.length
        ? `导入完成：${parts.join('，')}${dupNote}`
        : `导入完成${dupNote}`
      toast({ type: 'success', message: msg })
      setStep('done')
    } catch (e) {
      toast({ type: 'error', message: `导入失败：${String(e)}` })
    } finally {
      setImporting(false)
    }
  }, [rows, importHoldings])

  // #9: 弹窗关闭时重置状态，不用 setTimeout
  useEffect(() => {
    if (!open) { setRows([]); setErrors([]); setStep('upload') }
  }, [open])

  const reset = () => {
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v) }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="h-4 w-4 mr-2" />导入
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>导入持仓数据</DialogTitle>
          <DialogDescription>上传 CSV/Excel 文件，或上传持仓截图由 AI 提取（支持京东金融、支付宝、天天基金等）</DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <Tabs defaultValue="file" className="space-y-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="file" className="flex items-center gap-1">
                <FileSpreadsheet className="h-3 w-3" /> 文件导入
              </TabsTrigger>
              <TabsTrigger value="image" className="flex items-center gap-1">
                <Camera className="h-3 w-3" /> 截图导入 {aiConfigured ? '🤖' : ''}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="file" className="space-y-4">
              <div className="border-2 border-dashed rounded-lg p-8 text-center">
                <FileSpreadsheet className="h-10 w-10 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground mb-2">拖放文件或点击选择</p>
                <Input type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} className="max-w-xs mx-auto" />
                <p className="text-xs text-muted-foreground mt-2">支持 .csv, .xlsx 格式</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">支持的列名（自动识别）：</p>
                <div className="flex flex-wrap gap-1">
                  {['基金代码', '基金名称', '市场', '基金类型', '持仓成本', '持有份额'].map((c) => (
                    <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="image" className="space-y-4">
              {!aiConfigured ? (
                <div className="border-2 border-dashed rounded-lg p-6 text-center space-y-2">
                  <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground" />
                  <p className="text-sm font-medium">需要配置 AI API Key</p>
                  <p className="text-xs text-muted-foreground">
                    请先在「设置 → AI 平台」中配置 DeepSeek 或其他 AI 的 API Key
                  </p>
                </div>
              ) : (
                <div className="border-2 border-dashed rounded-lg p-8 text-center space-y-3">
                  {aiLoading ? (
                    <div className="space-y-3">
                      <Loader2 className="h-10 w-10 mx-auto animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground">AI 正在分析截图...</p>
                    </div>
                  ) : (
                    <>
                      <Camera className="h-10 w-10 mx-auto text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">上传持仓截图（京东金融 / 支付宝 / 天天基金等），AI 自动识别基金名称、金额、收益</p>
                      <Input type="file" accept="image/*" capture="environment" onChange={handleImage} className="max-w-xs mx-auto" />
                      <p className="text-xs text-muted-foreground">支持 JPG/PNG，建议截图清晰完整</p>
                    </>
                  )}
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}

        {errors.length > 0 && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 space-y-1">
            {errors.map((e, i) => (
              <p key={i} className="text-xs text-destructive flex items-start gap-1">
                <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" /> {e}
              </p>
            ))}
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm">
                解析到 <strong>{rows.length}</strong> 条记录
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
                    <TableHead className="w-[80px]">金额</TableHead>
                    <TableHead className="w-[75px]">收益</TableHead>
                    <TableHead className="w-[65px]">成本</TableHead>
                    <TableHead className="w-[65px]">份额</TableHead>
                    <TableHead className="w-[64px]">状态</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 20).map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-mono">{row.code || '-'}</TableCell>
                      <TableCell className="text-xs">{row.name}</TableCell>
                      <TableCell>
                        <Select value={row.market} onValueChange={(v) => updateRow(i, 'market', v)}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{MARKET_OPTIONS.map((m) => <SelectItem key={m} value={m}>{MARKET_LABELS[m]}</SelectItem>)}</SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select value={row.type} onValueChange={(v) => updateRow(i, 'type', v)}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{TYPE_OPTIONS.map((t) => <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-xs">{row.holdingAmount ? `¥${row.holdingAmount.toLocaleString()}` : '-'}</TableCell>
                      <TableCell className={`text-xs ${row.holdingProfit > 0 ? 'text-up' : row.holdingProfit < 0 ? 'text-down' : ''}`}>
                        {row.holdingProfit ? `${row.holdingProfit > 0 ? '+' : ''}${row.holdingProfit.toLocaleString()}` : '-'}
                      </TableCell>
                      <TableCell className="text-xs">{row.costNAV || '-'}</TableCell>
                      <TableCell className="text-xs">{row.shares || '-'}</TableCell>
                      <TableCell>
                        {row.needsCodeCheck ? (
                          <Badge variant="destructive" className="text-[10px]">待核对</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px] text-green-600">✓</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setStep('upload')} disabled={importing}>返回</Button>
              <Button size="sm" onClick={handleImport} disabled={importing}>
                {importing ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : <CheckCircle className="h-3 w-3 mr-2" />}
                {importing ? '导入中...' : `确认导入 ${rows.length} 条`}
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
