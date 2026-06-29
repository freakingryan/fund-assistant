import { useState, useRef, useEffect } from 'react'

interface Option {
  value: string
  label: string
  searchText: string  // 用于搜索的文本（代码 + 名称）
}

interface Props {
  options: Option[]
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  className?: string
}

export default function SearchableSelect({ options, value, onValueChange, placeholder = '搜索...', className = '' }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = options.find((o) => o.value === value)

  // 过滤选项
  const filtered = query.trim()
    ? options.filter((o) => o.searchText.includes(query.trim().toLowerCase()))
    : options

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // 打开时聚焦输入框
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full h-8 px-3 rounded-md border border-input bg-background text-xs hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer text-left"
      >
        <span className="flex-1 truncate">
          {selected ? (
            <><span className="font-mono mr-1.5">{selected.label.split(' ')[0]}</span>{selected.label.slice(selected.label.indexOf(' ') + 1)}</>
          ) : placeholder}
        </span>
        <svg className="h-3 w-3 shrink-0 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-md border bg-popover text-popover-foreground shadow-md max-h-[280px] flex flex-col">
          {/* Search input */}
          <div className="p-1.5 border-b">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="w-full h-7 px-2 text-xs rounded border border-input bg-background outline-none focus:border-ring"
            />
          </div>
          {/* Options list */}
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted-foreground">无匹配基金</div>
            ) : (
              filtered.map((o) => {
                const isSelected = o.value === value
                const code = o.label.split(' ')[0]
                const name = o.label.slice(o.label.indexOf(' ') + 1)
                return (
                  <button
                    key={o.value}
                    onClick={() => { onValueChange(o.value); setOpen(false); setQuery('') }}
                    className={`flex items-center gap-2 w-full px-2.5 py-1.5 text-xs text-left transition-colors cursor-pointer ${
                      isSelected ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted'
                    }`}
                  >
                    <span className="font-mono text-[10px] text-muted-foreground shrink-0">{code}</span>
                    <span className="truncate">{name}</span>
                    {isSelected && (
                      <svg className="h-3 w-3 shrink-0 ml-auto text-primary" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                      </svg>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
