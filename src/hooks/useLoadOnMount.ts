import { useEffect } from "react";

/**
 * 挂载即执行 loadFn 的副作用封装，消除重复的「load-on-mount」useEffect 脚手架。
 *
 * - 自动吞掉 loadFn 可能 reject 的 Promise（避免未处理的 rejection）。
 * - loadFn 作为依赖：若 loadFn 引用稳定（如来自 store 的 action，或 useCallback 包裹），
 *   效果等价于「挂载时执行一次」。
 * - 不管理 loading 态：本项目的 load 函数多在内部自行管理 loading，或由 store 暴露 loading，
 *   故此处保持纯触发，避免与既有 loading 状态耦合、改变 UI 行为。
 */
export function useLoadOnMount(loadFn: () => void | Promise<unknown>): void {
  useEffect(() => {
    void Promise.resolve(loadFn()).catch(() => {});
  }, [loadFn]);
}
