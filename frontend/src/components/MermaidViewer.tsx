import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
  Download,
  FileCode,
  Layers,
  X,
  Check,
} from 'lucide-react'

// ── Mermaid lazy-loader (adapted to emerald / GitHub Dark theme) ─────────────
let _mermaidReady = false
export async function getMermaid() {
  if (_mermaidReady) {
    const m = await import('mermaid')
    return m.default
  }
  const m = await import('mermaid')
  m.default.initialize({
    startOnLoad: false,
    theme: 'base',
    themeVariables: {
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
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '13px',
    },
    flowchart: { curve: 'basis', htmlLabels: true },
    sequence: { actorMargin: 80, messageMargin: 40 },
  })
  _mermaidReady = true
  return m.default
}

// ── Download Helpers ─────────────────────────────────────────────────────────

export function downloadSvg(svgElement: SVGSVGElement, filename = 'codesense-diagram.svg') {
  try {
    const clone = svgElement.cloneNode(true) as SVGSVGElement
    clone.style.transform = ''
    clone.style.transformOrigin = ''
    clone.style.maxWidth = 'none'

    const serializer = new XMLSerializer()
    let source = serializer.serializeToString(clone)

    if (!source.match(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)) {
      source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"')
    }
    if (!source.match(/^<svg[^>]+xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink"/)) {
      source = source.replace(/^<svg/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"')
    }

    const preface = '<?xml version="1.0" standalone="no"?>\r\n'
    const blob = new Blob([preface, source], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (err) {
    console.error('Failed to export SVG:', err)
  }
}

export function downloadPng(svgElement: SVGSVGElement, filename = 'codesense-diagram.png', scale = 2) {
  try {
    const clone = svgElement.cloneNode(true) as SVGSVGElement
    clone.style.transform = ''
    clone.style.transformOrigin = ''
    clone.style.maxWidth = 'none'

    const bbox = svgElement.getBoundingClientRect()
    const viewBox = svgElement.viewBox?.baseVal
    const w = viewBox && viewBox.width > 0 ? viewBox.width : bbox.width || 800
    const h = viewBox && viewBox.height > 0 ? viewBox.height : bbox.height || 600

    clone.setAttribute('width', String(w))
    clone.setAttribute('height', String(h))

    const serializer = new XMLSerializer()
    let source = serializer.serializeToString(clone)
    if (!source.match(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)) {
      source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"')
    }
    if (!source.match(/^<svg[^>]+xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink"/)) {
      source = source.replace(/^<svg/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"')
    }

    const svgBlob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(w * scale)
      canvas.height = Math.round(h * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const isDark =
        document.documentElement.classList.contains('dark') ||
        document.body.classList.contains('dark') ||
        window.matchMedia('(prefers-color-scheme: dark)').matches
      ctx.fillStyle = isDark ? '#0d1117' : '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)

      try {
        canvas.toBlob(blob => {
          if (blob) {
            const pngUrl = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = pngUrl
            a.download = filename
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            setTimeout(() => URL.revokeObjectURL(pngUrl), 1000)
          } else {
            const dataUrl = canvas.toDataURL('image/png')
            const a = document.createElement('a')
            a.href = dataUrl
            a.download = filename
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
          }
        }, 'image/png')
      } catch {
        const dataUrl = canvas.toDataURL('image/png')
        const a = document.createElement('a')
        a.href = dataUrl
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      }
    }
    img.onerror = e => {
      console.error('Image load error during PNG conversion:', e)
      URL.revokeObjectURL(url)
    }
    img.src = url
  } catch (err) {
    console.error('Failed to export PNG:', err)
  }
}

// ── Fullscreen Lightbox Modal ────────────────────────────────────────────────

export function DiagramFullscreenModal({
  svgElement,
  imageSrc,
  title = 'System Architecture Diagram',
  onClose,
}: {
  svgElement?: SVGSVGElement | null
  imageSrc?: string | null
  title?: string
  onClose: () => void
}) {
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [copySuccess, setCopySuccess] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Zoom helpers
  const handleZoomIn = useCallback(() => setScale(s => Math.min(Number((s + 0.25).toFixed(2)), 4.0)), [])
  const handleZoomOut = useCallback(() => setScale(s => Math.max(Number((s - 0.25).toFixed(2)), 0.3)), [])
  const handleReset = useCallback(() => {
    setScale(1)
    setPan({ x: 0, y: 0 })
  }, [])

  // Keyboard navigation: Escape closes modal, +/- zooms, 0 resets
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === '+' || e.key === '=') handleZoomIn()
      else if (e.key === '-') handleZoomOut()
      else if (e.key === '0') handleReset()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, handleZoomIn, handleZoomOut, handleReset])

  // Mouse pan handlers with window listener for smooth dragging
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    setIsDragging(true)
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
  }

  useEffect(() => {
    if (!isDragging) return
    const handleMouseMove = (e: MouseEvent) => {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      })
    }
    const handleMouseUp = () => {
      setIsDragging(false)
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, dragStart])

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY < 0 ? 0.15 : -0.15
    setScale(s => Math.min(Math.max(Number((s + delta).toFixed(2)), 0.3), 4.0))
  }

  // Copy SVG to clipboard
  const handleCopySvg = async () => {
    if (!svgElement) return
    try {
      const serializer = new XMLSerializer()
      const str = serializer.serializeToString(svgElement)
      await navigator.clipboard.writeText(str)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    } catch {
      // fallback
    }
  }

  // Sanitized SVG for fullscreen render
  const modalSvgHtml = useMemo(() => {
    if (!svgElement) return ''
    const clone = svgElement.cloneNode(true) as SVGSVGElement
    clone.style.maxWidth = 'none'
    clone.style.width = '100%'
    clone.style.height = 'auto'
    clone.style.transform = ''
    clone.style.transformOrigin = ''
    return clone.outerHTML
  }, [svgElement])

  return (
    <div className="diagram-modal-backdrop" onClick={onClose}>
      <div
        className="diagram-modal-shell"
        onClick={e => e.stopPropagation()}
      >
        {/* Header toolbar */}
        <div className="diagram-modal-header">
          <div className="diagram-modal-title">
            <Layers size={18} className="text-emerald-500" />
            <span>{title}</span>
            <span className="diagram-modal-badge">Fullscreen View</span>
          </div>

          <div className="diagram-modal-actions">
            {/* Zoom controls */}
            <div className="diagram-btn-group">
              <button
                type="button"
                className="diagram-tool-btn"
                onClick={handleZoomOut}
                title="Zoom Out (-)"
              >
                <ZoomOut size={15} />
              </button>
              <span className="diagram-zoom-indicator">{Math.round(scale * 100)}%</span>
              <button
                type="button"
                className="diagram-tool-btn"
                onClick={handleZoomIn}
                title="Zoom In (+)"
              >
                <ZoomIn size={15} />
              </button>
              <button
                type="button"
                className="diagram-tool-btn"
                onClick={handleReset}
                title="Reset View (0)"
              >
                <RotateCcw size={15} />
              </button>
            </div>

            <div className="diagram-tool-divider" />

            {/* Download controls */}
            {svgElement && (
              <button
                type="button"
                className="diagram-action-btn"
                onClick={() => downloadSvg(svgElement, `codesense-diagram-${Date.now()}.svg`)}
                title="Download crisp Vector SVG"
              >
                <FileCode size={15} />
                <span>SVG</span>
              </button>
            )}

            {svgElement ? (
              <button
                type="button"
                className="diagram-action-btn diagram-action-primary"
                onClick={() => downloadPng(svgElement, `codesense-diagram-${Date.now()}.png`, 2)}
                title="Download high-resolution PNG image"
              >
                <Download size={15} />
                <span>Save PNG</span>
              </button>
            ) : imageSrc ? (
              <a
                href={imageSrc}
                download={`codesense-image-${Date.now()}.png`}
                className="diagram-action-btn diagram-action-primary"
                title="Download image"
              >
                <Download size={15} />
                <span>Download</span>
              </a>
            ) : null}

            {svgElement && (
              <button
                type="button"
                className="diagram-action-btn"
                onClick={handleCopySvg}
                title="Copy SVG to clipboard"
              >
                {copySuccess ? <Check size={15} className="text-emerald-500" /> : <Layers size={15} />}
                <span>{copySuccess ? 'Copied' : 'Copy'}</span>
              </button>
            )}

            <div className="diagram-tool-divider" />

            {/* Close */}
            <button
              type="button"
              className="diagram-close-btn"
              onClick={onClose}
              title="Close Fullscreen (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Viewport canvas */}
        <div
          ref={containerRef}
          className={`diagram-modal-canvas ${isDragging ? 'is-dragging' : ''}`}
          onMouseDown={handleMouseDown}
          onWheel={handleWheel}
        >
          <div
            className="diagram-modal-viewport"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            }}
          >
            {svgElement ? (
              <div
                style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
                dangerouslySetInnerHTML={{ __html: modalSvgHtml }}
              />
            ) : imageSrc ? (
              <img
                src={imageSrc}
                alt={title}
                style={{ maxWidth: '90vw', maxHeight: '80vh', objectFit: 'contain', pointerEvents: 'none' }}
              />
            ) : null}
          </div>
        </div>

        {/* Footer tip bar */}
        <div className="diagram-modal-footer">
          <span>💡 Click and drag to pan canvas</span>
          <span>·</span>
          <span>Scroll mouse wheel to zoom</span>
          <span>·</span>
          <span>Press <strong>+</strong> / <strong>-</strong> to zoom</span>
          <span>·</span>
          <span>Press <strong>0</strong> to reset</span>
          <span>·</span>
          <span>Press <strong>Esc</strong> to close</span>
        </div>
      </div>
    </div>
  )
}

