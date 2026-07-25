/**
 * LLM 回复的 JSON 提取工具（单一来源）。
 *
 * 合并此前散落在 services/ai.ts、klineAnalysis.ts、backtest/aiAnalysis.ts 中的
 * 多份「从模型文本里抠出 JSON 对象」逻辑，避免重复实现与行为漂移。
 *
 * 提取顺序：
 *  1) 整段即以 `{` 开头 → 直接 JSON.parse；
 *  2) 被 markdown 代码块 ```json ... ``` 或 ``` ... ``` 包裹；
 *  3) 任意位置出现的第一个 `{...}`（贪婪匹配到最后一个 `}`）。
 * 全部失败返回 null。
 */
export function extractJsonFromLLM(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // 落到正则提取
    }
  }

  const codeMatch = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (codeMatch) {
    try {
      return JSON.parse(codeMatch[1]);
    } catch {
      // 继续
    }
  }

  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      // 放弃
    }
  }

  return null;
}
