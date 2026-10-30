import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../AuthContext'
import { useNavigate, Link } from 'react-router-dom'
import {
  Sparkles,
  Link2,
  GitBranch,
  Rocket,
  Loader2,
  X,
  CheckCircle2,
  AlertTriangle,
  FileText,
  FileDown,
  Printer,
  MessageSquare,
  FileSearch,
  BrainCircuit,
  GitGraph,
  Zap,
  GitFork,
  Clock,
  Check,
  FolderUp,
  Folder,
} from 'lucide-react'
import { MermaidDoc, getMermaid } from '../components/MermaidViewer'

// ── Constants ─────────────────────────────────────────────────────────────────
const POLL_MS = 2500
const SESSION_KEY = 'codesense_job'

const FEATURES = [
  { icon: FileSearch,   title:'Smart file selection', desc:'Only signal-rich files analysed' },
  { icon: BrainCircuit, title:'LLM-powered review',   desc:'Deep architectural insights' },
  { icon: GitGraph,     title:'Visual diagrams',       desc:'Auto-generated Mermaid charts' },
  { icon: Zap,          title:'Fast & local',          desc:'Runs fully on your machine' },
  { icon: FileDown,     title:'Markdown export',       desc:'Copy or download the report' },
  { icon: GitFork,      title:'GitHub / GitLab',       desc:'Review any public repo by URL' },
]

// ── Types ─────────────────────────────────────────────────────────────────────
type JobStatus = 'idle' | 'cloning' | 'running' | 'done' | 'error'
interface JobState {
  jobId: string | null; status: JobStatus; step: number; total: number
  message: string; markdown: string | null; error: string | null
  startedAt: number | null; elapsed: number | null
  repo?: string; branch?: string
}
const EMPTY_JOB: JobState = {
  jobId: null, status: 'idle', step: 0, total: 4,
  message: '', markdown: null, error: null, startedAt: null, elapsed: null,
}

function loadJob(): JobState {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return EMPTY_JOB
    const j = JSON.parse(raw) as JobState
    if (j.status === 'cloning' || j.status === 'running') {
      return { ...j, status: 'running', message: 'Resuming…' }
    }
    sessionStorage.removeItem(SESSION_KEY)
    return EMPTY_JOB
  } catch { return EMPTY_JOB }
}
function saveJob(j: JobState) {
  try {
    if (j.status === 'idle') {
      sessionStorage.removeItem(SESSION_KEY)
    } else {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(j))
    }
  } catch { /* ignore */ }
}

// ── Markdown renderer ─────────────────────────────────────────────────────────
function sanitizeMermaid(code: string): string {
  if (!code) return ''
  let c = code.trim()

  // 1. Recover corrupted diagram headers (e.g. graph_TD_User -> graph TD\n    User, flowchart_LR__App -> flowchart LR\n    App)
  c = c.replace(/^(graph|flowchart)[_ ]([A-Za-z]{2})_+([A-Za-z0-9_]+)/m, '$1 $2\n    $3')

  // 2. Normalize smart/curly quotes to ASCII straight quotes
  c = c.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
  c = c.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")

  // 3. Ensure 'end' is on its own separate line if followed by a statement
  c = c.replace(/(\bend\b)\s+([a-zA-Z0-9_]+)/g, '$1\n    $2')

  // 4. Strip stray markdown fence lines or page breaks
  c = c.replace(/^---+$/gm, '').replace(/^[~`]{3,}.*$/gm, '')

  // 5. Normalize arrows
  c = c.replace(/\|\|--\|\{/g, '||--o{')
  c = c.replace(/\s+-->\s+/g, ' --> ')
  c = c.replace(/\s+---\s+/g, ' --- ')
  c = c.replace(/\s+==>\s+/g, ' ==> ')

  // 6. Subgraph title quoting: ensure subgraph "Title" has double quotes
  c = c.replace(/^(\s*subgraph\s+)([^"'\n]+)$/gm, (_, prefix, name) => {
    const trimmed = name.trim()
    return `${prefix}"${trimmed.replace(/"/g, '')}"`
  })

  // 7. Shape label auto-quoting for special chars
  c = c.replace(/\(\[([^"\]\)\n]*[,/&][^"\]\)\n]*)\]\)/g, '(["$1"])')
  c = c.replace(/\[\(([^"\]\)\n]*[,/&][^"\]\)\n]*)\)\]/g, '[("$1")]')
  c = c.replace(/\[([^"\]\n]*[,/&][^"\]\n]*)\]/g, '["$1"]')

  return c
}

