import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Key, Database, BellRing, Globe, SunMoon, Save, Link, Plus, Trash2, Sparkles, Loader2 } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useState } from 'react'
import { useSettingsStore } from '@/stores/settings'
import { fetchEtfMapping } from '@/services/ai'

export default function SettingsPage() {
  const etfMappings = useSettingsStore((s) => s.settings.etfMappings)
  const addEtfMapping = useSettingsStore((s) => s.addEtfMapping)
  const removeEtfMapping = useSettingsStore((s) => s.removeEtfMapping)

  const [newOtcCode, setNewOtcCode] = useState('')
  const [newOtcName, setNewOtcName] = useState('')
  const [newExCode, setNewExCode] = useState('')
  const [newExName, setNewExName] = useState('')
  const [etfAiLoading, setEtfAiLoading] = useState(false)
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">设置</h1>
        <p className="text-sm text-muted-foreground mt-1">配置数据源、AI 平台、存储和通知</p>
      </div>

      <Tabs defaultValue="datasource" className="space-y-4">
        <TabsList>
          <TabsTrigger value="datasource" className="flex items-center gap-1">
            <Database className="h-3 w-3" /> 数据源
          </TabsTrigger>
          <TabsTrigger value="ai" className="flex items-center gap-1">
            <Key className="h-3 w-3" /> AI 平台
          </TabsTrigger>
          <TabsTrigger value="storage" className="flex items-center gap-1">
            <Globe className="h-3 w-3" /> 存储
          </TabsTrigger>
          <TabsTrigger value="notifications" className="flex items-center gap-1">
            <BellRing className="h-3 w-3" /> 通知
          </TabsTrigger>
          <TabsTrigger value="etf" className="flex items-center gap-1">
            <Link className="h-3 w-3" /> ETF 映射
          </TabsTrigger>
          <TabsTrigger value="appearance" className="flex items-center gap-1">
            <SunMoon className="h-3 w-3" /> 外观
          </TabsTrigger>
        </TabsList>

        <TabsContent value="datasource">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">数据源配置</CardTitle>
              <CardDescription>配置 Tushare Token 和默认数据源</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>默认数据源</Label>
                <Select defaultValue="tushare">
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tushare">Tushare</SelectItem>
                    <SelectItem value="westock">西股数据</SelectItem>
                    <SelectItem value="neodata">NeoData</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tushare Token</Label>
                <Input type="password" placeholder="输入 Tushare API Token" />
              </div>
              <Button size="sm"><Save className="h-3 w-3 mr-2" />保存</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">AI 平台配置</CardTitle>
              <CardDescription>添加你的 AI 平台 API Key，用于投资建议生成</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>DeepSeek API Key</Label>
                <Input type="password" placeholder="sk-..." />
              </div>
              <div className="space-y-2">
                <Label>Google AI Studio API Key</Label>
                <Input type="password" placeholder="AIza..." />
              </div>
              <div className="space-y-2">
                <Label>OpenAI API Key</Label>
                <Input type="password" placeholder="sk-..." />
              </div>
              <Separator />
              <div className="space-y-2">
                <Label>自定义 API</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Base URL" />
                  <Input type="password" placeholder="API Key" />
                </div>
              </div>
              <Button size="sm"><Save className="h-3 w-3 mr-2" />保存</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="storage">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">存储配置</CardTitle>
              <CardDescription>选择数据存储方式。默认使用浏览器本地存储。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>存储方式</Label>
                <Select defaultValue="local">
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">浏览器本地存储 (IndexedDB)</SelectItem>
                    <SelectItem value="notion">Notion</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Notion Integration Token</Label>
                <Input type="password" placeholder="secret_..." />
              </div>
              <div className="space-y-2">
                <Label>Notion Database ID</Label>
                <Input placeholder="xxxxxxxx" />
              </div>
              <Button size="sm"><Save className="h-3 w-3 mr-2" />保存</Button>
            </CardContent>
          </Card>
        </TabsContent>

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
                <Switch />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>飞书通知（预留）</Label>
                  <p className="text-xs text-muted-foreground">通过飞书机器人发送通知消息</p>
                </div>
                <Switch disabled />
              </div>
              <Button size="sm"><Save className="h-3 w-3 mr-2" />保存</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="etf">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">场外 ↔ 场内 ETF 映射</CardTitle>
              <CardDescription>配置场外 ETF 联接基金与场内 ETF 的对应关系，用于生成 Prompt 时补充 K 线数据</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Add mapping */}
              <div className="space-y-2">
                <Label className="text-xs">场外基金代码</Label>
                <div className="flex gap-2">
                  <Input value={newOtcCode} onChange={(e) => setNewOtcCode(e.target.value)} placeholder="如 007531" className="h-8 text-xs flex-1 font-mono" />
                  <Button
                    variant="secondary" size="sm" className="h-8 text-xs shrink-0"
                    disabled={!newOtcCode || etfAiLoading}
                    onClick={async () => {
                      setEtfAiLoading(true)
                      try {
                        const result = await fetchEtfMapping(newOtcCode)
                        if (result) {
                          setNewOtcName(result.otcName)
                          setNewExCode(result.exchangeCode)
                          setNewExName(result.exchangeName)
                        }
                      } catch { /* ignore */ }
                      setEtfAiLoading(false)
                    }}
                  >
                    {etfAiLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
                    AI 查询
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input value={newOtcName} onChange={(e) => setNewOtcName(e.target.value)} placeholder="场外名称（自动填充）" className="h-8 text-xs" />
                  <Input value={newExCode} onChange={(e) => setNewExCode(e.target.value)} placeholder="场内代码（自动填充）" className="h-8 text-xs font-mono" />
                </div>
                <Input value={newExName} onChange={(e) => setNewExName(e.target.value)} placeholder="场内名称（自动填充）" className="h-8 text-xs" />
              </div>
              <Button
                size="sm"
                disabled={!newOtcCode || !newExCode}
                onClick={() => {
                  addEtfMapping(newOtcCode, newOtcName, newExCode, newExName)
                  setNewOtcCode(''); setNewOtcName(''); setNewExCode(''); setNewExName('')
                }}
              >
                <Plus className="h-3 w-3 mr-1" />添加映射
              </Button>

              <Separator />

              {/* Mapping list */}
              {etfMappings.length > 0 ? (
                <div className="space-y-1">
                  {etfMappings.map((m, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50 text-xs">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="w-[100px] shrink-0">
                          <span className="font-mono">{m.otcCode}</span>
                          <span className="text-muted-foreground ml-1 truncate">{m.otcName}</span>
                        </div>
                        <span className="text-muted-foreground shrink-0">→</span>
                        <div className="w-[100px] shrink-0">
                          <span className="font-mono">{m.exchangeCode}</span>
                          <span className="text-muted-foreground ml-1 truncate">{m.exchangeName}</span>
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => removeEtfMapping(i)}>
                        <Trash2 className="h-3 w-3 text-muted-foreground" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-xs text-muted-foreground py-4">暂无映射。添加后可在 Prompt 生成时自动关联场内 K 线数据。</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="appearance">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">外观设置</CardTitle>
              <CardDescription>选择界面主题和语言</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>主题</Label>
                <Select defaultValue="system">
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">浅色</SelectItem>
                    <SelectItem value="dark">深色</SelectItem>
                    <SelectItem value="system">跟随系统</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm"><Save className="h-3 w-3 mr-2" />保存</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
