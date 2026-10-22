# CodeSense — Developer Run Guide
> AI-powered code review platform by **Lokesh**

---

## Prerequisites

Make sure these are installed before running:

- [Node.js](https://nodejs.org) v18+
- [Python 3.10+](https://python.org) with `pip`
- [Ollama](https://ollama.ai) running locally with `qwen2.5:3b` pulled
- [Git](https://git-scm.com)

---

## One-Time Setup

### 1. Clone & enter the project
```bash
cd codesense
```

### 2. Create Python virtual environment
```bash
python -m venv .venv
```

### 3. Activate virtual environment (Windows)
```bash
.venv\Scripts\activate
```

### 4. Install Python dependencies
```bash
pip install -e .
```

### 5. Install backend Node dependencies
```bash
cd backend
npm install
cd ..
```

### 6. Install frontend Node dependencies
```bash
cd frontend
npm install
cd ..
```

### 7. Pull the AI model in Ollama
```bash
ollama pull qwen2.5:3b
```

---

## Configuration

Edit `backend/.env` to change any settings:

```env
# ── LLM (AI Model) ──────────────────────────────────────────────────────────
LLM_API_TYPE=openai
LLM_API_BASE=http://localhost:11434/v1   # Ollama local URL
LLM_API_KEY=ollama                        # "ollama" for local, real key for cloud
MODEL=qwen2.5:3b                          # Change to gpt-4o-mini for OpenAI

# ── MongoDB Database ─────────────────────────────────────────────────────────
MONGODB_URI=mongodb+srv://<username>:<password>@codesense.pxl0oqe.mongodb.net/codesense?appName=CodeSense

# ── Auth ─────────────────────────────────────────────────────────────────────
JWT_SECRET=your-codesense-jwt-secret-key
ADMIN_EMAIL=admin@codesense.dev   # First signup with this email = admin role

# ── Google OAuth 2.0 (Continue with Google) ──────────────────────────────────
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:5173/api/auth/google/callback

# ── Email Service (Verification PIN / OTP Delivery) ──────────────────────────
# Leave blank for local development (PIN will be logged to the server console)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USERNAME=your_email@gmail.com
EMAIL_PASSWORD=your_email_app_password
EMAIL_FROM="CodeSense <no-reply@codesense.dev>"
EMAIL_SECURE=false
```

---

## Running the Project

### Terminal 1 — Backend (port 4000)
```bash
# From project root
call .venv\Scripts\activate.bat && node backend\server.js
```

### Terminal 2 — Frontend (port 5173)
```bash
# From project root
cd frontend
npm run dev
```
### Terminal 3 - Python AI Service
 <!-- From project root -->
 ```bash
      start_chat_service.bat
```
Then open: **http://localhost:5173**

---

## Quick Reference — All Commands

| Action | Command |
|--------|---------|
| Start backend | `node backend\server.js` (with venv active) |
| Start frontend | `cd frontend && npm run dev` |
| Start Ollama | `ollama serve` |
| Pull AI model | `ollama pull qwen2.5:3b` |
| List Ollama models | `ollama list` |
| Install backend deps | `cd backend && npm install` |
| Install frontend deps | `cd frontend && npm install` |
| Build frontend (prod) | `cd frontend && npm run build` |
| Check backend health | `curl http://localhost:4000/api/health` |

---

## Routes & Pages

| URL | Page | Auth |
|-----|------|------|
| `/` | Review tool (main page) | Optional |
| `/login` | Sign in (Email/Password or Continue with Google) | — |
| `/signup` or `/register` | Create account (Password confirmation + Google) | — |
| `/verify-email` | 6-digit OTP email verification with countdown & resend | Pending |
| `/history` | Your review history | Required |
| `/admin` | Admin panel | Admin only |
| `/chat/:reviewId` | AI Chat & RAG Assistant | Required |

---

## First Admin Account

Register at `/signup` with the email set in `ADMIN_EMAIL` (default: `admin@codesense.dev`).
That account automatically gets the **admin** role and can access `/admin`.

---

## Switching to a Cloud AI (faster reviews)

Edit `backend/.env`:

```env
# OpenAI
LLM_API_TYPE=openai
LLM_API_BASE=https://api.openai.com/v1
LLM_API_KEY=sk-your-openai-key
MODEL=gpt-4o-mini

# OR Groq (free, very fast)
LLM_API_TYPE=openai
LLM_API_BASE=https://api.groq.com/openai/v1
LLM_API_KEY=gsk_your-groq-key
MODEL=llama-3.3-70b-versatile
```

Then restart the backend. Cloud APIs are ~3x faster than local Ollama.

---

## Project Structure

```
codesense/
├── backend/
│   ├── server.js              # Node.js API server (port 4000)
│   ├── db.js                  # MongoDB / Mongoose models & connection
│   ├── generate_review_doc.py # Python LLM architectural review engine
│   ├── chat_service.py        # Python FastAPI RAG AI chat service (port 8000)
│   ├── .env                   # Environment configuration (LLM, DB, Auth)
│   └── .env.example           # Configuration template
├── frontend/
│   ├── src/
│   │   ├── App.tsx            # Routes, navigation, theme & command palette
│   │   ├── AuthContext.tsx    # JWT authentication state & session management
│   │   ├── ThemeContext.tsx   # Dark/Light theme provider
│   │   ├── components/        # UI components (CommandPalette, ThemeToggle, etc.)
│   │   └── pages/
│   │       ├── ReviewPage.tsx # Core review, metrics, and report view
│   │       ├── ChatPage.tsx   # Interactive AI code review assistant
│   │       ├── HistoryPage.tsx# Past reviews and report access
│   │       ├── LoginPage.tsx  # Sign in
│   │       ├── SignupPage.tsx # Registration
│   │       └── AdminPage.tsx  # System administration & stats
│   └── package.json
├── start_chat_service.bat     # Windows startup script for AI chat service
├── Makefile                   # Service startup & build shortcuts
├── pyproject.toml             # Python environment and dependencies
├── LICENSE                    # MIT License
└── README.md                  # Project overview & documentation
```
