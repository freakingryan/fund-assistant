import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  desc?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({ icon: Icon, title, desc, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center py-12 px-4 ${className}`}>
      {Icon && (
        <div className="mb-3 rounded-full bg-muted p-3">
          <Icon className="h-6 w-6 text-muted-foreground" />
        </div>
      )}
      <p className="text-sm font-medium">{title}</p>
      {desc && <p className="text-xs text-muted-foreground mt-1 max-w-xs">{desc}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
