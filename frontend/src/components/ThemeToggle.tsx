import { Sun, Moon } from 'lucide-react'
import { useTheme } from '../ThemeContext'

export default function ThemeToggle() {
  const { isDark, toggleTheme } = useTheme()

  return (
    <div className="theme-toggle-wrap">
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        className="theme-toggle-btn"
      >
        {isDark ? (
          <Sun size={18} strokeWidth={2} className="theme-icon sun-icon" />
        ) : (
          <Moon size={18} strokeWidth={2} className="theme-icon moon-icon" />
        )}
      </button>
    </div>
  )
}