// ── Inline Interactive Diagram Controls (Attached to each .mermaid-wrap) ─────

function InlineDiagramToolbar({
  wrap,
  onOpenFullscreen,
}: {
  wrap: HTMLElement
  onOpenFullscreen: (svg: SVGSVGElement, title: string) => void
}) {
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [svgEl, setSvgEl] = useState<SVGSVGElement | null>(() => wrap.querySelector('svg'))

  // Detect heading before this wrap to use as title
  const diagramTitle = useMemo(() => {
    let prev = wrap.previousElementSibling
    while (prev) {
      if (prev.tagName.match(/^H[1-6]$/)) {
        return prev.textContent?.trim() || 'Architecture Diagram'
      }
      prev = prev.previousElementSibling
    }
    return 'System Architecture Diagram'
  }, [wrap])

  // Locate the rendered SVG if not found synchronously
  useEffect(() => {
    if (!svgEl) {
      const svg = wrap.querySelector('svg')
      if (svg) setSvgEl(svg)
    }
  }, [wrap, svgEl])

  // Apply transform to the .mermaid container
  useEffect(() => {
    const mermaidDiv = wrap.querySelector('.mermaid') as HTMLElement | null
    if (mermaidDiv) {
      mermaidDiv.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${scale})`
      mermaidDiv.style.transformOrigin = 'center center'
      mermaidDiv.style.transition = isDragging ? 'none' : 'transform 0.12s ease-out'
    }
  }, [wrap, scale, pan, isDragging])

  const handleZoomIn = () => setScale(s => Math.min(Number((s + 0.25).toFixed(2)), 3.0))
  const handleZoomOut = () => setScale(s => Math.max(Number((s - 0.25).toFixed(2)), 0.5))
  const handleReset = () => {
    setScale(1)
    setPan({ x: 0, y: 0 })
  }

  // Pan handlers with window listener
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    setIsDragging(true)
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
  }

  useEffect(() => {
    if (!isDragging) return
    const handleMouseMove = (e: MouseEvent) => {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      })
    }
    const handleMouseUp = () => {
      setIsDragging(false)
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, dragStart])

  // Ctrl+Wheel or Meta+Wheel zooms, otherwise lets standard page scroll
  const handleWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    const delta = e.deltaY < 0 ? 0.15 : -0.15
    setScale(s => Math.min(Math.max(Number((s + delta).toFixed(2)), 0.5), 3.0))
  }

  if (!svgEl) return null

  return (
    <div className="diagram-interactive-overlay">
      {/* Top Floating Action Bar */}
      <div className="diagram-top-toolbar" onClick={e => e.stopPropagation()}>
        <div className="diagram-type-tag" title={diagramTitle}>
          <Layers size={13} className="text-emerald-500" />
          <span>{diagramTitle.length > 28 ? `${diagramTitle.slice(0, 26)}…` : diagramTitle}</span>
        </div>

        <div className="diagram-inline-actions">
          {/* Zoom controls */}
          <button
            type="button"
            className="diagram-btn-sm"
            onClick={handleZoomOut}
            title="Zoom Out (-)"
          >
            <ZoomOut size={13} />
          </button>
          <span className="diagram-zoom-pill">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            className="diagram-btn-sm"
            onClick={handleZoomIn}
            title="Zoom In (+)"
          >
            <ZoomIn size={13} />
          </button>
          <button
            type="button"
            className="diagram-btn-sm"
            onClick={handleReset}
            title="Reset Zoom (1:1)"
          >
            <RotateCcw size={13} />
          </button>

          <div className="diagram-mini-divider" />

          {/* Fullscreen */}
          <button
            type="button"
            className="diagram-btn-sm"
            onClick={() => onOpenFullscreen(svgEl, diagramTitle)}
            title="Open in Fullscreen Modal"
          >
            <Maximize2 size={13} />
          </button>

          {/* Download SVG */}
          <button
            type="button"
            className="diagram-btn-sm"
            onClick={() => downloadSvg(svgEl, `${diagramTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}.svg`)}
            title="Download Vector SVG"
          >
            <FileCode size={13} />
          </button>

          {/* Download PNG */}
          <button
            type="button"
            className="diagram-btn-sm diagram-btn-highlight"
            onClick={() => downloadPng(svgEl, `${diagramTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}.png`, 2)}
            title="Download High-Res PNG Image"
          >
            <Download size={13} />
            <span>Save</span>
          </button>
        </div>
      </div>

      {/* Transparent Pan Drag Catcher Layer */}
      <div
        className={`diagram-drag-layer ${isDragging ? 'is-dragging' : ''}`}
        onMouseDown={handleMouseDown}
        onWheel={handleWheel}
        onDoubleClick={handleReset}
        title="Click and drag to pan diagram · Double-click to reset · Ctrl+Wheel to zoom"
      />
    </div>
  )
}

// ── Main Document Component ──────────────────────────────────────────────────

export function MermaidDoc({
  html,
  id,
  className = 'markdown-body',
}: {
  html: string
  id: string
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [wraps, setWraps] = useState<HTMLElement[]>([])
  const [fullscreenData, setFullscreenData] = useState<{
    svg: SVGSVGElement | null
    img: string | null
    title: string
  } | null>(null)

  useEffect(() => {
    if (!ref.current) return
    ref.current.innerHTML = html
    const nodes = ref.current.querySelectorAll<HTMLElement>('.mermaid')
    if (!nodes.length) {
      setWraps([])
      return
    }

    nodes.forEach((el, i) => {
      el.id = `${id}-${i}`
      el.dataset.src = el.textContent || ''
    })

    getMermaid().then(m => {
      if (!m) return

      const cleanupErrors = () => {
        nodes.forEach(el => {
          const hasError =
            !el.querySelector('svg') ||
            (el.textContent && el.textContent.includes('Syntax error in text')) ||
            Boolean(el.querySelector('.error-icon, .error-text, [id^="d"]'))
          if (hasError) {
            const original = el.dataset.src || el.textContent || ''
            el.innerHTML = `<div class="mermaid-error" style="padding:16px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:8px;margin:12px 0;">
              <div style="font-weight:700;margin-bottom:6px;color:#f87171">⚠️ Diagram Rendering Notice</div>
              <div style="font-size:0.85rem;color:var(--muted-foreground)">The AI-generated diagram could not be rendered visually due to a syntax issue. You can inspect the source below:</div>
              <details style="margin-top:8px;font-size:0.75rem">
                <summary style="cursor:pointer;color:var(--primary);font-weight:600">Show diagram source code</summary>
                <pre style="margin-top:6px;padding:8px;background:#0d1117;color:#e6edf3;border-radius:6px;overflow-x:auto">${original}</pre>
              </details>
            </div>`
          }
        })
        if (ref.current) {
          const wrapNodes = Array.from(
            ref.current.querySelectorAll<HTMLElement>('.mermaid-wrap')
          )
          setWraps(wrapNodes)
        }
      }

      m.run({ nodes: Array.from(nodes), suppressErrors: true })
        .then(() => {
          cleanupErrors()
        })
        .catch(err => {
          console.error('Mermaid rendering error:', err)
          cleanupErrors()
        })
    })
  }, [html, id])

  return (
    <>
      <div ref={ref} className={className} />

      {/* Portal interactive toolbars into each .mermaid-wrap */}
      {wraps.map((wrap, idx) =>
        createPortal(
          <InlineDiagramToolbar
            key={idx}
            wrap={wrap}
            onOpenFullscreen={(svg, title) =>
              setFullscreenData({ svg, img: null, title })
            }
          />,
          wrap
        )
      )}

      {/* Fullscreen Lightbox Modal */}
      {fullscreenData &&
        createPortal(
          <DiagramFullscreenModal
            svgElement={fullscreenData.svg}
            imageSrc={fullscreenData.img}
            title={fullscreenData.title}
            onClose={() => setFullscreenData(null)}
          />,
          document.body
        )}
    </>
  )
}

export default MermaidDoc
