import { useState, useRef, useEffect } from 'react'
import { Search, X } from 'lucide-react'

interface ExpandableSearchProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export default function ExpandableSearch({ value, onChange, placeholder = '搜索...' }: ExpandableSearchProps) {
  const [expanded, setExpanded] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (expanded && inputRef.current) {
      inputRef.current.focus()
    }
  }, [expanded])

  useEffect(() => {
    if (!value) return
    setExpanded(true)
  }, [value])

  const handleToggle = () => {
    if (expanded && value) {
      onChange('')
    }
    setExpanded(!expanded)
  }

  return (
    <div className="relative flex items-center">
      <div
        className="relative overflow-hidden transition-all duration-200 ease-out"
        style={{ width: expanded ? 180 : 0 }}
      >
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          onBlur={() => {
            if (!value) setExpanded(false)
          }}
          className="w-full rounded-full bg-white/50 dark:bg-gray-800/50 backdrop-blur-xl border border-white/20 dark:border-gray-700/30 py-1.5 pl-8 pr-7 text-sm text-[var(--text-primary)] outline-none transition-all placeholder:text-[var(--text-muted)] focus:bg-white/70 dark:focus:bg-gray-800/70 focus:shadow-sm"
        />
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] pointer-events-none" />
        {value && (
          <button
            onMouseDown={(e) => {
              e.preventDefault()
              onChange('')
              inputRef.current?.focus()
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <button
        onClick={handleToggle}
        className="btn-icon flex-shrink-0"
        title={expanded ? '关闭搜索' : '搜索'}
      >
        {expanded ? <X className="w-4 h-4" /> : <Search className="w-4 h-4" />}
      </button>
    </div>
  )
}
