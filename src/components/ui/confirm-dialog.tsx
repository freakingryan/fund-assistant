import { useState, type ReactNode } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface ConfirmActionProps {
  /** 确认对话框标题 */
  title: string
  /** 确认对话框说明（可选） */
  description?: string
  /** 确认按钮文字，默认「确认」 */
  confirmText?: string
  /** 取消按钮文字，默认「取消」 */
  cancelText?: string
  /** 点击确认后执行（删除等不可逆操作） */
  onConfirm: () => void
  /** 触发元素（图标按钮等），通过 DialogTrigger asChild 包裹 */
  children: ReactNode
}

/**
 * 危险操作的二次确认封装（基于现有 Dialog 原语）。
 * 用于删除持仓 / 规则 / ETF 映射等不可撤销操作，避免误触直接丢数据。
 * 用法：将原来的删除按钮作为 children 传入，onConfirm 内执行真正的删除 + 成功 Toast。
 */
export function ConfirmAction({
  title, description, confirmText = '确认', cancelText = '取消',
  onConfirm, children,
}: ConfirmActionProps) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>{cancelText}</Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => { onConfirm(); setOpen(false) }}
          >
            {confirmText}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
