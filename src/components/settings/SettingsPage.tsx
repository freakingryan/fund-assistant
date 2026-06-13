import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Key, Database, BellRing, Globe, SunMoon, Save } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export default function SettingsPage() {
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
