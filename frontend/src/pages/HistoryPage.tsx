import { useEffect, useState, useCallback, useMemo } from 'react'
import { useAuth } from '../AuthContext'
import { useNavigate, Link } from 'react-router-dom'
import {
  ClipboardList,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  Clock,
  FileText,
  MessageSquare,
  FileDown,
  X,
  Loader2,
  GitBranch,
  Rocket,
  FolderGit2,
} from 'lucide-react'
import { buildPdf, parseMd } from './ReviewPage'
import { MermaidDoc } from '../components/MermaidViewer'

interface Review {
  id: string
  repo: string
  branch: string
  status: 'running' | 'done' | 'error'
  elapsed_sec: number | null
  error: string | null
  created_at: string
  finished_at: string | null
}

function fmtElapsed(sec: number | null) {
  if (!sec) return '—'
  return sec >= 60 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${sec}s`
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return d
  }
}

function parseRepoName(repo: string) {
  if (!repo) return { title: 'Unknown Repository', sub: '' }
  const gh = repo.match(/github\.com\/([^\/]+)\/([^\/\s#?]+)/i)
  if (gh) {
    const owner = gh[1]
    const name = gh[2].replace(/\.git$/i, '')
    return { title: `${owner} / ${name}`, sub: repo }
  }
  const clean = repo.replace(/\\/g, '/')
  const parts = clean.split('/').filter(Boolean)
  const name = parts[parts.length - 1] || repo
  return { title: name, sub: repo }
}

export default function HistoryPage() {
  const { user, token } = useAuth()
  const nav = useNavigate()
  const [reviews,   setReviews]   = useState<Review[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')
  const [query,     setQuery]     = useState('')
  const [selected,  setSelected]  = useState<{ id: string; repo: string; markdown: string } | null>(null)
  const [mdLoading, setMdLoading] = useState(false)

  const fetchHistory = useCallback(async () => {
    if (!token) return
    try {
      const res  = await fetch('/api/history', { headers: { Authorization: `Bearer ${token}` } })
      const data = await res.json()
      if (data.ok) {
        setReviews(data.reviews)
        setError('')
      } else {
        setError(data.error || 'Failed to load history')
      }
    } catch {
      setError('Network error — could not load history')
    } finally { setLoading(false) }
  }, [token])

  useEffect(() => {
    if (!user) { nav('/login'); return }
    void fetchHistory()
  }, [user, nav, fetchHistory])

  const openReview = async (r: Review) => {
    if (r.status !== 'done') return
    setMdLoading(true)
    try {
      const res  = await fetch(`/api/history/${r.id}/markdown`, { headers: { Authorization: `Bearer ${token}` } })
      const data = await res.json()
      if (data.ok && data.markdown) setSelected({ id: r.id, repo: r.repo, markdown: data.markdown })
    } finally { setMdLoading(false) }
  }

  const openPdf = (repo: string, md: string) => {
    const matchProject = md ? md.match(/\|\s*\*\*Project\*\*\s*\|\s*`?([^`|\n]+)`?\s*\|/) : null
    const title = matchProject ? matchProject[1].trim() : (repo.toLowerCase().includes('gito') ? 'CodeSense' : repo)
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(buildPdf(title, parseMd(md)))
    win.document.close()
  }

  // Filtered reviews
  const filteredReviews = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return reviews
    return reviews.filter(
      r => r.repo.toLowerCase().includes(q) || r.branch.toLowerCase().includes(q)
    )
  }, [reviews, query])

  // Summary counts
  const totalCount = reviews.length
  const doneCount = reviews.filter(r => r.status === 'done').length
  const activeCount = reviews.filter(r => r.status === 'running').length

  if (loading) {
    return (
      <main className="main" style={{ paddingTop: 80, textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <Loader2 size={32} className="spin text-primary" />
          <span style={{ fontSize: '0.9rem', color: 'var(--muted-foreground)', fontWeight: 500 }}>
            Loading review history…
          </span>
        </div>
      </main>
    )
  }

  return (
    <main className="main" style={{ paddingTop: 40 }}>
      {/* Header with Title and Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--primary-subtle)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ClipboardList size={18} />
            </div>
            <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--foreground)', letterSpacing: '-0.02em' }}>
              Review History
            </h1>
          </div>
          <p style={{ color: 'var(--muted-foreground)', fontSize: '0.88rem' }}>
            Access and analyze your previous repository reviews, diagrams, and AI chat sessions.
          </p>
        </div>

        <button
          className="btn btn-outline btn-sm"
          onClick={() => { setLoading(true); fetchHistory() }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Stats Cards Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 24 }}>
        <div className="card" style={{ padding: '16px 20px', borderRadius: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--foreground)' }}>
            <ClipboardList size={20} />
          </div>
          <div>
            <div style={{ fontSize: '0.74rem', color: 'var(--muted-foreground)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Total Reviews</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--foreground)' }}>{totalCount}</div>
          </div>
        </div>

        <div className="card" style={{ padding: '16px 20px', borderRadius: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--primary-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}>
            <CheckCircle2 size={20} />
          </div>
          <div>
            <div style={{ fontSize: '0.74rem', color: 'var(--muted-foreground)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Completed</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--primary)' }}>{doneCount}</div>
          </div>
        </div>

        <div className="card" style={{ padding: '16px 20px', borderRadius: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: activeCount > 0 ? 'rgba(245, 158, 11, 0.15)' : 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: activeCount > 0 ? '#f59e0b' : 'var(--muted-foreground)' }}>
            <Clock size={20} />
          </div>
          <div>
            <div style={{ fontSize: '0.74rem', color: 'var(--muted-foreground)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Active Jobs</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--foreground)' }}>{activeCount}</div>
          </div>
        </div>
      </div>

      {error && (
        <div className="status-bar err animate-fadeIn" style={{ marginBottom: 20 }}>
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* Filter / Search Bar */}
      {reviews.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div className="input-wrap" style={{ maxWidth: 360 }}>
            <Search size={15} className="input-icon" />
            <input
              className="inp"
              placeholder="Filter by repository or branch..."
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            {query && (
              <button
                style={{ background: 'none', border: 'none', color: 'var(--muted-foreground)', cursor: 'pointer', display: 'flex' }}
                onClick={() => setQuery('')}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      {reviews.length === 0 && !error ? (
        <div className="doc-card" style={{ textAlign: 'center', padding: '64px 32px' }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, background: 'var(--primary-subtle)', color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <Rocket size={30} />
          </div>
          <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--foreground)', marginBottom: 6 }}>
            No reviews yet
          </h3>
          <p style={{ color: 'var(--muted-foreground)', fontSize: '0.9rem', maxWidth: 400, margin: '0 auto 24px' }}>
            Enter a GitHub or local repository URL to generate your first architectural analysis and diagrams.
          </p>
          <Link to="/" className="btn btn-primary">
            <Rocket size={16} /> Start a Review
          </Link>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 48 }}>#</th>
                <th>Repository</th>
                <th>Branch</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Analyzed On</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredReviews.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--muted-foreground)' }}>
                    No reviews match &quot;{query}&quot;
                  </td>
                </tr>
              ) : (
                filteredReviews.map((r, i) => {
                  const repo = parseRepoName(r.repo)
                  return (
                    <tr key={r.id}>
                      <td className="table-col-idx">{i + 1}</td>
                      <td>
                        <div className="table-repo-cell">
                          <div className="table-repo-icon-wrap">
                            <FolderGit2 size={16} />
                          </div>
                          <div className="table-repo-meta">
                            <div className="table-repo-title" title={r.repo}>
                              {repo.title}
                            </div>
                            <div className="table-repo-url" title={r.repo}>
                              {repo.sub}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="table-branch-badge">
                          <GitBranch size={12} />
                          <span>{r.branch || 'main'}</span>
                        </span>
                      </td>
                      <td>
                        {r.status === 'done' && (
                          <span className="table-status-pill status-done">
                            <CheckCircle2 size={12} /> Done
                          </span>
                        )}
                        {r.status === 'running' && (
                          <span className="table-status-pill status-running">
                            <Loader2 size={12} className="spin" /> Running
                          </span>
                        )}
                        {r.status === 'error' && (
                          <span className="table-status-pill status-error">
                            <AlertTriangle size={12} /> Error
                          </span>
                        )}
                      </td>
                      <td style={{ color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)' }}>
                        {fmtElapsed(r.elapsed_sec)}
                      </td>
                      <td style={{ color: 'var(--muted-foreground)', fontSize: '0.8rem' }}>
                        {fmtDate(r.created_at)}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {r.status === 'done' && (
                          <div className="table-actions-wrap">
                            <button
                              className="table-btn table-btn-outline"
                              onClick={() => openReview(r)}
                              disabled={mdLoading}
                              title="View Markdown Report"
                            >
                              <FileText size={13} /> View
                            </button>
                            <Link
                              to={`/chat/${r.id}`}
                              className="table-btn table-btn-primary"
                              title="Open AI Chat for this review"
                            >
                              <MessageSquare size={13} /> Chat
                            </Link>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Review Modal with backdrop */}
      {selected && (
        <div className="cmd-backdrop" onClick={() => setSelected(null)}>
          <div
            className="cmd-modal"
            style={{ maxWidth: 960, maxHeight: '88vh' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--primary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Code Review Report
                </div>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--foreground)', marginTop: 2 }}>
                  {(() => {
                    const matchProject = selected.markdown?.match(/\|\s*\*\*Project\*\*\s*\|\s*`?([^`|\n]+)`?\s*\|/)
                    if (matchProject) return matchProject[1].trim()
                    return selected.repo.toLowerCase().includes('gito') ? 'CodeSense' : selected.repo
                  })()}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => openPdf(selected.repo, selected.markdown)}
                >
                  <FileDown size={14} /> PDF / Print
                </button>
                <Link
                  to={`/chat/${selected.id}`}
                  className="btn btn-primary btn-sm"
                >
                  <MessageSquare size={14} /> AI Chat
                </Link>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSelected(null)}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div style={{ overflowY: 'auto', padding: '24px 28px' }}>
              <MermaidDoc
                html={parseMd(selected.markdown)}
                id={`history-${selected.id}`}
              />
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
