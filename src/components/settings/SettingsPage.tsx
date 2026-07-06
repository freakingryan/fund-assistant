import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Key, Database, BellRing, Globe, SunMoon, Sparkles, Loader2, Download, Upload, Cloud, CheckCircle, AlertCircle, Activity } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useState } from 'react'
import { useSettingsStore } from '@/stores/settings'
import { useHoldingsStore } from '@/stores/holdings'
import { usePlansStore } from '@/stores/plans'
import { testAIConnection } from '@/services/ai'
import { dataSourceService } from '@/adapters/datasource/service'
import { exportAllData, importAllData, downloadBackup, readBackupFile, syncToGist, loadFromGist, findFundGist, verifyGistToken } from '@/services/backup'
import { toast } from '@/components/ui/toast'

export default function SettingsPage() {
  const settings = useSettingsStore((s) => s.settings)
  const updateDataSource = useSettingsStore((s) => s.updateDataSource)
  const updateAIConfig = useSettingsStore((s) => s.updateAIConfig)
  const updateNotifications = useSettingsStore((s) => s.updateNotifications)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  const [syncing, setSyncing] = useState(false)
  const [importResult, setImportResult] = useState<{ ok: boolean; msg: string } | null>(null)
  // F13: 备份导入前先确认（避免静默覆盖），成功后 SPA 状态刷新替代整页 reload
  const [pendingRestore, setPendingRestore] = useState<{ holdings: number; plans: number; apply: () => Promise<void> } | null>(null)
  const [importing, setImporting] = useState(false)
  const [syncResult, setSyncResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [testingAi, setTestingAi] = useState<string | null>(null)
  const [health, setHealth] = useState<{
    stockApi?: { ok: boolean; latency: number; error?: string }
    fundgz?: { ok: boolean; latency: number; error?: string }
    pingzhongdata?: { ok: boolean; latency: number; error?: string }
  } | null>(null)
  const [healthChecking, setHealthChecking] = useState(false)

  // 检查数据源健康状态
  const handleCheckHealth = async () => {
    setHealthChecking(true)
    setHealth(null)
    try {
      const result = await dataSourceService.checkHealth()
      setHealth(result)
    } catch (e: any) {
      setHealth({ stockApi: { ok: false, latency: 0, error: String(e) } })
    }
    setHealthChecking(false)
  }

  // 导出备份
  const handleExport = async () => {
    const data = await exportAllData()
    downloadBackup(data)
    setImportResult({ ok: true, msg: `已导出 ${data.holdings.length} 只持仓` })
    setTimeout(() => setImportResult(null), 3000)
  }

  // 导入备份（F13: 仅读取并打开确认弹窗，不立即覆盖）
  const handleImport = async () => {
    try {
      const data = await readBackupFile()
      setPendingRestore({ holdings: data.holdings.length, plans: data.plans.length, apply: () => importAllData(data) })
    } catch (e) {
      setImportResult({ ok: false, msg: String(e) })
    }
  }

  // 确认恢复：覆盖写入 + SPA 状态刷新（替代整页 reload）
  const confirmRestore = async () => {
    if (!pendingRestore) return
    setImporting(true)
    try {
      await pendingRestore.apply()
      await Promise.all([
        useHoldingsStore.getState().loadHoldings(),
        usePlansStore.getState().loadPlan(),
        usePlansStore.getState().loadAlerts(),
        useSettingsStore.getState().loadSettings(),
      ])
      setImportResult({ ok: true, msg: `已恢复 ${pendingRestore.holdings} 只持仓、${pendingRestore.plans} 个计划` })
      toast({ type: 'success', message: '备份导入成功' })
      setPendingRestore(null)
    } catch (e) {
      setImportResult({ ok: false, msg: String(e) })
    } finally {
      setImporting(false)
    }
  }

  // 推送到 Gist
  const [gistVerifyResult, setGistVerifyResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [verifyingToken, setVerifyingToken] = useState(false)

  const handleVerifyToken = async () => {
    if (!settings.sync.gistToken) return
    setVerifyingToken(true); setGistVerifyResult(null)
    try {
      const result = await verifyGistToken(settings.sync.gistToken)
      setGistVerifyResult(result)
    } catch (e) {
      setGistVerifyResult({ ok: false, msg: String(e) })
    }
    setVerifyingToken(false)
  }

  const handleGistPush = async () => {
    setSyncing(true); setSyncResult(null)
    try {
      const data = await exportAllData()
      const gistId = await syncToGist(settings.sync.gistToken, settings.sync.gistId || null, data)
      if (!settings.sync.gistId) {
        updateSettings({ sync: { ...settings.sync, gistId } })
      }
      setSyncResult({ ok: true, msg: `已同步到 Gist（${gistId}），共 ${data.holdings.length} 只持仓` })
    } catch (e) {
      setSyncResult({ ok: false, msg: String(e) })
    }
    setSyncing(false)
  }

  // 从 Gist 拉取（F13: 先读取，打开确认弹窗，不立即覆盖）
  const handleGistPull = async () => {
    setSyncing(true); setSyncResult(null)
    try {
      let gistId: string | null = settings.sync.gistId || null
      if (!gistId) {
        gistId = await findFundGist(settings.sync.gistToken)
        if (!gistId) {
          setSyncResult({ ok: false, msg: '未找到备份 Gist，请先在原设备上推送到 Gist' })
          setSyncing(false); return
        }
        updateSettings({ sync: { ...settings.sync, gistId } })
      }
      const data = await loadFromGist(settings.sync.gistToken, gistId!)
      setPendingRestore({ holdings: data.holdings.length, plans: data.plans.length, apply: () => importAllData(data) })
    } catch (e) {
      setSyncResult({ ok: false, msg: String(e) })
    }
    setSyncing(false)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">设置</h1>
        <p className="text-sm text-muted-foreground mt-1">配置数据源、AI 平台、存储和通知</p>
      </div>

      <Tabs defaultValue="datasource" className="space-y-4">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="datasource" className="flex items-center gap-1 text-[10px] sm:text-xs"><Database className="h-3 w-3" /> 数据源</TabsTrigger>
          <TabsTrigger value="ai" className="flex items-center gap-1 text-[10px] sm:text-xs"><Key className="h-3 w-3" /> AI 平台</TabsTrigger>
          <TabsTrigger value="storage" className="flex items-center gap-1 text-[10px] sm:text-xs"><Globe className="h-3 w-3" /> 存储</TabsTrigger>
          <TabsTrigger value="notifications" className="flex items-center gap-1 text-[10px] sm:text-xs"><BellRing className="h-3 w-3" /> 通知</TabsTrigger>
          <TabsTrigger value="appearance" className="flex items-center gap-1 text-[10px] sm:text-xs"><SunMoon className="h-3 w-3" /> 外观</TabsTrigger>
          <TabsTrigger value="backup" className="flex items-center gap-1 text-[10px] sm:text-xs"><Cloud className="h-3 w-3" /> 备份</TabsTrigger>
        </TabsList>

        {/* 数据源 */}
        <TabsContent value="datasource">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">数据源配置</CardTitle>
              <CardDescription>配置 Tushare Token 和默认数据源</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>默认数据源</Label>
                <Select
                  value={settings.dataSource.primarySource}
                  onValueChange={(v) => updateDataSource({ primarySource: v as 'tushare' })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tushare">Tushare</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Tushare Token</Label>
                  <span className="text-[10px] text-muted-foreground">已在 MCP 配置中管理</span>
                </div>
                <Input
                  type="password"
                  value={settings.dataSource.tushareToken}
                  onChange={(e) => updateDataSource({ tushareToken: e.target.value })}
                  placeholder="可选 — 供浏览器端直接调用 Tushare HTTP API"
                  className="flex-1"
                />
              </div>
            </CardContent>
          </Card>

          {/* 数据源状态 */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">数据源状态</CardTitle>
                <Button
                  variant="outline" size="sm" className="h-7 text-xs"
                  onClick={handleCheckHealth}
                  disabled={healthChecking}
                >
                  {healthChecking ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Activity className="h-3 w-3 mr-1" />}
                  检查连通性
                </Button>
              </div>
              <CardDescription>stock-api / 东方财富 数据源可用性检查</CardDescription>
            </CardHeader>
            <CardContent>
              {!health && !healthChecking && (
                <p className="text-xs text-muted-foreground">点击「检查连通性」测试各数据源状态</p>
              )}
              {healthChecking && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />检测中...
                </div>
              )}
              {health && !healthChecking && (
                <div className="space-y-2">
                  {Object.entries(health).map(([key, val]) => (
                    <div key={key} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        {val.ok ? (
                          <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                        ) : (
                          <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                        )}
                        <span className="font-medium">{{
                          stockApi: 'stock-api（腾讯接口）',
                          fundgz: 'fundgz（实时净值）',
                          pingzhongdata: 'pingzhongdata（历史数据）',
                        }[key] || key}</span>
                      </div>
                      <span className="text-muted-foreground">
                        {val.ok
                          ? `${val.latency}ms`
                          : `❌ ${val.error || '无响应'}`
                        }
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI 平台 */}
        <TabsContent value="ai">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">AI 平台配置</CardTitle>
              <CardDescription>添加 AI 平台 API Key，用于持仓截图识别和基金自动补全</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 默认 AI 平台选择 */}
              <div className="space-y-2">
                <Label>默认 AI 平台</Label>
                <Select
                  value={settings.aiConfigs.some((c) => c.apiKey && c.provider === settings.defaultAIProvider) ? settings.defaultAIProvider : '__placeholder__'}
                  onValueChange={(v) => v !== '__placeholder__' && updateSettings({ defaultAIProvider: v as any })}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="选择默认使用的平台" /></SelectTrigger>
                  <SelectContent>
                    {settings.aiConfigs.filter((c) => c.apiKey).map((c) => (
                      <SelectItem key={c.provider} value={c.provider}>
                        {c.provider === 'google' ? 'Google AI Studio' :
                         c.provider === 'groq' ? 'Groq' :
                         c.provider === 'openrouter' ? 'OpenRouter' :
                         c.provider.charAt(0).toUpperCase() + c.provider.slice(1)}
                      </SelectItem>
                    ))}
                    {settings.aiConfigs.filter((c) => c.apiKey).length === 0 && (
                      <SelectItem value="__placeholder__" disabled>请先配置并测试通过 API Key</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  已配置且测试通过的平台才会出现在下拉列表中
                </p>
              </div>

              <Separator />

              {(['deepseek', 'google', 'openai', 'groq', 'openrouter'] as const).map((provider) => {
                const cfg = settings.aiConfigs.find((c) => c.provider === provider)
                const key = cfg?.apiKey || ''
                const testing = testingAi === provider
                const providerLabel = provider === 'google' ? 'Google AI Studio' :
                  provider === 'groq' ? 'Groq' :
                  provider === 'openrouter' ? 'OpenRouter' :
                  provider.charAt(0).toUpperCase() + provider.slice(1)
                return (
                  <div key={provider} className="space-y-2">
                    <Label className="text-xs flex items-center gap-1">
                      {providerLabel} API Key
                      {key && <span className="w-2 h-2 rounded-full bg-green-500" title="已配置" />}
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        type="password"
                        value={key}
                        onChange={(e) => {
                          const others = settings.aiConfigs.filter((c) => c.provider !== provider)
                          const newConfigs = e.target.value
                            ? [...others, { ...cfg, provider, apiKey: e.target.value }]
                            : others
                          updateAIConfig(newConfigs)
                        }}
                        placeholder={provider === 'google' ? 'AIza...' :
                          provider === 'groq' ? 'gsk_...' :
                          provider === 'openrouter' ? 'sk-or-v1-...' :
                          'sk-...'}
                        className="flex-1"
                      />
                      <Button
                        variant={key ? 'outline' : 'secondary'} size="sm" className="h-9 shrink-0 text-xs"
                        disabled={!key || testing}
                        onClick={async () => {
                          setTestingAi(provider)
                          const result = await testAIConnection({ ...cfg, provider, apiKey: key })
                          // 测试失败 → 清除 Key
                          if (!result.ok) {
                            const others = settings.aiConfigs.filter((c) => c.provider !== provider)
                            updateAIConfig(others)
                          }
                          toast({ type: result.ok ? 'success' : 'error', message: result.message })
                          setTestingAi(null)
                        }}
                      >
                        {testing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
                        测试
                      </Button>
                    </div>
                  </div>
                )
              })}
              <Separator />
              <div className="space-y-2">
                <Label className="text-xs">自定义 API</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Base URL"
                    value={settings.aiConfigs.find((c) => c.provider === 'custom')?.baseURL || ''}
                    onChange={(e) => {
                      const others = settings.aiConfigs.filter((c) => c.provider !== 'custom')
                      const existing = settings.aiConfigs.find((c) => c.provider === 'custom')
                      updateAIConfig([...others, {
                        provider: 'custom',
                        apiKey: existing?.apiKey || '',
                        baseURL: e.target.value,
                        model: existing?.model,
                      }])
                    }}
                  />
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      placeholder="API Key"
                      value={settings.aiConfigs.find((c) => c.provider === 'custom')?.apiKey || ''}
                      onChange={(e) => {
                        const others = settings.aiConfigs.filter((c) => c.provider !== 'custom')
                        const existing = settings.aiConfigs.find((c) => c.provider === 'custom')
                        updateAIConfig([...others, {
                          provider: 'custom',
                          apiKey: e.target.value,
                          baseURL: existing?.baseURL,
                          model: existing?.model,
                        }])
                      }}
                      className="flex-1"
                    />
                    {(() => {
                      const custom = settings.aiConfigs.find((c) => c.provider === 'custom')
                      const testing = testingAi === 'custom'
                      return custom?.apiKey ? (
                        <Button
                          variant="outline" size="sm" className="h-9 shrink-0 text-xs"
                          disabled={testing}
                          onClick={async () => {
                            setTestingAi('custom')
                            const result = await testAIConnection(custom)
                            if (!result.ok) {
                              const others = settings.aiConfigs.filter((c) => c.provider !== 'custom')
                              updateAIConfig(others)
                            }
                            toast({ type: result.ok ? 'success' : 'error', message: result.message })
                            setTestingAi(null)
                          }}
                        >
                          {testing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
                          测试
                        </Button>
                      ) : null
                    })()}
                </div>
              </div>
            </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 存储 */}
        <TabsContent value="storage">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">存储配置</CardTitle>
              <CardDescription>选择数据存储方式，默认使用浏览器本地存储（IndexedDB）</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                <div>
                  <Label className="text-sm">浏览器本地存储</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">数据保存在当前设备 IndexedDB，可通过「备份」页面导出/同步</p>
                </div>
                <Badge variant="secondary" className="text-[10px] shrink-0">当前</Badge>
              </div>
              <Separator />
              <div className="space-y-2 opacity-50 pointer-events-none">
                <div className="flex items-center justify-between">
                  <Label>Notion 同步</Label>
                  <Badge variant="outline" className="text-[10px]">即将推出</Badge>
                </div>
                <Input disabled placeholder="Notion Integration Token" />
                <Input disabled placeholder="Notion Database ID" />
                <p className="text-xs text-muted-foreground">Notion 同步正在开发中，敬请期待。目前可通过 GitHub Gist 实现跨设备同步。</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 通知 */}
        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">通知设置</CardTitle>
              <CardDescription>配置推送通知的触发条件</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>浏览器推送通知</Label>
                  <p className="text-xs text-muted-foreground">投资计划触发时收到浏览器通知</p>
                </div>
                <Switch
                  checked={settings.notifications.browser}
                  onCheckedChange={(v) => updateNotifications({ browser: v })}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>飞书通知（预留）</Label>
                  <p className="text-xs text-muted-foreground">通过飞书机器人发送通知消息</p>
                </div>
                <Switch
                  checked={settings.notifications.feishu}
                  onCheckedChange={(v) => updateNotifications({ feishu: v })}
                  disabled
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 外观 */}
        <TabsContent value="appearance">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">外观设置</CardTitle>
              <CardDescription>选择界面主题</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>主题</Label>
                <Select
                  value={settings.theme}
                  onValueChange={(v) => updateSettings({ theme: v as any })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">浅色</SelectItem>
                    <SelectItem value="dark">深色</SelectItem>
                    <SelectItem value="system">跟随系统</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 数据备份 */}
        <TabsContent value="backup">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">本地备份</CardTitle>
              <CardDescription>导出/导入 JSON 文件，格式兼容 GitHub Gist 同步</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Button size="sm" onClick={handleExport}>
                  <Download className="h-3 w-3 mr-2" />导出备份
                </Button>
                <Button size="sm" variant="outline" onClick={handleImport}>
                  <Upload className="h-3 w-3 mr-2" />导入备份
                </Button>
              </div>
              {importResult && (
                <p className={`text-xs ${importResult.ok ? 'text-green-500' : 'text-red-500'}`}>
                  {importResult.ok ? <CheckCircle className="h-3 w-3 inline mr-1" /> : <AlertCircle className="h-3 w-3 inline mr-1" />}
                  {importResult.msg}
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-base">GitHub Gist 云端同步</CardTitle>
              <CardDescription>同步到私有 GitHub Gist，换设备可恢复</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs">GitHub Personal Access Token</Label>
                <div className="flex gap-2 mt-1">
                  <Input type="password" placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                    value={settings.sync.gistToken}
                    onChange={(e) => updateSettings({ sync: { ...settings.sync, gistToken: e.target.value } })}
                    className="text-xs font-mono h-8 flex-1" />
                  <Button variant="outline" size="sm" className="h-8 text-xs shrink-0"
                    disabled={!settings.sync.gistToken || verifyingToken}
                    onClick={handleVerifyToken}
                  >
                    {verifyingToken ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    验证 Token
                  </Button>
                </div>
                {gistVerifyResult && (
                  <p className={`text-[10px] mt-1 ${gistVerifyResult.ok ? 'text-green-500' : 'text-red-500'}`}>
                    {gistVerifyResult.ok ? <CheckCircle className="h-3 w-3 inline mr-1" /> : <AlertCircle className="h-3 w-3 inline mr-1" />}
                    {gistVerifyResult.msg}
                  </p>
                )}
              </div>
              <div>
                <Label className="text-xs">Gist ID（首次推送后自动生成）</Label>
                <Input placeholder="自动生成"
                  value={settings.sync.gistId}
                  onChange={(e) => updateSettings({ sync: { ...settings.sync, gistId: e.target.value } })}
                  className="text-xs font-mono h-8 mt-1" />
              </div>
              <div className="flex gap-2">
                <Button size="sm" disabled={!settings.sync.gistToken || syncing} onClick={handleGistPush}>
                  {syncing ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : <Upload className="h-3 w-3 mr-2" />}
                  推送到 Gist
                </Button>
                <Button size="sm" variant="outline" disabled={!settings.sync.gistToken || syncing} onClick={handleGistPull}>
                  {syncing ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : <Download className="h-3 w-3 mr-2" />}
                  从 Gist 恢复
                </Button>
              </div>
              {syncResult && (
                <p className={`text-xs ${syncResult.ok ? 'text-green-500' : 'text-red-500'}`}>
                  {syncResult.ok ? <CheckCircle className="h-3 w-3 inline mr-1" /> : <AlertCircle className="h-3 w-3 inline mr-1" />}
                  {syncResult.msg}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* F13: 备份恢复二次确认 */}
      <Dialog open={!!pendingRestore} onOpenChange={(v) => { if (!v) setPendingRestore(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>恢复备份将覆盖现有数据</DialogTitle>
            <DialogDescription>
              即将用备份中的 <strong>{pendingRestore?.holdings ?? 0}</strong> 只持仓、<strong>{pendingRestore?.plans ?? 0}</strong> 个计划覆盖当前本地数据。此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setPendingRestore(null)} disabled={importing}>取消</Button>
            <Button variant="destructive" size="sm" onClick={confirmRestore} disabled={importing}>
              {importing && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              确认恢复
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
