import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import {
  BrainCircuit,
  ArrowLeft,
  Trash2,
  Download,
  RotateCw,
  Send,
  Copy,
  Check,
  User,
  Sparkles,
  Loader2,
  Paperclip,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { MermaidDoc } from '../components/MermaidViewer'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Source { heading: string; score: number }
interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  sources?: Source[]
  elapsed_ms?: number
  ts: number
}

const SUGGESTED: string[] = [
  'Explain this project in simple terms',
  'Generate a class diagram',
  'Show me the authentication flow as a sequence diagram',
  'What are the main APIs and how do I use them?',
  'What are the biggest security risks?',
  'Suggest future features for this project',
  'Explain the database schema and relationships',
  'What is the production readiness of this project?',
  'Generate a deployment architecture diagram',
  'What technical debt should be addressed first?',
  'Explain the system architecture',
  'How can this project be scaled?',
]

function genId() { return Math.random().toString(36).slice(2) }
function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function makeMsg(role: 'user' | 'assistant' | 'system', content: string, extra?: Partial<Message>): Message {
  return {
    id: genId(),
    role,
    content,
    ts: Date.now(),
    ...extra,
  }
}

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

// ── Markdown renderer (for chat messages) ─────────────────────────────────────
function renderMd(text: string): string {
  const blocks: string[] = []
  let raw = text

  raw = raw.replace(/```mermaid\n?([\s\S]*?)```/g, (_: string, code: string) => {
    const idx = blocks.length
    blocks.push(`<div class="mermaid-wrap"><div class="mermaid">${sanitizeMermaid(code)}</div></div>`)
    return `%%%BLOCK_MERMAID_${idx}%%%`
  })

  raw = raw.replace(/```(\w*)\n?([\s\S]*?)```/g, (_: string, lang: string, code: string) => {
    const idx = blocks.length
    const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    blocks.push(`<pre class="chat-code"><code class="${lang ? `lang-${lang}` : ''}">${escaped}</code></pre>`)
    return `%%%BLOCK_CODE_${idx}%%%`
  })

  let h = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  h = h.replace(/^#### (.+)$/gm, '<h4 class="chat-h4">$1</h4>')
  h = h.replace(/^### (.+)$/gm,  '<h3 class="chat-h3">$1</h3>')
  h = h.replace(/^## (.+)$/gm,   '<h2 class="chat-h2">$1</h2>')
  h = h.replace(/^# (.+)$/gm,    '<h1 class="chat-h1">$1</h1>')

  h = h.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  h = h.replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>')
  h = h.replace(/\*(.+?)\*/g,         '<em>$1</em>')
  h = h.replace(/`([^`]+)`/g,         '<code class="chat-inline">$1</code>')

  h = h.replace(/((?:^[-*+] .+\n?)+)/gm, (blk: string) =>
    '<ul class="chat-ul">' + blk.trim().split('\n').map((l: string) => `<li>${l.replace(/^[-*+] /,'')}</li>`).join('') + '</ul>')
  h = h.replace(/((?:^\d+\. .+\n?)+)/gm, (blk: string) =>
    '<ol class="chat-ol">' + blk.trim().split('\n').map((l: string) => `<li>${l.replace(/^\d+\. /,'')}</li>`).join('') + '</ol>')

  h = h.replace(/^(?!<[a-zA-Z/]|$)(.{2,})$/gm, '<p>$1</p>')
  h = h.replace(/<p>\s*<\/p>/g, '')

  h = h.replace(/%%%BLOCK_(?:MERMAID|CODE)_(\d+)%%%/g, (_: string, idx: string) => blocks[parseInt(idx)] || '')

  return h
}

function AiMessageContent({ html, id }: { html: string; id: string }) {
  return <MermaidDoc html={html} id={`chat-${id}`} className="chat-ai-content" />
}

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setDone(true); setTimeout(() => setDone(false), 1500)
    })
  }
  return (
    <button className="chat-copy-btn" onClick={copy} title="Copy response">
      {done ? <Check size={13} style={{ color: 'var(--primary)' }} /> : <Copy size={13} />}
    </button>
  )
}

// ── Sources badge list ────────────────────────────────────────────────────────
function SourcesList({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false)
  if (!sources.length) return null
  return (
    <div className="chat-sources">
      <button className="chat-sources-toggle" onClick={() => setOpen(o => !o)}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Paperclip size={12} /> {sources.length} source{sources.length > 1 ? 's' : ''}
          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </span>
      </button>
      {open && (
        <div className="chat-sources-list animate-fadeIn">
          {sources.map((s, i) => (
            <span key={i} className="chat-source-chip" title={`relevance: ${(s.score * 100).toFixed(0)}%`}>
              {s.heading || 'Section'}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Single message bubble ─────────────────────────────────────────────────────
function MessageBubble({ msg, onRegenerate }: { msg: Message; onRegenerate?: () => void }) {
  const isUser  = msg.role === 'user'
  const isSystem = msg.role === 'system'

  if (isSystem) return (
    <div className="chat-system-msg animate-fadeIn">
      <span>{msg.content}</span>
    </div>
  )

  return (
    <div className={`chat-msg-row ${isUser ? 'chat-msg-user' : 'chat-msg-ai'} animate-fadeIn`}>
      <div className="chat-avatar">
        {isUser ? <User size={16} /> : <BrainCircuit size={16} />}
      </div>
      <div className="chat-bubble-wrap">
        <div className={`chat-bubble ${isUser ? 'chat-bubble-user' : 'chat-bubble-ai'}`}>
          {isUser ? (
            <p className="chat-user-text">{msg.content}</p>
          ) : (
            <AiMessageContent
              html={renderMd(msg.content)}
              id={msg.id}
            />
          )}
        </div>
        <div className="chat-meta-row">
          <span className="chat-ts">{fmtTime(msg.ts)}</span>
          {msg.elapsed_ms && (
            <span className="chat-elapsed">⏱ {(msg.elapsed_ms / 1000).toFixed(1)}s</span>
          )}
          {!isUser && (
            <>
              <CopyBtn text={msg.content} />
              {onRegenerate && (
                <button className="chat-copy-btn" onClick={onRegenerate} title="Regenerate">
                  <RotateCw size={13} />
                </button>
              )}
            </>
          )}
        </div>
        {!isUser && msg.sources && <SourcesList sources={msg.sources} />}
      </div>
    </div>
  )
}

// ── Typing indicator ──────────────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div className="chat-msg-row chat-msg-ai animate-fadeIn">
      <div className="chat-avatar">
        <BrainCircuit size={16} />
      </div>
      <div className="chat-bubble chat-bubble-ai chat-typing">
        <span /><span /><span />
      </div>
    </div>
  )
}

// ── Main ChatPage ─────────────────────────────────────────────────────────────
export default function ChatPage() {
  const { reviewId } = useParams<{ reviewId: string }>()
  const { token, user } = useAuth()
  const nav = useNavigate()

  const [messages,   setMessages]   = useState<Message[]>([])
  const [input,      setInput]      = useState('')
  const [loading,    setLoading]    = useState(false)
  const [indexing,   setIndexing]   = useState(false)
  const [indexed,    setIndexed]    = useState(false)
  const [indexError, setIndexError] = useState('')
  const [sessionId,  setSessionId]  = useState<string | null>(null)
  const [repoName,   setRepoName]   = useState('')
  const [showSugg,   setShowSugg]   = useState(true)

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)

  // Auth guard
  useEffect(() => {
    if (!user) nav('/login')
  }, [user, nav])

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const addSystemMsg = useCallback((content: string) =>
    setMessages(prev => [...prev, makeMsg('system', content)]), [])

  const indexReview = useCallback(async () => {
    if (!reviewId || !token) return
    setIndexing(true)
    setIndexError('')
    addSystemMsg('🔄 Building knowledge base from review…')
    try {
      const r = await fetch('/api/chat/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reviewId }),
      })
      const d = await r.json()
      if (d.ok || d.chunks > 0) {
        setIndexed(true)
        addSystemMsg(`✅ Knowledge base ready (${d.chunks} chunks). Ask me anything about this codebase!`)
      } else {
        const errMsg = d.error || 'Indexing failed'
        setIndexError(errMsg)
        if (errMsg.includes('unavailable') || errMsg.includes('fetch')) {
          addSystemMsg(`⚠️ Chat service is not running. Please start it with:\n\n  start_chat_service.bat\n\nThen click 🔄 Retry.`)
        } else {
          addSystemMsg(`❌ Failed to build knowledge base: ${errMsg}`)
        }
      }
    } catch (e) {
      const msg = (e as Error).message
      setIndexError(msg)
      addSystemMsg(`⚠️ Chat service is not running on port 8000.\n\nTo start it, run this in the project folder:\n  start_chat_service.bat\n\nThen click 🔄 Retry above.`)
    } finally {
      setIndexing(false)
    }
  }, [reviewId, token, addSystemMsg])

  // Load review info + auto-index
  useEffect(() => {
    if (!reviewId || !token) return

    const init = async () => {
      try {
        const r = await fetch(`/api/chat/index/${reviewId}/status`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const d = await r.json()
        if (d.indexed) {
          setIndexed(true)
          addSystemMsg(`✅ Knowledge base ready (${d.chunks} chunks). Ask me anything about this codebase!`)
          return
        }
      } catch { /* ignore */ }

      try {
        const r = await fetch(`/api/history`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const d = await r.json()
        if (d.ok) {
          const rev = d.reviews.find((x: { id: string }) => x.id === reviewId)
          if (rev) setRepoName(rev.repo)
          else { setIndexError('Review not found'); return }
        }
      } catch { /* ignore */ }

      await indexReview()
    }

    init()
  }, [reviewId, token, addSystemMsg, indexReview])

  const sendMessage = async (text?: string) => {
    const q = (text || input).trim()
    if (!q || loading || !indexed) return

    setInput('')
    setShowSugg(false)
    const userMsg: Message = makeMsg('user', q)
    setMessages(prev => [...prev, userMsg])
    setLoading(true)

    const aiMsgId = genId()
    const startTime = Date.now()
    let accumulated = ''
    let sources: Source[] = []

    try {
      const response = await fetch('/api/chat/ask/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reviewId, sessionId, question: q }),
      })

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}))
        throw new Error(errJson.error || `Request failed with status ${response.status}`)
      }

      if (!response.body) throw new Error('ReadableStream not supported')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data: ')) continue
          const dataStr = trimmed.slice(6).trim()
          if (!dataStr) continue
          try {
            const data = JSON.parse(dataStr)
            if (data.session_id) setSessionId(data.session_id)
            if (data.sources) sources = data.sources
            if (data.token) {
              accumulated += data.token
              setMessages(prev => {
                const idx = prev.findIndex(m => m.id === aiMsgId)
                const updatedMsg: Message = {
                  id: aiMsgId,
                  role: 'assistant',
                  content: accumulated,
                  sources,
                  elapsed_ms: Date.now() - startTime,
                  ts: Date.now(),
                }
                if (idx === -1) return [...prev, updatedMsg]
                const copy = [...prev]
                copy[idx] = updatedMsg
                return copy
              })
            }
          } catch (_) {}
        }
      }
    } catch (e) {
      try {
        const r = await fetch('/api/chat/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ reviewId, sessionId, question: q }),
        })
        const d = await r.json()
        if (!r.ok) throw new Error(d.error || 'Request failed')
        if (d.session_id) setSessionId(d.session_id)
        const aiMsg: Message = makeMsg('assistant', d.answer, {
          sources: d.sources || [],
          elapsed_ms: d.elapsed_ms,
        })
        setMessages(prev => [...prev.filter(m => m.id !== aiMsgId), aiMsg])
      } catch (errFallback) {
        const errMsg: Message = makeMsg('assistant', `⚠️ Error: ${(e as Error).message}`)
        setMessages(prev => [...prev.filter(m => m.id !== aiMsgId), errMsg])
      }
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  const regenerateLast = () => {
    const lastUser = [...messages].reverse().find(m => m.role === 'user')
    if (!lastUser) return
    setMessages(prev => {
      const idx = [...prev].reverse().findIndex(m => m.role === 'assistant')
      if (idx === -1) return prev
      const realIdx = prev.length - 1 - idx
      return prev.slice(0, realIdx)
    })
    sendMessage(lastUser.content)
  }

  const clearChat = () => {
    setMessages([])
    setSessionId(null)
    setShowSugg(true)
    if (indexed) addSystemMsg('✅ Chat cleared. Knowledge base is still ready.')
  }

  const exportChat = () => {
    const lines = messages
      .filter(m => m.role !== 'system')
      .map(m => `[${m.role.toUpperCase()}] ${new Date(m.ts).toLocaleString()}\n${m.content}`)
      .join('\n\n---\n\n')
    const blob = new Blob([lines], { type: 'text/plain' })
    const a    = document.createElement('a')
    a.href     = URL.createObjectURL(blob)
    a.download = `codesense-chat-${reviewId?.slice(0, 8)}.txt`
    a.click()
  }

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  return (
    <div className="chat-shell">
      {/* Header */}
      <div className="chat-header">
        <div className="chat-header-left">
          <Link to="/history" className="chat-back-btn" title="Back to History">
            <ArrowLeft size={14} /> Back
          </Link>
          <div>
            <div className="chat-header-title">CodeSense AI Assistant</div>
            {repoName && <div className="chat-header-repo" title={repoName}>{repoName}</div>}
          </div>
        </div>
        <div className="chat-header-actions">
          <span className={`chat-status-dot ${indexed ? 'chat-dot-ready' : indexing ? 'chat-dot-indexing' : 'chat-dot-error'}`} />
          <span className="chat-status-label">{indexed ? 'Ready' : indexing ? 'Indexing…' : 'Offline'}</span>
          <button className="theme-toggle-btn" onClick={clearChat} title="Clear chat history">
            <Trash2 size={16} />
          </button>
          <button className="theme-toggle-btn" onClick={exportChat} title="Export chat conversation">
            <Download size={16} />
          </button>
          {indexError && (
            <button className="theme-toggle-btn" onClick={indexReview} title="Retry indexing review">
              <RotateCw size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 && !indexing && (
          <div className="chat-empty animate-fadeIn">
            <div className="chat-empty-icon">
              <BrainCircuit size={48} />
            </div>
            <div className="chat-empty-title">Ask anything about the codebase</div>
            <div className="chat-empty-sub">
              CodeSense AI has indexed the full architectural review. Ask about code design, security risks, database schemas, or generate new diagrams.
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            onRegenerate={
              msg.role === 'assistant' && i === messages.length - 1
                ? regenerateLast
                : undefined
            }
          />
        ))}

        {loading && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Suggested questions */}
      {showSugg && indexed && messages.filter(m => m.role === 'user').length === 0 && (
        <div className="chat-suggestions animate-fadeIn">
          <div className="chat-sugg-label">
            <Sparkles size={12} style={{ display: 'inline', marginRight: 4, color: 'var(--primary)' }} />
            Suggested questions
          </div>
          <div className="chat-sugg-grid">
            {SUGGESTED.map(q => (
              <button key={q} className="chat-sugg-btn" onClick={() => sendMessage(q)}>
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="chat-input-area">
        <div className={`chat-input-wrap ${!indexed ? 'chat-input-disabled' : ''}`}>
          <textarea
            ref={inputRef}
            className="chat-textarea"
            rows={1}
            placeholder={
              indexing
                ? 'Building knowledge base…'
                : indexed
                ? 'Ask about this codebase… (Enter to send, Shift+Enter for newline)'
                : 'Knowledge base not ready'
            }
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            disabled={!indexed || loading}
          />
          <button
            className="chat-send-btn"
            onClick={() => sendMessage()}
            disabled={!input.trim() || !indexed || loading}
            aria-label="Send message"
          >
            {loading ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
          </button>
        </div>
        <div className="chat-input-hint">
          Powered by Ollama / Qwen2.5 · Grounded in code analysis with traceable citations
        </div>
      </div>
    </div>
  )
}
