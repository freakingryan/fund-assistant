# 东方财富数据代理（Cloudflare Worker）

> ⚠️ **前置条件已变化**：本 Worker 最初为「东财被硬阻断」而设。**2026-07-19 实测用户网络可直连东方财富**（含 pingzhongdata / fundgz / fundf10），未配置 `VITE_FUND_WORKER_URL` 时前端直连东财即可工作，本 Worker **已非必需**。仅当你需要解除 `fundf10` 的 eastmoney Referer 跨域校验（纯静态站浏览器无法伪造该 Referer）时，仍需自建边缘代理。保留本文档作为可选增强参考。

基金助手依赖东方财富（天天基金）的多个接口获取基金净值历史、F10 持仓、实时估值、
基金搜索。这些接口域名（`*.eastmoney.com`、`fundgz.1234567.com.cn`）在部分网络环境下
被硬阻断（即使开启代理也无法访问）。本 Worker 部署在 Cloudflare 边缘节点（可达东财），
由 Worker 服务端请求东方财富并转发给前端，从而绕开本地网络阻断。

## 它转发哪些接口

| Worker 路径 | 转发到 |
|---|---|
| `/pingzhongdata/{code}.js` | `fund.eastmoney.com/pingzhongdata/{code}.js`（净值历史，K线数据源） |
| `/fundgz/js/{code}.js` | `fundgz.1234567.com.cn/js/{code}.js`（实时估算净值） |
| `/fundsuggest/{path}` | `fundsuggest.eastmoney.com/{path}`（基金名称反查代码） |
| `/fundf10/{path}` | `fundf10.eastmoney.com/{path}`（前十大重仓股，注入 eastmoney Referer） |

## 部署步骤（一次性，约 5 分钟）

1. 注册免费 Cloudflare 账号：https://dash.cloudflare.com/sign-up
2. 安装 wrangler（Node 环境）：
   ```bash
   npm install -g wrangler
   # 或 npx wrangler@latest
   ```
3. 登录并授权：
   ```bash
   wrangler login
   ```
4. 进入本目录部署：
   ```bash
   cd cloudflare-worker
   wrangler deploy
   ```
5. 部署成功后终端会输出你的 Worker 地址，类似：
   ```
   https://fund-eastmoney-proxy.<你的子域>.workers.dev
   ```

## 让前端接入

在 `fund-assistant/` 目录创建 `.env`（或写入已有的 `.env`），填入：

```bash
VITE_FUND_WORKER_URL=https://fund-eastmoney-proxy.<你的子域>.workers.dev
```

然后重新构建并部署：

```bash
cd fund-assistant
NODE_OPTIONS="" npx vite build
# 部署 dist/ 到 GitHub Pages / EdgeOne Pages 等
```

未配置 `VITE_FUND_WORKER_URL` 时，前端回退为**直连东财**（仅在你本地网络可达东财时可用，
例如开发机挂着可用代理的环境），不影响现有逻辑。

## 费用

Cloudflare Workers 免费额度：每天 10 万次请求，足够个人使用，无需付费。

## 验证

部署并配置后，本地起服务访问 `http://localhost:8899/network-probe.html` 或直接在
已部署的站点打开应用，基金净值 K 线、F10 持仓、实时估值均应恢复。
也可直接 `curl` 验证 Worker：

```bash
curl "https://<你的worker>.workers.dev/pingzhongdata/980030.js" | head -c 200
```
