"""
CodeSense AI Chat Service — FastAPI + ChromaDB + Ollama RAG
Runs on port 8000. Called by the Node.js backend.

Architecture:
  POST /chat/index          — chunk & embed a review into ChromaDB
  POST /chat/ask            — RAG query: retrieve chunks → LLM → answer
  GET  /chat/sessions       — list sessions for a review
  DELETE /chat/index/:rid   — remove a review's knowledge base
  GET  /health              — liveness check
"""

import os, re, sys, json, uuid, time, logging
from pathlib import Path
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# ── Load .env from backend directory ─────────────────────────────────────────
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env", override=True)

# ── ChromaDB ──────────────────────────────────────────────────────────────────
os.environ["ANONYMIZED_TELEMETRY"] = "False"
try:
    import posthog
    posthog.capture = lambda *args, **kwargs: None
except ImportError:
    pass
import chromadb
from chromadb.utils import embedding_functions

# ── Ollama (via requests — no LangChain overhead) ────────────────────────────
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("chat_service")

# ── Config ────────────────────────────────────────────────────────────────────
OLLAMA_BASE   = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
CHAT_MODEL    = os.getenv("CHAT_MODEL",  os.getenv("MODEL", "qwen2.5:3b"))
EMBED_MODEL   = os.getenv("EMBED_MODEL", "nomic-embed-text")   # fast embedding model
CHROMA_DIR    = os.getenv("CHROMA_DIR",  str(Path(__file__).parent / "chroma_db"))
CHUNK_SIZE    = int(os.getenv("CHUNK_SIZE",  "600"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "100"))
TOP_K         = int(os.getenv("TOP_K", "5"))
MAX_HISTORY   = int(os.getenv("MAX_HISTORY", "6"))    # message pairs kept for memory
LLM_API_BASE  = os.getenv("LLM_API_BASE", "")
LLM_API_KEY   = os.getenv("LLM_API_KEY", "")
IS_CLOUD_LLM  = bool(LLM_API_BASE and not ("localhost" in LLM_API_BASE or "127.0.0.1" in LLM_API_BASE))
LLM_TIMEOUT   = int(os.getenv("CHAT_LLM_TIMEOUT", "600"))

# In-memory session store  { session_id: [{"role":"user"|"assistant", "content":"..."}] }
SESSIONS: dict[str, list[dict]] = {}

# ── ChromaDB client (persistent) ──────────────────────────────────────────────
Path(CHROMA_DIR).mkdir(parents=True, exist_ok=True)
chroma_client = chromadb.PersistentClient(path=CHROMA_DIR)


# ── Embedding function (calls Ollama /api/embeddings) ─────────────────────────
class OllamaEmbeddingFunction(embedding_functions.EmbeddingFunction):
    """Wraps Ollama's embedding endpoint for ChromaDB."""
    def __call__(self, input: list[str]) -> list[list[float]]:
        results = []
        for text in input:
            try:
                r = requests.post(
                    f"{OLLAMA_BASE}/api/embeddings",
                    json={"model": EMBED_MODEL, "prompt": text},
                    timeout=3,
                )
                r.raise_for_status()
                results.append(r.json()["embedding"])
            except Exception:
                # Fast fallback to zero vector if Ollama is not running
                results.append([0.0] * 768)
        return results


embed_fn = OllamaEmbeddingFunction()


