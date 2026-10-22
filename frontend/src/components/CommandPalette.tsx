import { useEffect, useState, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search,
  Code2,
  Crown,
  ClipboardList,
  MessageSquare,
  Shield,
  Moon,
  Sun,
  LogOut,
  LogIn,
  UserPlus,
  CornerDownLeft,
  X,
} from 'lucide-react'
import { useAuth } from '../AuthContext'
import { useTheme } from '../ThemeContext'

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

interface CommandItem {
  id: string
  label: string
  description?: string
  icon: typeof Search
  category: 'Navigation' | 'Actions' | 'Account'
  action: () => void
}

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const nav = useNavigate()
  const { user, logout } = useAuth()
  const { isDark, toggleTheme } = useTheme()

  const items: CommandItem[] = useMemo(() => {
    const list: CommandItem[] = [
      {
        id: 'nav-home',
        label: 'Start Code Review',
        description: 'Analyze repository architecture and diagrams',
        icon: Code2,
        category: 'Navigation',
        action: () => { nav('/'); onClose() },
      },
      {
        id: 'nav-pricing',
        label: 'Plans & Pricing',
        description: 'View membership tiers, review quotas, and upgrades',
        icon: Crown,
        category: 'Navigation',
        action: () => { nav('/pricing'); onClose() },
      },
    ]

    if (user) {
      list.push(
        {
          id: 'nav-history',
          label: 'Review History',
          description: 'Access past reports, diagrams, and logs',
          icon: ClipboardList,
          category: 'Navigation',
          action: () => { nav('/history'); onClose() },
        },
        {
          id: 'nav-chat',
          label: 'AI Chat Assistant',
          description: 'Ask deep questions about analyzed repositories',
          icon: MessageSquare,
          category: 'Navigation',
          action: () => { nav('/history'); onClose() },
        }
      )
      if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
        list.push({
          id: 'nav-admin',
          label: 'Administrator Panel',
          description: 'Manage users, permissions, and system metrics',
          icon: Shield,
          category: 'Navigation',
          action: () => { nav('/admin'); onClose() },
        })
      }
    }

    list.push({
      id: 'action-theme',
      label: isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme',
      description: 'Toggle between GitHub Dark and clean Light palette',
      icon: isDark ? Sun : Moon,
      category: 'Actions',
      action: () => { toggleTheme(); onClose() },
    })

    if (user) {
      list.push({
        id: 'account-logout',
        label: 'Sign Out',
        description: `Signed in as ${user.email}`,
        icon: LogOut,
        category: 'Account',
        action: () => { logout(); nav('/login'); onClose() },
      })
    } else {
      list.push(
        {
          id: 'account-login',
          label: 'Sign In',
          description: 'Access your saved review history and chat',
          icon: LogIn,
          category: 'Account',
          action: () => { nav('/login'); onClose() },
        },
        {
          id: 'account-signup',
          label: 'Create Account',
          description: 'Start using CodeSense free with full history',
          icon: UserPlus,
          category: 'Account',
          action: () => { nav('/signup'); onClose() },
        }
      )
    }

    return list
  }, [user, isDark, nav, onClose, logout, toggleTheme])

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      item =>
        item.label.toLowerCase().includes(q) ||
        (item.description && item.description.toLowerCase().includes(q))
    )
  }, [query, items])

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Keyboard navigation inside palette
  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex(prev => (prev + 1 < filteredItems.length ? prev + 1 : 0))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex(prev => (prev - 1 >= 0 ? prev - 1 : filteredItems.length - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (filteredItems[activeIndex]) {
          filteredItems[activeIndex].action()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, filteredItems, activeIndex, onClose])

  // Keep active item in view
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.children[activeIndex] as HTMLElement
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex])

  if (!open) return null

  return (
    <div className="cmd-backdrop" onClick={onClose}>
      <div className="cmd-modal" onClick={e => e.stopPropagation()}>
        <div className="cmd-input-wrap">
          <Search size={18} className="cmd-search-icon" />
          <input
            ref={inputRef}
            className="cmd-input"
            placeholder="Type a command or search..."
            value={query}
            onChange={e => {
              setQuery(e.target.value)
              setActiveIndex(0)
            }}
          />
          {query && (
            <button className="cmd-clear-btn" onClick={() => setQuery('')}>
              <X size={14} />
            </button>
          )}
          <kbd className="cmd-esc-badge">ESC</kbd>
        </div>

        <div className="cmd-list" ref={listRef}>
          {filteredItems.length === 0 ? (
            <div className="cmd-empty">No matching commands or pages found.</div>
          ) : (
            filteredItems.map((item, idx) => {
              const Icon = item.icon
              const isSelected = idx === activeIndex
              return (
                <div
                  key={item.id}
                  className={`cmd-item ${isSelected ? 'cmd-item-active' : ''}`}
                  onClick={() => item.action()}
                  onMouseEnter={() => setActiveIndex(idx)}
                >
                  <div className="cmd-item-icon">
                    <Icon size={16} />
                  </div>
                  <div className="cmd-item-text">
                    <div className="cmd-item-label">{item.label}</div>
                    {item.description && (
                      <div className="cmd-item-desc">{item.description}</div>
                    )}
                  </div>
                  {isSelected && (
                    <CornerDownLeft size={14} className="cmd-item-enter" />
                  )}
                </div>
              )
            })
          )}
        </div>

        <div className="cmd-footer">
          <span>Navigate with <kbd>↑</kbd> <kbd>↓</kbd></span>
          <span>Select with <kbd>↵</kbd></span>
          <span>Close with <kbd>ESC</kbd></span>
        </div>
      </div>
    </div>
  )
}