export function parseMd(raw: string): string {
  const blocks: string[] = []
  let text = raw

  // Protect mermaid blocks
  text = text.replace(/```mermaid\n?([\s\S]*?)```/g, (_: string, code: string) => {
    const idx = blocks.length
    blocks.push(`<div class="mermaid-wrap"><div class="mermaid">${sanitizeMermaid(code)}</div></div>`)
    return `%%%BLOCK_MERMAID_${idx}%%%`
  })

  // Protect generic code blocks
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_: string, lang: string, code: string) => {
    const idx = blocks.length
    const escapedCode = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    blocks.push(`<pre class="code-block"><code class="${lang ? `lang-${lang}` : ''}">${escapedCode}</code></pre>`)
    return `%%%BLOCK_CODE_${idx}%%%`
  })

  // Escape prose HTML entities safely
  let h = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // Headings, tables, lists, formatting
  for (let n = 6; n >= 1; n--)
    h = h.replace(new RegExp(`^${'#'.repeat(n)} (.+)$`, 'gm'), (_, title) => {
      const isUseCase = /use\s*case/i.test(title)
      const cls = isUseCase ? ' class="usecase-break"' : ''
      return `<h${n} id="section-${n}"${cls}>${title}</h${n}>`
    })
  h = h.replace(/^---+$/gm, '<hr/>')
  h = h.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  h = h.replace(/\*(.+?)\*/g, '<em>$1</em>')
  h = h.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')

  // Images and links
  h = h.replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1" class="doc-image" />')
  h = h.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')

  h = h.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (m: string) => m.replace(/\|/g, '&#124;'))
  h = h.replace(/\\\|/g, '&#124;')

  // Table parsing
  h = h.replace(/((?:^(?:\||[^|\n]+\|).+\|\s*\n?)+)/gm, (blk: string) => {
    const rawRows = blk.trim().split('\n').filter(r => r.trim().length > 0)
    if (rawRows.length < 2) return blk
    const isSep = (r: string) => /^[|\s:-]+$/.test(r.trim()) && r.includes('-')
    const toCells = (r: string) => {
      let trimmed = r.trim()
      if (trimmed.startsWith('|')) trimmed = trimmed.slice(1)
      if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1)
      return trimmed.split('|').map(c => c.trim())
    }
    let expectedCols = 0
    const toRow = (r: string, tag: string) => {
      let cells = toCells(r)
      if (tag === 'th') {
        expectedCols = cells.length
      } else if (expectedCols > 0) {
        if (cells.length > expectedCols) {
          if (expectedCols === 2) {
            cells = [cells[0], cells.slice(1).join(' | ')]
          } else {
            const headCount = expectedCols - 2
            const prefix = cells.slice(0, headCount)
            const middle = cells.slice(headCount, cells.length - 1).filter(Boolean).join(' | ')
            const last = cells[cells.length - 1]
            cells = [...prefix, middle, last]
          }
        } else if (cells.length < expectedCols) {
          while (cells.length < expectedCols) cells.push('')
        }
      }
      return '<tr>' + cells.map(c => `<${tag}>${c}</${tag}>`).join('') + '</tr>'
    }
    let out = '<div class="table-wrap"><table>'
    let head = true
    const hasSep = rawRows.some(isSep)
    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i]
      if (isSep(r)) { head = false; continue }
      if (head && (i === 0 || !hasSep)) {
        out += `<thead>${toRow(r, 'th')}</thead><tbody>`
        head = false
      } else {
        out += toRow(r, 'td')
      }
    }
    return out + '</tbody></table></div>'
  })

  // Lists
  h = h.replace(/((?:^[-*+] .+\n?)+)/gm, (blk: string) =>
    '<ul>' + blk.trim().split('\n').map((l: string) => `<li>${l.replace(/^[-*+] /,'')}</li>`).join('') + '</ul>')
  h = h.replace(/((?:^\d+\. .+\n?)+)/gm, (blk: string) =>
    '<ol>' + blk.trim().split('\n').map((l: string) => `<li>${l.replace(/^\d+\. /,'')}</li>`).join('') + '</ol>')

  // Paragraphs
  h = h.replace(/^(?!<[a-zA-Z/]|$)(.{3,})$/gm, '<p>$1</p>')
  h = h.replace(/<p>\s*<\/p>/g, '')

  // Restore protected blocks
  h = h.replace(/%%%BLOCK_(?:MERMAID|CODE)_(\d+)%%%/g, (_: string, idx: string) => blocks[parseInt(idx)] || '')

  return h
}