# ── Chunking ───────────────────────────────────────────────────────────────────
def chunk_markdown(text: str) -> list[dict]:
    """
    Split markdown into semantic chunks.
    Tries to split on headings first, then falls back to sliding window.
    Each chunk has {text, heading, chunk_id}.
    """
    chunks = []

    # Split on markdown headings (##, ###, etc.)
    sections = re.split(r'(?=^#{1,4} .+$)', text, flags=re.MULTILINE)
    sections = [s.strip() for s in sections if s.strip()]

    for sec in sections:
        lines = sec.splitlines()
        heading = lines[0] if lines and lines[0].startswith("#") else "General"
        heading = re.sub(r'^#+\s*', '', heading).strip()

        # If section fits in one chunk
        if len(sec) <= CHUNK_SIZE:
            chunks.append({"text": sec, "heading": heading})
            continue

        # Sliding window within large sections
        words = sec.split()
        i = 0
        while i < len(words):
            slice_words = words[i: i + CHUNK_SIZE // 5]  # ~5 chars/word avg
            chunk_text  = " ".join(slice_words)
            chunks.append({"text": chunk_text, "heading": heading})
            i += max(1, (CHUNK_SIZE - CHUNK_OVERLAP) // 5)

    # Assign IDs
    for idx, c in enumerate(chunks):
        c["chunk_id"] = f"chunk_{idx}"

    return chunks


REVIEWS_CACHE_DIR = Path(__file__).parent / "reviews_cache"
REVIEWS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
REVIEWS_TEXT_CACHE: dict[str, str] = {}

def save_review_text(review_id: str, markdown: str):
    REVIEWS_TEXT_CACHE[review_id] = markdown
    try:
        (REVIEWS_CACHE_DIR / f"{review_id[:32]}.md").write_text(markdown, encoding="utf-8")
    except Exception:
        pass

def load_review_text(review_id: str) -> str:
    if review_id in REVIEWS_TEXT_CACHE:
        return REVIEWS_TEXT_CACHE[review_id]
    p = REVIEWS_CACHE_DIR / f"{review_id[:32]}.md"
    if p.exists():
        try:
            txt = p.read_text(encoding="utf-8")
            REVIEWS_TEXT_CACHE[review_id] = txt
            return txt
        except Exception:
            pass
    return ""

def keyword_retrieve(markdown: str, question: str, top_k: int = TOP_K) -> list[dict]:
    """Fast, reliable keyword relevance retrieval across markdown chunks."""
    chunks = chunk_markdown(markdown)
    if not chunks:
        return []
    words = re.findall(r'\w+', question.lower())
    stop_words = {"the","a","an","is","are","was","were","in","on","at","to","for","of","and","or","it","this","that","what","how","why","can","you","tell","me","about"}
    keywords = [w for w in words if w not in stop_words and len(w) > 2]
    if not keywords:
        return chunks[:top_k]

    scored = []
    for c in chunks:
        c_text = (c.get("heading", "") + " " + c["text"]).lower()
        score = sum(1.5 if kw in c.get("heading", "").lower() else 1.0 for kw in keywords if kw in c_text)
        scored.append((score, c))

    scored.sort(key=lambda x: x[0], reverse=True)
    results = []
    for score, c in scored[:top_k]:
        results.append({
            "text": c["text"],
            "heading": c.get("heading", ""),
            "chunk_id": c.get("chunk_id", ""),
            "score": round(min(1.0, score / max(1, len(keywords))), 3),
        })
    return results

# ── Collection helper ──────────────────────────────────────────────────────────
def get_collection(review_id: str):
    """Get or create a ChromaDB collection for a review."""
    name = f"review_{review_id[:32]}"  # ChromaDB collection name limit
    return chroma_client.get_or_create_collection(
        name=name,
        embedding_function=embed_fn,
        metadata={"hnsw:space": "cosine"},
    )


# ── RAG retrieval ──────────────────────────────────────────────────────────────
def retrieve(review_id: str, question: str, top_k: int = TOP_K) -> list[dict]:
    """Retrieve top-k relevant chunks for a question with vector + keyword fallback."""
    chunks = []
    try:
        col = get_collection(review_id)
        if col.count() > 0:
            results = col.query(
                query_texts=[question],
                n_results=min(top_k, col.count()),
                include=["documents", "metadatas", "distances"],
            )
            docs      = results["documents"][0]
            metas     = results["metadatas"][0]
            distances = results["distances"][0]
            for doc, meta, dist in zip(docs, metas, distances):
                score = round(1 - dist, 3)
                if score > 0.05:  # Valid non-zero vector match
                    chunks.append({
                        "text":     doc,
                        "heading":  meta.get("heading", ""),
                        "chunk_id": meta.get("chunk_id", ""),
                        "score":    score,
                    })
    except Exception as e:
        log.error(f"Chroma retrieval error: {e}")

    # If Chroma returned nothing or returned dummy zero vectors (all distances = 1.0)
    if not chunks:
        doc_text = load_review_text(review_id)
        if doc_text:
            chunks = keyword_retrieve(doc_text, question, top_k)

    return chunks


# ── LLM call ───────────────────────────────────────────────────────────────────
def build_system_prompt(repo_name: str) -> str:
    return f"""You are CodeSense AI, an expert software engineer and architect deeply familiar with the repository "{repo_name}".

You have access to a comprehensive analysis of this project including: architecture, data models, API documentation, code quality assessment, bug reports, technology stack, folder structure, workflows, and improvement recommendations.

YOUR CAPABILITIES:
1. Answer factual questions about the code (what files exist, what APIs are defined, what models are used)
2. Explain architecture, workflows, and design decisions in simple or technical terms
3. Generate Mermaid diagrams based on the project structure (class diagrams, sequence diagrams, flowcharts, ER diagrams)
4. Suggest future features, enhancements, and technical roadmap
5. Explain code snippets line by line
6. Identify security issues, performance problems, and technical debt
7. Provide refactoring suggestions with code examples
8. Generate documentation (README sections, API docs, inline comments)
9. Explain the project to different audiences (technical, non-technical, business)
10. Create test cases and testing strategies
11. Discuss deployment, DevOps, and infrastructure options

DIAGRAM GENERATION:
When asked for diagrams, generate valid Mermaid syntax. Examples:
- "Show me a class diagram" → generate ```mermaid classDiagram ... ```
- "Show authentication flow" → generate ```mermaid sequenceDiagram ... ```
- "Show database relationships" → generate ```mermaid erDiagram ... ```
- "Show component structure" → generate ```mermaid graph TD ... ```

RULES:
- Base answers primarily on the project context provided, but use your expertise to extend beyond it for creative/analytical questions
- For factual questions (what files exist, what endpoints are defined), stick strictly to the context
- For analytical questions (future scope, improvements, explanations), use both context AND your expertise
- Always cite which section or file your answer comes from
- Format responses with markdown — use headers, bullet points, code blocks
- For code examples, use the actual language and patterns from this project
- Be direct and actionable, not vague"""


def build_rag_prompt(
    system: str,
    history: list[dict],
    context_chunks: list[dict],
    question: str,
) -> list[dict]:
    """Build the message list for Ollama chat API."""
    # Format context
    ctx_parts = []
    for c in context_chunks:
        heading = c.get("heading", "")
        text    = c["text"]
        src     = f"[{heading}]" if heading else ""
        ctx_parts.append(f"{src}\n{text}")
    context_str = "\n\n---\n\n".join(ctx_parts)

    messages = [{"role": "system", "content": system}]

    # Trim history to last MAX_HISTORY pairs
    trimmed = history[-(MAX_HISTORY * 2):]
    messages.extend(trimmed)

    # Final user message with RAG context injected
    messages.append({
        "role": "user",
        "content": (
            f"Project Context:\n```\n{context_str}\n```\n\n"
            f"Question: {question}"
        ),
    })
    return messages


def call_ollama(messages: list[dict], stream: bool = False):
    """Call either Cloud LLM (Gemini/Groq/OpenAI) or local Ollama chat API."""
    if IS_CLOUD_LLM:
        headers = {"Content-Type": "application/json"}
        if LLM_API_KEY:
            headers["Authorization"] = f"Bearer {LLM_API_KEY}"
        url = f"{LLM_API_BASE.rstrip('/')}/chat/completions"
        payload = {
            "model": CHAT_MODEL,
            "messages": messages,
            "temperature": 0.3,
            "stream": stream,
        }
        for attempt in range(1, 4):
            try:
                r = requests.post(url, json=payload, headers=headers, stream=stream, timeout=LLM_TIMEOUT)
                if r.status_code in (503, 429) and attempt < 3:
                    time.sleep(2 * attempt)
                    continue
                r.raise_for_status()
                return r
            except requests.RequestException as e:
                if attempt < 3:
                    time.sleep(2 * attempt)
                    continue
                raise e
    else:
        payload = {
            "model":    CHAT_MODEL,
            "messages": messages,
            "stream":   stream,
            "options":  {"temperature": 0.2, "num_predict": 1200},
        }
        r = requests.post(
            f"{OLLAMA_BASE}/api/chat",
            json=payload,
            stream=stream,
            timeout=LLM_TIMEOUT,
        )
        r.raise_for_status()
        return r


def stream_ollama(messages: list[dict]):
    """Generator that yields SSE-formatted text chunks for both Ollama and Cloud LLM."""
    try:
        r = call_ollama(messages, stream=True)
        full_response = []
        for line in r.iter_lines():
            if not line:
                continue
            line_str = line.decode("utf-8").strip()
            token = ""
            if IS_CLOUD_LLM:
                if line_str.startswith("data: "):
                    d_part = line_str[6:].strip()
                    if d_part == "[DONE]":
                        break
                    try:
                        data = json.loads(d_part)
                        token = data.get("choices", [{}])[0].get("delta", {}).get("content", "")
                    except Exception:
                        pass
            else:
                try:
                    data = json.loads(line_str)
                    token = data.get("message", {}).get("content", "")
                except Exception:
                    pass
            if token:
                full_response.append(token)
                yield f"data: {json.dumps({'token': token})}\n\n"
            if not IS_CLOUD_LLM and data.get("done"):
                break
        yield f"data: {json.dumps({'done': True, 'full': ''.join(full_response)})}\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'error': str(e)})}\n\n"


# ── Pydantic models ────────────────────────────────────────────────────────────
class IndexRequest(BaseModel):
    review_id:  str
    markdown:   str
    repo_name:  str = ""
    force:      bool = False   # re-index even if already exists


class AskRequest(BaseModel):
    review_id:  str
    session_id: Optional[str] = None
    question:   str
    repo_name:  str = ""
    stream:     bool = False


class AskResponse(BaseModel):
    session_id: str
    answer:     str
    sources:    list[dict]
    elapsed_ms: int


# ── App ────────────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info(f"CodeSense Chat Service starting — model={CHAT_MODEL}, embed={EMBED_MODEL}")
    log.info(f"ChromaDB path: {CHROMA_DIR}")
    yield
    log.info("Chat service shutting down")


app = FastAPI(title="CodeSense Chat Service", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "model": CHAT_MODEL, "embed": EMBED_MODEL}


@app.post("/chat/index")
def index_review(req: IndexRequest):
    """Chunk and embed a review's markdown into ChromaDB."""
    save_review_text(req.review_id, req.markdown)
    col = get_collection(req.review_id)

    # Skip if already indexed (unless forced)
    if col.count() > 0 and not req.force:
        return {"ok": True, "chunks": col.count(), "skipped": True}

    # Clear existing docs if forcing
    if req.force and col.count() > 0:
        col.delete(where={"chunk_id": {"$ne": "___nonexistent___"}})

    chunks = chunk_markdown(req.markdown)
    if not chunks:
        raise HTTPException(400, "No content to index")

    documents = [c["text"]     for c in chunks]
    metadatas = [{"heading": c["heading"], "chunk_id": c["chunk_id"]} for c in chunks]
    ids       = [f"{req.review_id[:16]}_{c['chunk_id']}" for c in chunks]

    col.add(documents=documents, metadatas=metadatas, ids=ids)
    log.info(f"Indexed {len(chunks)} chunks for review {req.review_id[:8]}")
    return {"ok": True, "chunks": len(chunks), "skipped": False}


@app.post("/chat/ask")
def ask(req: AskRequest):
    """Non-streaming RAG query."""
    session_id = req.session_id or str(uuid.uuid4())
    history    = SESSIONS.setdefault(session_id, [])

    chunks  = retrieve(req.review_id, req.question)
    system  = build_system_prompt(req.repo_name or req.review_id)
    msgs    = build_rag_prompt(system, history, chunks, req.question)

    t0 = time.time()
    try:
        r       = call_ollama(msgs, stream=False)
        data    = r.json()
        if "choices" in data and data["choices"]:
            answer = data["choices"][0]["message"]["content"]
        else:
            answer = data.get("message", {}).get("content", "")
    except Exception as e:
        raise HTTPException(500, f"LLM error: {e}")
    elapsed = int((time.time() - t0) * 1000)

    # Update memory
    history.append({"role": "user",      "content": req.question})
    history.append({"role": "assistant", "content": answer})
    SESSIONS[session_id] = history  # keep in memory

    sources = [{"heading": c["heading"], "score": c["score"]} for c in chunks]
    return AskResponse(
        session_id=session_id,
        answer=answer,
        sources=sources,
        elapsed_ms=elapsed,
    )


@app.post("/chat/ask/stream")
def ask_stream(req: AskRequest):
    """Streaming RAG query (SSE)."""
    session_id = req.session_id or str(uuid.uuid4())
    history    = SESSIONS.setdefault(session_id, [])

    chunks = retrieve(req.review_id, req.question)
    system = build_system_prompt(req.repo_name or req.review_id)
    msgs   = build_rag_prompt(system, history, chunks, req.question)

    def event_generator():
        # Send sources first
        sources = [{"heading": c["heading"], "score": c["score"]} for c in chunks]
        yield f"data: {json.dumps({'session_id': session_id, 'sources': sources})}\n\n"

        # Stream tokens
        full_text = []
        for chunk_data in stream_ollama(msgs):
            yield chunk_data
            # Collect full text from done event
            if '"done": true' in chunk_data:
                try:
                    data = json.loads(chunk_data.replace("data: ", ""))
                    full_text = [data.get("full", "")]
                except Exception:
                    pass

        # Update memory with full response
        full = "".join(full_text)
        if full:
            history.append({"role": "user",      "content": req.question})
            history.append({"role": "assistant", "content": full})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/chat/session/{session_id}")
def get_session(session_id: str):
    """Get conversation history for a session."""
    history = SESSIONS.get(session_id, [])
    return {"session_id": session_id, "messages": history}


@app.delete("/chat/session/{session_id}")
def clear_session(session_id: str):
    """Clear conversation history for a session."""
    SESSIONS.pop(session_id, None)
    return {"ok": True}


@app.delete("/chat/index/{review_id}")
def delete_index(review_id: str):
    """Delete a review's ChromaDB collection."""
    try:
        name = f"review_{review_id[:32]}"
        chroma_client.delete_collection(name)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/chat/index/{review_id}/status")
def index_status(review_id: str):
    """Check if a review has been indexed."""
    col = get_collection(review_id)
    return {"indexed": col.count() > 0, "chunks": col.count()}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)
