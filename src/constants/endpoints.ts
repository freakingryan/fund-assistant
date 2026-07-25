/**
 * 集中管理外部服务 API 端点，避免散落硬编码（P1-02）。
 *
 * 约定：
 * - LLM 端点为「兜底默认地址」；运行时若传入自定义 baseURL（来自设置），优先级更高。
 * - Google Gemini 仅存基址，调用时需拼接 `/${model}:generateContent`。
 */
export const API_BASES = {
  // ── LLM 对话补全端点 ──
  deepseek: "https://api.deepseek.com/v1/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  agnes: "https://apihub.agnes-ai.com/v1/chat/completions",
  // Google Gemini 基址（使用时拼接 `/${model}:generateContent`）
  google: "https://generativelanguage.googleapis.com/v1beta/models",
  custom: "https://api.openai.com/v1/chat/completions",

  // ── 代码仓库（GitHub Gist 备份）──
  githubGists: "https://api.github.com/gists",
  githubUser: "https://api.github.com/user",

  // ── 行情 / K 线数据源 ──
  tencentKline: "https://proxy.finance.qq.com/ifzqgtimg/appstock/app",
  eastmoneyFund: "https://fund.eastmoney.com",
  eastmoneyFundgz: "https://fundgz.1234567.com.cn",
  eastmoneyFundsuggest: "https://fundsuggest.eastmoney.com",
} as const;