// ── Main ReviewPage ───────────────────────────────────────────────────────────
export default function ReviewPage() {
  const { user, token } = useAuth()
  const nav = useNavigate()
  const [repo, setRepo]     = useState('')
  const [branch, setBranch] = useState('main')
  const [inputMode, setInputMode] = useState<'url' | 'upload'>('url')
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ path: string; content: string }>>([])
  const [uploadedFolderName, setUploadedFolderName] = useState<string>('')
  const [isReadingFolder, setIsReadingFolder] = useState<boolean>(false)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [job, setJob]       = useState<JobState>(() => loadJob())
  const pollRef = useRef<ReturnType<typeof setInterval>|null>(null)

  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }

  const applyJob = (updater: (prev: JobState) => JobState) => {
    setJob(prev => { const next = updater(prev); saveJob(next); return next })
  }

  const pollJob = (jobId: string) => {
    stopPoll()
    pollRef.current = setInterval(async () => {
      try {
        const r    = await fetch(`/api/full-review/status/${jobId}`)
        const data = await r.json()
        applyJob(prev => ({
          ...prev, status: data.status,
          step: data.step ?? prev.step, total: data.total ?? prev.total,
          message: data.message ?? prev.message, markdown: data.markdown ?? prev.markdown,
          error: data.error ?? null,
          elapsed: (data.status==='done'||data.status==='error') && prev.startedAt
            ? Math.round((Date.now()-prev.startedAt)/1000) : prev.elapsed,
        }))
        if (data.status==='done'||data.status==='error') stopPoll()
      } catch { /* ignore */ }
    }, POLL_MS)
  }

  const prevUserIdRef = useRef<string | undefined>(user?.id)
  useEffect(() => {
    if (prevUserIdRef.current !== user?.id) {
      prevUserIdRef.current = user?.id
      stopPoll()
      setJob(EMPTY_JOB)
      try { sessionStorage.removeItem(SESSION_KEY) } catch { /* ignore */ }
      setRepo('')
      setBranch('main')
    }
  }, [user?.id])

  const [membershipStats, setMembershipStats] = useState<{
    plan: string
    reviews: { used: number; limit: number; remaining: number }
  } | null>(null)
  const [quotaModal, setQuotaModal] = useState<{
    open: boolean
    message: string
    plan: string
  }>({ open: false, message: '', plan: 'FREE' })

  const loadQuota = () => {
    if (user) {
      fetch('/api/membership/current', { credentials: 'include' })
        .then(r => r.json())
        .then(d => {
          if (d.ok && d.subscription) {
            setMembershipStats({
              plan: d.subscription.plan,
              reviews: d.subscription.reviews,
            })
          }
        })
        .catch(() => {})
    }
  }

  useEffect(() => {
    loadQuota()
  }, [user])

  useEffect(() => {
    const saved = loadJob()
    if ((saved.status==='cloning'||saved.status==='running') && saved.jobId) {
      setJob(saved)
      if (saved.repo) setRepo(saved.repo)
      if (saved.branch) setBranch(saved.branch)
      pollJob(saved.jobId)
    }
    return stopPoll
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files
    if (!fileList || fileList.length === 0) return
    setIsReadingFolder(true)
    try {
      const rawFiles = Array.from(fileList)
      const firstPath = rawFiles[0].webkitRelativePath || ''
      const baseDir = firstPath.split('/')[0] || 'Local Project'
      setUploadedFolderName(baseDir)

      const skipDirNames = new Set([
        'node_modules', '.git', '.venv', 'venv', 'dist', 'build', '.next', '.turbo',
        '.cache', 'reviews_cache', 'chroma_db', 'storage', 'coverage', '.vscode', '.idea',
        '__pycache__', '.agents', '.gemini'
      ])
      const allowedExts = new Set([
        '.py', '.js', '.ts', '.tsx', '.jsx', '.java', '.go', '.rs', '.rb', '.php',
        '.cs', '.cpp', '.c', '.h', '.html', '.css', '.scss', '.json', '.toml',
        '.yaml', '.yml', '.md', '.txt', '.sh', '.sql', '.graphql', '.xml', '.cfg'
      ])

      const filesToRead: Array<{ path: string; content: string }> = []
      for (const f of rawFiles) {
        const fullRel = f.webkitRelativePath
        const rel = fullRel.includes('/') ? fullRel.slice(fullRel.indexOf('/') + 1) : fullRel
        const parts = rel.split('/')
        if (parts.some(p => skipDirNames.has(p.toLowerCase()))) continue

        const ext = ('.' + rel.split('.').pop()?.toLowerCase()) || ''
        const fname = f.name.toLowerCase()
        if (!allowedExts.has(ext) && fname !== 'dockerfile' && fname !== 'makefile') continue
        if (f.size > 1024 * 500) continue // skip files larger than 500KB

        try {
          const text = await f.text()
          if (text.trim()) {
            filesToRead.push({ path: rel, content: text })
          }
        } catch {
          // ignore unreadable files
        }
      }

      setUploadedFiles(filesToRead)
      setRepo(baseDir)
    } finally {
      setIsReadingFolder(false)
    }
  }

  const startReview = async () => {
    if (inputMode === 'upload') {
      if (uploadedFiles.length === 0) return
      stopPoll()
      const displayRepo = uploadedFolderName || 'Uploaded Project'
      const fresh: JobState = {
        ...EMPTY_JOB,
        status: 'cloning' as const,
        message: 'Uploading project files…',
        startedAt: Date.now(),
        repo: displayRepo,
        branch: 'local',
      }
      setJob(fresh); saveJob(fresh)
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (token) headers['Authorization'] = `Bearer ${token}`
        const r = await fetch('/api/full-review/upload', {
          method: 'POST',
          headers,
          body: JSON.stringify({ folderName: displayRepo, files: uploadedFiles }),
        })
        const data = await r.json()

        if (!data.ok) {
          if (data.code === 'QUOTA_EXCEEDED') {
            setJob(EMPTY_JOB); saveJob(EMPTY_JOB)
            setQuotaModal({
              open: true,
              message: data.error || 'Monthly repository review quota reached.',
              plan: data.plan || 'Free',
            })
            return
          }
          if (data.code === 'AUTH_REQUIRED') {
            setJob(EMPTY_JOB); saveJob(EMPTY_JOB)
            nav('/signup?redirect=/')
            return
          }
          throw new Error(data.error || 'Failed to start review')
        }

        loadQuota()
        applyJob(prev => ({ ...prev, jobId: data.jobId }))
        pollJob(data.jobId)
      } catch (e: unknown) {
        applyJob(prev => ({ ...prev, status: 'error', error: (e as Error).message }))
      }
      return
    }

    const cleanRepo = repo.trim().replace(/^["']+|["']+$/g, '').trim()
    if (!cleanRepo) return
    stopPoll()
    const fresh: JobState = {
      ...EMPTY_JOB,
      status: 'cloning' as const,
      message: 'Starting review…',
      startedAt: Date.now(),
      repo: cleanRepo,
      branch: branch.trim() || 'main',
    }
    setJob(fresh); saveJob(fresh)
    try {
      const headers: Record<string,string> = { 'Content-Type':'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`
      const r    = await fetch('/api/full-review/start', { method:'POST', headers, body: JSON.stringify({ repoPath:cleanRepo, branch:branch.trim()||'main' }) })
      const data = await r.json()

      if (!data.ok) {
        if (data.code === 'QUOTA_EXCEEDED') {
          setJob(EMPTY_JOB); saveJob(EMPTY_JOB)
          setQuotaModal({
            open: true,
            message: data.error || 'Monthly repository review quota reached.',
            plan: data.plan || 'Free',
          })
          return
        }
        if (data.code === 'AUTH_REQUIRED') {
          setJob(EMPTY_JOB); saveJob(EMPTY_JOB)
          nav('/signup?redirect=/')
          return
        }
        throw new Error(data.error||'Failed to start job')
      }

      loadQuota()
      applyJob(prev => ({ ...prev, jobId: data.jobId }))
      pollJob(data.jobId)
    } catch (e: unknown) {
      applyJob(prev => ({ ...prev, status:'error', error:(e as Error).message }))
    }
  }

  const clearJob = () => {
    stopPoll()
    setJob(EMPTY_JOB)
    saveJob(EMPTY_JOB)
    setRepo('')
    setUploadedFiles([])
    setUploadedFolderName('')
  }
  const isRunning = job.status==='cloning'||job.status==='running'
  const progress  = job.total>0 ? Math.round((job.step/job.total)*100) : 0
  const fmtElapsed = (s: number|null) => !s ? '' : s>=60 ? `${Math.floor(s/60)}m ${s%60}s` : `${s}s`

  const openPdf = async () => {
    if (!job.markdown) return
    const matchProject = job.markdown.match(/\|\s*\*\*Project\*\*\s*\|\s*`?([^`|\n]+)`?\s*\|/)
    const repoName = matchProject
      ? matchProject[1].trim()
      : (repo.toLowerCase().includes('gito') ? 'CodeSense' : (repo || 'CodeSense'))
    const timeStr  = fmtElapsed(job.elapsed)

    const finalHtml = await preparePdfHtml(job.markdown)

    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(buildPdf(repoName, finalHtml, timeStr))
    win.document.close()
  }

  return (
    <main className="main">
      <section className="hero">
        <span className="hero-badge">
          <Sparkles size={14} /> AI-Powered Code Intelligence
        </span>
        <h1 className="hero-title">
          Review any repo in<br />
          <span className="hero-accent">seconds, not hours</span>
        </h1>
        <p className="hero-desc">
          Paste a GitHub URL or upload your local project folder. CodeSense analyzes high-signal files
          and generates an architectural review with interactive Mermaid diagrams.
        </p>
        {!user && (
          <p className="hero-auth-hint">
            💡 <a href="/signup">Sign up</a> to save your reviews and chat with AI
          </p>
        )}
      </section>

      <div className="input-card">
        {user && membershipStats && (
          <div className="review-quota-pill">
            <span className={`quota-pill-dot ${membershipStats.reviews.remaining === 0 ? 'dot-red' : membershipStats.reviews.remaining <= 1 ? 'dot-yellow' : 'dot-green'}`} />
            <span>
              <strong>{membershipStats.plan} Plan:</strong>{' '}
              {membershipStats.reviews.remaining === -1
                ? 'Unlimited reviews'
                : `${membershipStats.reviews.remaining} of ${membershipStats.reviews.limit} monthly reviews remaining`}
            </span>
            {membershipStats.reviews.remaining !== -1 && (
              <Link to="/pricing" className="quota-pill-upgrade">
                Upgrade <Sparkles size={12} />
              </Link>
            )}
          </div>
        )}
        <div className="input-mode-switcher">
          <button
            type="button"
            className={`mode-tab-btn ${inputMode === 'url' ? 'active' : ''}`}
            onClick={() => setInputMode('url')}
          >
            <Link2 size={15} /> Git URL / Local Path
          </button>
          <button
            type="button"
            className={`mode-tab-btn ${inputMode === 'upload' ? 'active' : ''}`}
            onClick={() => setInputMode('upload')}
          >
            <FolderUp size={15} /> Upload Local Folder
          </button>
        </div>

        {inputMode === 'url' ? (
          <>
            <label className="input-label">Target Repository</label>
            <div className="input-row">
              <div className="input-wrap repo-wrap">
                <Link2 size={16} className="input-icon" />
                <input
                  className="inp"
                  placeholder="https://github.com/owner/repo  or  E:\path\to\repo"
                  value={repo}
                  onChange={e => setRepo(e.target.value)}
                  onKeyDown={e => e.key==='Enter' && !isRunning && startReview()}
                />
              </div>
              <div className="input-wrap branch-wrap">
                <GitBranch size={16} className="input-icon" />
                <input
                  className="inp"
                  placeholder="main"
                  value={branch}
                  onChange={e => setBranch(e.target.value)}
                />
              </div>
            </div>
          </>
        ) : (
          <div>
            <label className="input-label">Upload Local Project</label>
            <input
              type="file"
              ref={folderInputRef}
              style={{ display: 'none' }}
              // @ts-expect-error webkitdirectory is standard in HTML5 browsers
              webkitdirectory=""
              directory=""
              multiple
              onChange={handleFolderSelect}
            />
            {uploadedFiles.length === 0 ? (
              <div
                className="folder-dropzone"
                onClick={() => folderInputRef.current?.click()}
              >
                <div className="folder-dropzone-icon">
                  {isReadingFolder ? <Loader2 size={22} className="spin" /> : <FolderUp size={22} />}
                </div>
                <div className="folder-dropzone-title">
                  {isReadingFolder ? 'Reading project files…' : 'Click to select your local project folder'}
                </div>
                <div className="folder-dropzone-subtitle">
                  Select your local folder (e.g. <code>E:\Codesense</code>). CodeSense parses high-signal source files directly in your browser and securely transmits them for review.
                </div>
              </div>
            ) : (
              <div className="folder-selected-box">
                <div className="folder-selected-info">
                  <div className="folder-dropzone-icon" style={{ margin: 0, width: 38, height: 38 }}>
                    <Folder size={20} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{uploadedFolderName}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)' }}>
                      Ready to analyze
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="folder-badge">{uploadedFiles.length} files selected</span>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => folderInputRef.current?.click()}
                  >
                    Change Folder
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="btn-row">
          <button
            className="btn btn-primary"
            onClick={startReview}
            disabled={isRunning || (inputMode === 'url' ? !repo.trim() : uploadedFiles.length === 0)}
          >
            {isRunning ? (
              <>
                <Loader2 size={16} className="spin" /> Reviewing…
              </>
            ) : (
              <>
                <Rocket size={16} /> {inputMode === 'upload' && uploadedFiles.length > 0 ? `Start Review (${uploadedFiles.length} files)` : 'Start Review'}
              </>
            )}
          </button>
          {job.status !== 'idle' && (
            <button className="btn btn-outline btn-sm" onClick={clearJob}>
              <X size={14} /> Clear
            </button>
          )}
        </div>

        {isRunning && (
          <div className="status-bar running animate-fadeIn">
            <span className="spin-dot" />
            <div className="status-text">
              <span>{job.message}</span>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
            </div>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, flexShrink: 0 }}>
              {job.step}/{job.total}
            </span>
          </div>
        )}

        {job.status === 'done' && (
          <div className="status-bar done animate-fadeIn">
            <CheckCircle2 size={18} />
            <span>Review complete!</span>
            {job.elapsed != null && (
              <span style={{ marginLeft: 'auto', fontSize: '0.82rem', opacity: 0.85, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Clock size={13} /> {fmtElapsed(job.elapsed)}
              </span>
            )}
          </div>
        )}

        {job.status === 'error' && (
          <div className="status-bar err animate-fadeIn">
            <AlertTriangle size={18} />
            <span>{job.error || 'Something went wrong.'}</span>
          </div>
        )}
      </div>

      <div className="features-row">
        {FEATURES.map(f => {
          const Icon = f.icon
          return (
            <div key={f.title} className="feature-pill">
              <div className="fp-icon">
                <Icon size={18} />
              </div>
              <div>
                <div className="fp-title">{f.title}</div>
                <div className="fp-desc">{f.desc}</div>
              </div>
            </div>
          )
        })}
      </div>

      <div>
        <div className="tab-bar">
          <div className="tab tab-on" style={{ cursor: 'default' }}>
            <FileText size={15} /> Architecture & Review Report
          </div>

          {job.status === 'done' && (
            <div className="tab-actions">
              <button className="btn btn-outline btn-sm" onClick={openPdf}>
                <FileDown size={14} /> View PDF
              </button>
              <button className="btn btn-outline btn-sm" onClick={openPdf}>
                <Printer size={14} /> Print
              </button>
              {user && job.jobId && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={async () => {
                    try {
                      const r = await fetch('/api/history', { headers: { Authorization: `Bearer ${token}` } })
                      const d = await r.json()
                      if (d.ok && d.reviews.length > 0) {
                        const rev = d.reviews.find((x: { repo: string }) => x.repo === repo) || d.reviews[0]
                        if (rev) nav(`/chat/${rev.id}`)
                      }
                    } catch { nav('/history') }
                  }}
                >
                  <MessageSquare size={14} /> Chat with AI
                </button>
              )}
            </div>
          )}
        </div>

        {job.status === 'done' && job.markdown && (
          <div className="doc-card animate-fadeIn">
            <div className="doc-header">
              <div>
                <div className="doc-eyebrow">Code Review Report</div>
                <div className="doc-title">{(() => {
                  if (job.markdown) {
                    const matchProject = job.markdown.match(/\|\s*\*\*Project\*\*\s*\|\s*`?([^`|\n]+)`?\s*\|/)
                    if (matchProject) return matchProject[1].trim()
                  }
                  return repo.toLowerCase().includes('gito') ? 'CodeSense' : (repo || 'CodeSense')
                })()}</div>
                <div className="doc-meta">
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <GitBranch size={13} /> {branch}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Clock size={13} /> {new Date().toLocaleString()}
                  </span>
                  {job.elapsed != null && (
                    <span>⏱ {fmtElapsed(job.elapsed)}</span>
                  )}
                  {user && (
                    <span style={{ color: 'var(--primary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Check size={13} /> Saved to history
                    </span>
                  )}
                </div>
              </div>
            </div>
            <MermaidDoc html={parseMd(job.markdown)} id="review-doc" />
          </div>
        )}

        {job.status === 'idle' && (
          <div className="doc-card" style={{ textAlign: 'center', padding: '64px 40px' }}>
            <div style={{ width: 64, height: 64, borderRadius: 16, background: 'var(--primary-subtle)', color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <BrainCircuit size={32} />
            </div>
            <p style={{ fontSize: '1rem', color: 'var(--muted-foreground)' }}>
              Enter a repository URL or local path above and click <strong style={{ color: 'var(--primary)' }}>Start Review</strong> to begin.
            </p>
          </div>
        )}
      </div>

      <footer className="footer">
        Built with CodeSense · AI code review & architecture analysis
      </footer>

      {/* Quota Exceeded Modal */}
      {quotaModal.open && (
        <div className="modal-backdrop animate-fadeIn" onClick={() => setQuotaModal({ open: false, message: '', plan: 'FREE' })}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-icon-wrap modal-icon-warn">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h3 className="modal-title">Monthly Quota Reached</h3>
                <span className="modal-subtitle">{quotaModal.plan} Plan Allowance Exhausted</span>
              </div>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
                {quotaModal.message}
              </p>
              <div className="modal-callout">
                <strong>Need more reviews?</strong>
                <p style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>
                  Upgrade to <strong>Pro</strong> for 50 repository reviews per month, 500 AI chat questions,
                  and 3 concurrent review jobs.
                </p>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setQuotaModal({ open: false, message: '', plan: 'FREE' })}
              >
                Close
              </button>
              <Link
                to="/pricing"
                className="btn btn-primary btn-sm"
                style={{ textDecoration: 'none' }}
              >
                <Sparkles size={14} />
                <span>View Pricing Plans</span>
              </Link>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

// ── HTML preparation for PDF export (ensures all Mermaid diagrams are rendered inline SVGs) ──
export async function preparePdfHtml(markdown: string): Promise<string> {
  const html = parseMd(markdown)
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = html

  const targetWraps = Array.from(tempDiv.querySelectorAll<HTMLElement>('.mermaid-wrap'))
  if (targetWraps.length === 0) return html

  // 1. First attempt: grab already-rendered SVGs from active DOM
  const renderedWraps = Array.from(document.querySelectorAll<HTMLElement>('.mermaid-wrap'))
  if (renderedWraps.length > 0) {
    renderedWraps.forEach((rw, idx) => {
      const svg = rw.querySelector('svg')
      if (svg && targetWraps[idx]) {
        const clone = svg.cloneNode(true) as SVGSVGElement
        clone.removeAttribute('height')
        clone.style.maxWidth = '100%'
        clone.style.height = 'auto'
        clone.style.display = 'block'
        clone.style.margin = '0 auto'
        targetWraps[idx].innerHTML = clone.outerHTML
      }
    })
  }

  // 2. Second attempt: if any diagram wrap still contains unrendered .mermaid, render it using Mermaid
  const remainingNodes = Array.from(tempDiv.querySelectorAll<HTMLElement>('.mermaid'))
  if (remainingNodes.length > 0) {
    try {
      const m = await getMermaid()
      if (m) {
        tempDiv.style.position = 'fixed'
        tempDiv.style.left = '-9999px'
        tempDiv.style.top = '-9999px'
        tempDiv.style.visibility = 'hidden'
        document.body.appendChild(tempDiv)

        remainingNodes.forEach((node, i) => {
          node.id = `pdf-render-${Date.now()}-${i}`
        })
        await m.run({ nodes: remainingNodes })
      }
    } catch (err) {
      console.warn('Fallback diagram rendering for PDF notice:', err)
    } finally {
      if (tempDiv.parentNode) {
        document.body.removeChild(tempDiv)
      }
    }
  }

  return tempDiv.innerHTML
}

// ── PDF builder (Emerald theme) ───────────────────────────────────────────────
export function buildPdf(repoName: string, html: string, timeStr?: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>Code Review — ${repoName}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',system-ui,sans-serif;background:#fff;color:#1e293b;padding:36px 48px;max-width:960px;margin:0 auto;font-size:13.5px;line-height:1.65}

.no-print{text-align:right;margin-bottom:20px}
.no-print button{background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;padding:9px 22px;border-radius:8px;font-size:0.88rem;font-weight:600;cursor:pointer;margin-left:10px;box-shadow:0 2px 8px rgba(34,197,94,0.3)}
.print-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;padding-bottom:14px;border-bottom:2px solid #16a34a}
.print-title{font-size:1.35rem;font-weight:800;color:#0f172a}
.print-meta{font-size:0.78rem;color:#64748b}

h1{font-size:1.35rem;font-weight:800;color:#0f172a;margin:28px 0 10px;padding-bottom:6px;border-bottom:2px solid #16a34a}
h2{font-size:1.1rem;font-weight:700;color:#16a34a;margin:20px 0 8px;padding-bottom:5px;border-bottom:1px solid #bbf7d0}
h3{font-size:0.96rem;font-weight:600;color:#15803d;margin:14px 0 6px}
h4{font-size:0.88rem;color:#16a34a;margin:10px 0 4px}
p{margin:6px 0 10px;color:#334155}
strong{color:#0f172a;font-weight:600}
em{color:#15803d;font-style:italic}
code{font-family:'JetBrains Mono',monospace;font-size:0.82em;background:#f0fdf4;color:#166534;border-radius:4px;padding:2px 5px;border:1px solid #bbf7d0}
pre{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin:10px 0;overflow-x:auto}
pre code{background:none;border:none;padding:0;color:#1e293b;font-size:11.5px}

.table-wrap{margin:10px 0 16px;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:0.82rem;line-height:1.4}
thead{background:#f0fdf4}
th{color:#166534;padding:7px 10px;text-align:left;font-weight:700;border-bottom:2px solid #bbf7d0;white-space:nowrap;font-size:0.76rem;text-transform:uppercase;letter-spacing:0.04em}
td{padding:6px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top;color:#1e293b}
tr:nth-child(even){background:#f8fafc}

ul,ol{padding-left:22px;margin:6px 0 10px;color:#334155}
li{margin-bottom:3px}
hr{border:none;border-top:1px solid #e2e8f0;margin:18px 0}

.inline-code{font-family:'JetBrains Mono',monospace;font-size:0.82em;background:#f0fdf4;color:#166534;border-radius:4px;padding:2px 5px;border:1px solid #bbf7d0}
.size-badge{display:inline-block;font-size:0.72rem;font-weight:700;padding:2px 8px;border-radius:999px;border:1px solid}
.mermaid-wrap{background:#0d1117;border:1px solid #30363d;border-radius:10px;padding:18px;margin:18px 0;display:block;text-align:center;overflow:visible;box-shadow:0 4px 12px rgba(0,0,0,0.15)}
.mermaid-wrap svg{max-width:100%!important;height:auto!important;display:block!important;margin:0 auto!important}
.mermaid{display:flex;justify-content:center}

@page {
  size: A4 portrait;
  margin: 1.4cm 1.2cm 1.4cm 1.2cm;
}

@media print {
  html, body {
    padding: 0 !important;
    margin: 0 !important;
    max-width: 100% !important;
    width: 100% !important;
    background: #ffffff !important;
    color: #0f172a !important;
    font-size: 11pt !important;
    line-height: 1.5 !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  .no-print { display: none !important; }
  .print-header {
    break-after: avoid !important;
    page-break-after: avoid !important;
    margin-bottom: 16px !important;
    padding-bottom: 10px !important;
  }

  /* Section heading pagination */
  h1 {
    break-before: page !important;
    page-break-before: always !important;
    break-after: avoid !important;
    page-break-after: avoid !important;
    margin-top: 0 !important;
    padding-top: 10px !important;
  }
  /* Prevent blank page before the very first section right after the header */
  h1:first-of-type,
  .print-header + h1,
  .print-header + * h1 {
    break-before: avoid !important;
    page-break-before: avoid !important;
    margin-top: 10px !important;
  }

  /* Subheadings never orphan at bottom of a page */
  h2, h3, h4 {
    break-after: avoid !important;
    page-break-after: avoid !important;
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }
  h2 { margin-top: 18px !important; margin-bottom: 6px !important; }
  h3 { margin-top: 14px !important; margin-bottom: 4px !important; }

  /* Headings with introductory text never orphan before following tables or diagrams */
  h1 + p, h2 + p, h3 + p, h4 + p {
    break-after: avoid !important;
    page-break-after: avoid !important;
  }

  /* Keep the Use Case Diagram & Actor Matrix subsection unified on a fresh page */
  .usecase-break {
    break-before: page !important;
    page-break-before: always !important;
    break-after: avoid !important;
    page-break-after: avoid !important;
    margin-top: 0 !important;
    padding-top: 10px !important;
  }

  /* Paragraphs and list items avoid dangling orphan/widow lines */
  p, li, blockquote {
    orphans: 3 !important;
    widows: 3 !important;
  }

  /* Tables: allow splitting across pages cleanly, but keep rows intact and repeat headers */
  .table-wrap {
    overflow: visible !important;
    break-inside: auto !important;
    page-break-inside: auto !important;
    margin: 8px 0 14px !important;
  }
  table {
    width: 100% !important;
    border-collapse: collapse !important;
    break-inside: auto !important;
    page-break-inside: auto !important;
  }
  thead {
    display: table-header-group !important;
  }
  tbody {
    break-inside: auto !important;
    page-break-inside: auto !important;
  }
  tr {
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }
  th, td {
    padding: 5px 8px !important;
    font-size: 9.5pt !important;
    word-break: break-word !important;
  }

  /* Lists: let lists break naturally between items */
  ul, ol {
    break-inside: auto !important;
    page-break-inside: auto !important;
    margin: 6px 0 10px !important;
  }
  li {
    break-inside: avoid !important;
    page-break-inside: avoid !important;
    margin-bottom: 3px !important;
  }

  /* Code blocks: wrap neatly to prevent horizontal overflow/cutting */
  pre {
    white-space: pre-wrap !important;
    word-break: break-word !important;
    overflow-wrap: break-word !important;
    break-inside: avoid !important;
    page-break-inside: avoid !important;
    max-width: 100% !important;
    padding: 8px 12px !important;
    margin: 8px 0 !important;
    background: #f8fafc !important;
    border: 1px solid #cbd5e1 !important;
  }
  pre code {
    white-space: pre-wrap !important;
    word-break: break-word !important;
    overflow-wrap: break-word !important;
    font-size: 9.5pt !important;
  }

  /* Diagrams: keep intact, visible, crisp on dark blueprint canvas, and scaled inside page bounds */
  .mermaid-wrap {
    background: #0d1117 !important;
    border: 1px solid #30363d !important;
    border-radius: 8px !important;
    padding: 14px 10px !important;
    margin: 14px 0 !important;
    break-inside: avoid !important;
    page-break-inside: avoid !important;
    display: block !important;
    text-align: center !important;
    overflow: visible !important;
    box-sizing: border-box !important;
    width: 100% !important;
  }
  .mermaid-wrap svg {
    max-width: 100% !important;
    max-height: 190mm !important;
    height: auto !important;
    display: block !important;
    margin: 0 auto !important;
  }

  .vis-diagram-card, blockquote {
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }

  hr {
    border: none !important;
    border-top: 1px solid #e2e8f0 !important;
    margin: 14px 0 !important;
    break-after: avoid !important;
    page-break-after: avoid !important;
  }
}
</style>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
  try {
    mermaid.initialize({ startOnLoad: false, theme: 'base', themeVariables: {
      primaryColor: '#16a34a',
      primaryTextColor: '#ffffff',
      primaryBorderColor: '#22c55e',
      lineColor: '#22c55e',
      secondaryColor: '#161b22',
      tertiaryColor: '#0d1117',
      background: '#0d1117',
      mainBkg: '#161b22',
      nodeBorder: '#22c55e',
      clusterBkg: '#1c2128',
      titleColor: '#e6edf3',
      edgeLabelBackground: '#161b22',
      fontFamily: 'Inter, system-ui, sans-serif'
    }});
    const unrendered = document.querySelectorAll('.mermaid');
    if (unrendered.length > 0) {
      mermaid.run({ nodes: Array.from(unrendered) });
    }
  } catch(_) {}
</script>
</head><body>
<div class="no-print">
  <button onclick="window.print()">🖨️ Print / Save as PDF</button>
  <button onclick="window.close()">✕ Close</button>
</div>
<div class="print-header">
  <div>
    <div class="print-title">Code Review — ${repoName}</div>
    <div class="print-meta">${timeStr ? '⏱ ' + timeStr + ' · ' : ''}${new Date().toLocaleString()}</div>
  </div>
  <div class="print-meta">Generated by CodeSense</div>
</div>
${html}
</body></html>`
}
