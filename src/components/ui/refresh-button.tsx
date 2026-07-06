import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface RefreshButtonProps {
  onClick: () => void
  /** 加载态：同时控制禁用与图标旋转 */
  loading?: boolean
  title?: string
  /** 按钮文字；省略则仅渲染图标（图标按钮） */
  label?: string
  /** 图标尺寸类名，默认 'h-3 w-3' */
  iconClassName?: string
  /** 额外按钮 className（尺寸 / 布局微调，如 'w-7 p-0'、'ml-auto'） */
  className?: string
  /** 加载时改用 Loader2 替换 RefreshCw（默认 false：给 RefreshCw 加 animate-spin） */
  swapIcon?: boolean
}

/**
 * 统一的「刷新」按钮。
 * 各页面原先重复 7+ 处相同的 ghost/sm 按钮 + 加载图标逻辑，现集中于此。
 */
export function RefreshButton({
  onClick, loading = false, title, label,
  iconClassName = 'h-3 w-3', className, swapIcon = false,
}: RefreshButtonProps) {
  const Icon = swapIcon && loading ? Loader2 : RefreshCw
  const iconCls = cn(iconClassName, label && 'mr-1', loading && 'animate-spin')
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(className)}
      onClick={onClick}
      disabled={loading}
      title={title}
      aria-label={title ?? '刷新'}
    >
      <Icon className={iconCls} />
      {label}
    </Button>
  )
}
