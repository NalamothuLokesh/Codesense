"""
CodeSense — Enterprise Review Generator (4-call sequential, project-specific, timeout-safe)
Generates a comprehensive, evidence-based, 12-section technical code review.
Includes Objective, Limitations, Future Scope, and Overall Result/Conclusion with zero hallucinations.
"""
import os, sys, json, asyncio, fnmatch, re
from pathlib import Path
from dotenv import load_dotenv

# Ensure fresh backend/.env is always loaded with top priority
load_dotenv(Path(__file__).parent / ".env", override=True)

import microcore as mc

# ── Config ────────────────────────────────────────────────────────────────────
EXCLUDE = {
    "*.pyc","*.pyo","__pycache__/*",".git/*","node_modules/*",".venv/*",
    "venv/*","dist/*","build/*","*.min.js","*.min.css","*.map","*.lock",
    "*.log","*.png","*.jpg","*.jpeg","*.gif","*.ico","*.svg","*.woff*",
    "*.ttf","*.eot","*.zip","*.tar*","*.gz","poetry.lock",
    "package-lock.json","yarn.lock","pnpm-lock.yaml",
    "reviews_cache/*","chroma_db/*","storage/*","*.sqlite","*.sqlite3","*.db",
}
HIGH = {
    "readme.md","package.json","pyproject.toml","cargo.toml","go.mod",
    "pom.xml","build.gradle","build.gradle.kts","requirements.txt",
    "dockerfile","docker-compose.yml","docker-compose.yaml",
    "schema.sql","schema.prisma","models.py","models.ts",
    "app.py","app.ts","app.tsx","app.js","main.py","main.ts","main.go",
    "index.js","index.ts","server.js","server.ts","routes.py","routes.ts",
    "urls.py","router.ts","settings.py","config.py","config.ts",
}
TEXT_EXT = {
    ".py",".js",".ts",".tsx",".jsx",".java",".go",".rs",".rb",".php",
    ".cs",".cpp",".c",".h",".html",".css",".scss",".json",".toml",
    ".yaml",".yml",".md",".txt",".sh",".sql",".graphql",".xml",".cfg",
}
MAX_FILE    = 5_000      # ~1,250 tokens per file
MAX_HI      = 10_000     # ~2,500 tokens for critical entry/model/route/manifest files
MAX_CTX     = 40_000     # ~10,000 tokens per prompt (safest sweet spot for Gemini Flash)
MAX_FILES   = 65         # Prioritized high-signal files
LLM_TIMEOUT = 420        # ~7 min timeout per call


# ── File Classification Helpers ───────────────────────────────────────────────
def excl(rel: str) -> bool:
    p = rel.replace("\\", "/").lower()
    for pat in EXCLUDE:
        if fnmatch.fnmatch(p, pat.lower()): return True
    skip = {
        "node_modules","__pycache__",".venv","venv","dist","build",".git",
        ".next",".turbo",".cache","reviews_cache","chroma_db","storage",
        ".agents",".gemini",".vscode","coverage",".nyc_output"
    }
    return any(part in skip for part in p.split("/")[:-1])

def is_model(p: str) -> bool:
    p = p.lower()
    return any(k in p for k in ("model", "schema", "entity", "entities", "prisma", "dao", "repository"))

def is_route(p: str) -> bool:
    p = p.lower()
    return any(k in p for k in ("route", "controller", "api", "endpoint", "handler", "view"))

def is_auth(p: str) -> bool:
    p = p.lower()
    return any(k in p for k in ("auth", "middleware", "jwt", "session", "security", "token", "guard", "config", "db"))

def is_service(p: str) -> bool:
    p = p.lower()
    return any(k in p for k in ("service", "util", "helper", "lib", "manager", "worker", "client"))

def is_test(p: str) -> bool:
    p = p.lower()
    return any(k in p for k in ("test", "spec", "__test__", "__tests__"))

def is_core(p: str) -> bool:
    name = Path(p).name.lower()
    return name in HIGH or any(k in name for k in ("app", "main", "server", "index", "root", "entry"))


# ── Project Context & Intelligence Extractor ──────────────────────────────────
def extract_project_context(repo_path: str, repo_url: str = "") -> dict:
    base = Path(repo_path)
    ctx_data = {
        "name": "",
        "description": "",
        "primary_languages": [],
        "language_breakdown": {},
        "frameworks": set(),
        "databases": set(),
        "auth_methods": set(),
        "dependencies": [],
        "all_files_count": 0,
        "test_files": [],
        "entry_points": [],
        "models": [],
        "routes": [],
        "auth_files": [],
        "services": [],
        "detected_signals": [],
    }

    # 1. Project name from repo_url if available
    url_name = ""
    if repo_url and repo_url.lower() != "local":
        norm_path = repo_url.replace("\\", "/").rstrip("/").split("?")[0].replace(".git", "")
        norm_path = re.sub(r'^[a-zA-Z]:', '', norm_path)
        last_seg = norm_path.strip("/").split("/")[-1].strip() if norm_path.strip("/") else ""
        last_seg = re.sub(r'[^a-zA-Z0-9_\-\.]', '', last_seg)
        last_seg_clean = re.sub(r'-(?:main|master|dev|release|stable)$', '', last_seg, flags=re.IGNORECASE)
        url_name = last_seg_clean or last_seg

    manifest_names = []
    manifest_desc = ""

    # Parse package.json (root, backend, frontend)
    for pkg_path in [base / "package.json", base / "backend" / "package.json", base / "frontend" / "package.json"]:
        if pkg_path.exists():
            try:
                data = json.loads(pkg_path.read_text(encoding="utf-8", errors="ignore"))
                p_name = data.get("name", "")
                if p_name and p_name not in ("frontend", "backend", "client", "server"):
                    if "/" in p_name: p_name = p_name.split("/")[-1]
                    manifest_names.append(p_name)
                if not manifest_desc and data.get("description"):
                    manifest_desc = data["description"]
                for dep, ver in {**data.get("dependencies", {}), **data.get("devDependencies", {})}.items():
                    ctx_data["dependencies"].append(f"{dep}@{ver}")
                    dep_l = dep.lower()
                    if "react" in dep_l: ctx_data["frameworks"].add("React")
                    if "vue" in dep_l: ctx_data["frameworks"].add("Vue")
                    if "angular" in dep_l: ctx_data["frameworks"].add("Angular")
                    if "express" in dep_l: ctx_data["frameworks"].add("Express")
                    if "fastify" in dep_l: ctx_data["frameworks"].add("Fastify")
                    if "nestjs" in dep_l: ctx_data["frameworks"].add("NestJS")
                    if "next" in dep_l: ctx_data["frameworks"].add("Next.js")
                    if "vite" in dep_l: ctx_data["frameworks"].add("Vite")
                    if "bootstrap" in dep_l: ctx_data["frameworks"].add("Bootstrap")
                    if "tailwind" in dep_l: ctx_data["frameworks"].add("TailwindCSS")
                    if "mongoose" in dep_l or "mongodb" in dep_l: ctx_data["databases"].add("MongoDB / Mongoose")
                    if "pg" in dep_l or "postgres" in dep_l: ctx_data["databases"].add("PostgreSQL")
                    if "mysql" in dep_l: ctx_data["databases"].add("MySQL")
                    if "sqlite" in dep_l: ctx_data["databases"].add("SQLite")
                    if "prisma" in dep_l: ctx_data["databases"].add("Prisma ORM")
                    if "jsonwebtoken" in dep_l or "jwt" in dep_l: ctx_data["auth_methods"].add("JWT (JSON Web Tokens)")
                    if "bcrypt" in dep_l: ctx_data["auth_methods"].add("Bcrypt Password Hashing")
                    if "passport" in dep_l: ctx_data["auth_methods"].add("Passport.js")
            except Exception:
                pass

    # Parse pyproject.toml
    pyproject = base / "pyproject.toml"
    if pyproject.exists():
        try:
            txt = pyproject.read_text(encoding="utf-8", errors="ignore")
            m_name = re.search(r'(?:\[tool\.poetry\]|\[project\])[^\[]*?name\s*=\s*["\']([^"\']+)["\']', txt, re.DOTALL)
            if m_name: manifest_names.append(m_name.group(1))
            m_desc = re.search(r'(?:\[tool\.poetry\]|\[project\])[^\[]*?description\s*=\s*["\']([^"\']+)["\']', txt, re.DOTALL)
            if m_desc and not manifest_desc: manifest_desc = m_desc.group(1)
            for dep in re.findall(r'([a-zA-Z0-9_\-]+)\s*=\s*["\'][^"\']+["\']', txt):
                dep_l = dep.lower()
                if dep_l in ("fastapi", "flask", "django", "tornado"): ctx_data["frameworks"].add(dep.capitalize())
                if dep_l in ("sqlalchemy", "tortoise", "peewee"): ctx_data["databases"].add(dep)
                if dep_l in ("torch", "tensorflow", "scikit-learn"): ctx_data["frameworks"].add("Machine Learning")
        except Exception:
            pass

    # Parse pom.xml (Java Maven)
    pom = base / "pom.xml"
    if pom.exists():
        try:
            txt = pom.read_text(encoding="utf-8", errors="ignore")
            m_art = re.search(r'<artifactId>([^<]+)</artifactId>', txt)
            if m_art: manifest_names.append(m_art.group(1))
            m_desc = re.search(r'<description>([^<]+)</description>', txt)
            if m_desc and not manifest_desc: manifest_desc = m_desc.group(1).strip()
            if "spring-boot" in txt.lower(): ctx_data["frameworks"].add("Spring Boot")
            if "security" in txt.lower(): ctx_data["auth_methods"].add("Spring Security")
            if "jpa" in txt.lower() or "hibernate" in txt.lower(): ctx_data["databases"].add("Spring Data JPA / Hibernate")
            if "postgresql" in txt.lower(): ctx_data["databases"].add("PostgreSQL")
            if "mysql" in txt.lower(): ctx_data["databases"].add("MySQL")
        except Exception:
            pass

    # Parse go.mod
    gomod = base / "go.mod"
    if gomod.exists():
        try:
            txt = gomod.read_text(encoding="utf-8", errors="ignore")
            m_mod = re.search(r'^module\s+([^\s]+)', txt, re.MULTILINE)
            if m_mod: manifest_names.append(m_mod.group(1).split("/")[-1])
        except Exception:
            pass

    # Parse Cargo.toml (Rust)
    cargo = base / "Cargo.toml"
    if cargo.exists():
        try:
            txt = cargo.read_text(encoding="utf-8", errors="ignore")
            m_name = re.search(r'\[package\][^\[]*?name\s*=\s*["\']([^"\']+)["\']', txt, re.DOTALL)
            if m_name: manifest_names.append(m_name.group(1))
        except Exception:
            pass

    # Select project name
    manifest_project_name = ""
    if manifest_names:
        clean_names = [n for n in manifest_names if not n.endswith("-backend") and not n.endswith("-frontend") and n.lower() not in ("src", "app", "root", "client", "server")]
        if clean_names:
            manifest_project_name = clean_names[0]
        elif manifest_names:
            manifest_project_name = manifest_names[0].replace("-frontend", "").replace("-backend", "")

    if manifest_project_name.lower() == "codesense":
        manifest_project_name = "CodeSense"

    if manifest_project_name == "CodeSense" or url_name.lower() in ("gito", "gito-main", "egito", "egito-main"):
        ctx_data["name"] = "CodeSense"
    elif url_name and url_name.lower() not in ("local", "main", "master", "repo", "src"):
        ctx_data["name"] = url_name
    elif manifest_project_name:
        ctx_data["name"] = manifest_project_name
    else:
        ctx_data["name"] = base.name

    # Check README for description
    readme_desc = ""
    for r in [base / "README.md", base / "readme.md", base / "README"]:
        if r.exists():
            try:
                txt = r.read_text(encoding="utf-8", errors="ignore")
                lines = [l.strip() for l in txt.splitlines() if l.strip()]
                for l in lines[1:15]:
                    if l.startswith("#") or l.startswith("[![") or l.startswith("<") or l.startswith("```"):
                        continue
                    clean = re.sub(r'[*_`>#]', '', l).strip()
                    if len(clean) > 25 and not clean.startswith("http"):
                        readme_desc = clean
                        break
                if readme_desc: break
            except Exception:
                pass

    ctx_data["description"] = manifest_desc or readme_desc or f"{ctx_data['name']} software project"
    return ctx_data


# ── Intelligent File Collector ────────────────────────────────────────────────
def collect_repo_files(repo_path: str):
    base = Path(repo_path)
    all_discovered = []

    for root, dirs, files in os.walk(base):
        dirs[:] = sorted([d for d in dirs if not d.startswith(".") and
                          d not in {
                              "node_modules","__pycache__",".venv","venv","dist",
                              "build",".git",".next",".turbo",".cache",
                              "reviews_cache","chroma_db","storage","coverage",
                              ".agents",".gemini",".vscode"
                          }])
        for fname in sorted(files):
            full = Path(root) / fname
            rel  = str(full.relative_to(base)).replace("\\", "/")
            if excl(rel): continue
            ext  = full.suffix.lower()
            is_hi = (fname.lower() in HIGH or is_model(rel) or is_route(rel) or is_auth(rel) or is_core(rel))
            if ext not in TEXT_EXT and not is_hi and full.name not in ("Dockerfile","Makefile"): continue
            all_discovered.append((rel, full, ext, is_hi))

    # Priority sorting: Manifests & README -> Core -> Models -> Routes -> Auth -> Services -> Tests -> Others
    def file_priority(item):
        rel, full, ext, is_hi = item
        fname = full.name.lower()
        if fname in ("readme.md", "package.json", "pom.xml", "pyproject.toml", "cargo.toml", "go.mod"): return 0
        if is_core(rel): return 1
        if is_model(rel): return 2
        if is_route(rel): return 3
        if is_auth(rel): return 4
        if is_service(rel): return 5
        if is_test(rel): return 6
        return 7

    all_discovered.sort(key=file_priority)

    collected = []
    total = 0
    for rel, full, ext, is_hi in all_discovered:
        if total >= MAX_FILES: break
        try:
            content = full.read_text(encoding="utf-8", errors="ignore")
        except:
            continue
        if not content.strip(): continue
        content = "\n".join(l.rstrip() for l in content.splitlines() if l.strip())
        lim = MAX_HI if is_hi else MAX_FILE
        if len(content) > lim:
            content = content[:lim] + "\n\n// [NOTE: Remaining lines of this file omitted for review prompt compactness - NOT a code defect]"
        collected.append({"path": rel, "content": content})
        total += 1

    return collected, len(all_discovered)


# ── Static Code Signal Heuristics ─────────────────────────────────────────────
def detect_static_signals(files: list[dict]) -> list[dict]:
    signals = []
    patterns = [
        ("Hardcoded JWT/Secret Fallback", r"(?:JWT_SECRET|SECRET_KEY|API_KEY|PASSWORD|TOKEN)\s*\|\|\s*['\"]([^'\"]{4,})['\"]", "High", "Fallback secret string used if environment variable is missing; vulnerable to token forgery in production"),
        ("Wildcard CORS Origin", r"(?:origin\s*:\s*['\"]\*['\"]|Access-Control-Allow-Origin['\"]\s*:\s*['\"]\*['\"])", "Medium", "Permissive wildcard CORS origin ('*') allows arbitrary domains to execute cross-origin requests"),
        ("Token Stored in LocalStorage", r"localStorage\.(?:setItem|getItem)\(['\"](?:token|jwt|auth)", "Medium", "Authentication tokens stored in localStorage are vulnerable to token theft via Cross-Site Scripting (XSS)"),
        ("Hardcoded DNS Overrides", r"dns\.setServers\(", "Medium", "Hardcoded DNS resolver bypasses host network configuration and fails behind strict corporate firewalls"),
        ("Synchronous File I/O in Server", r"fs\.(?:readFileSync|writeFileSync)\(", "Low", "Synchronous filesystem operations block the Node.js event loop during active request handling"),
        ("Empty Exception Catch", r"(?:catch\s*\([^)]*\)\s*\{\s*\}|except(?:\s+\w+)?:\s*\n\s*pass)", "Low", "Empty error catch block silently swallows exceptions, obscuring runtime failures"),
        ("Disabled SSL/TLS Certificate Verification", r"(?:rejectUnauthorized\s*:\s*false|verify\s*=\s*False)", "High", "TLS certificate validation disabled, leaving connections open to Man-in-the-Middle (MITM) attacks"),
    ]

    for f in files:
        rel = f["path"]
        if is_test(rel): continue
        for line_no, line in enumerate(f["content"].splitlines(), start=1):
            if "[NOTE: Remaining lines" in line: continue
            for rule_name, pat, sev, desc in patterns:
                if re.search(pat, line):
                    signals.append({
                        "file": rel,
                        "line": line_no,
                        "rule": rule_name,
                        "severity": sev,
                        "description": desc,
                        "snippet": line.strip()[:100]
                    })
    return signals


def file_tree(files):
    paths = sorted(f["path"] for f in files)
    lines, seen = [], set()
    for p in paths:
        parts = p.split("/")
        for i in range(len(parts) - 1):
            d = "/".join(parts[:i+1])
            if d not in seen:
                seen.add(d); lines.append("  "*i + f"├── {parts[i]}/")
        lines.append("  "*(len(parts)-1) + f"├── {parts[-1]}")
    return "\n".join(lines)


def pack(files, budget):
    out, used = "", 0
    seen = set()
    for f in files:
        if f["path"] in seen: continue
        seen.add(f["path"])
        b = f"\n### {f['path']}\n```\n{f['content']}\n```"
        if used + len(b) > budget: break
        out += b; used += len(b)
    return out


def make_context(repo_url: str, meta: dict, ftree: str, code: str, findings_summary: str = "", part_scope: str = "") -> str:
    dep_sample = ", ".join(meta["dependencies"][:12]) if meta["dependencies"] else "None explicitly listed"
    fw_sample  = ", ".join(meta["frameworks"]) if meta["frameworks"] else "Standard runtime"
    db_sample  = ", ".join(meta["databases"]) if meta["databases"] else "None detected"
    auth_sample= ", ".join(meta["auth_methods"]) if meta["auth_methods"] else "None detected"

    test_info = (
        f"Automated test files present ({len(meta['test_files'])} test files detected: {', '.join(meta['test_files'][:4])})"
        if meta["test_files"] else
        "No automated test files or test suites detected in the repository."
    )

    signals_block = ""
    if meta.get("detected_signals"):
        signals_block = "\nDETECTED CODE SIGNALS & ANOMALIES (Use these as verified facts):\n"
        for s in meta["detected_signals"][:8]:
            signals_block += f"- [{s['severity']}] {s['file']}:{s['line']} - {s['rule']}: `{s['snippet']}` ({s['description']})\n"

    findings_block = ""
    if findings_summary:
        findings_block = f"\nPRIOR ANALYSIS FINDINGS SUMMARY (Sections 7-8):\n{findings_summary}\n"

    scope_block = f"\nTARGET CALL SCOPE: {part_scope}\n" if part_scope else ""

    return f"""You are a Principal Software Architect writing a formal, project-specific technical review.
TARGET PROJECT: {meta['name']}
REPOSITORY URL: {repo_url}
PROJECT DESCRIPTION: {meta['description']}
PRIMARY FRAMEWORKS & RUNTIME: {fw_sample}
DATABASES / DATA LAYER: {db_sample}
AUTHENTICATION MECHANISMS: {auth_sample}
KEY DEPENDENCIES: {dep_sample}
TEST SUITE STATUS: {test_info}
{signals_block}{findings_block}{scope_block}
STRICT GUIDELINES:
1. Refer to '{meta['name']}' by name throughout the report (never just 'the application' or 'the project').
2. Every statement, table row, and recommendation must be 100% grounded in the real code, files, classes, and findings provided below.
3. DO NOT invent technologies, APIs, features, tests, or vulnerabilities not supported by the evidence.
4. If information is absent (e.g. no automated tests), explicitly state that limitation rather than inventing metrics.
5. In markdown tables, NEVER use unescaped pipe characters '|' or '||' (use 'OR' or escape as '\\|') to prevent table column breakage.
6. Note: Any comments containing '[NOTE: Remaining lines... omitted]' are review prompt truncation markers, NOT code defects.
7. CRITICAL MODULAR SCOPE: Output ONLY the specific numbered sections requested for this call. Do NOT output a document title header (e.g. '# Software Analysis Report' or '# Technical Review'), table of contents, introduction, or sections belonging to other parts. Begin immediately with the first requested section header.

FILE TREE:
{ftree}

SOURCE CODE:
{code}
---
"""


# ══════════════════════════════════════════════════════════════
# CALL 1 — Executive Summary, Project Objective & Tech Stack (Sections 1–3)
# ══════════════════════════════════════════════════════════════
P1 = """Analyze this repository and output ONLY Sections 1, 2, and 3 of the technical review report.
CRITICAL INSTRUCTIONS FOR CALL 1:
- Do NOT include any document title header (no '# Technical Review' or '# Architectural Review'). Begin directly with '# 1. Executive Summary & Health Verdict'.
- Do NOT output Sections 4 through 12.
- STRICT PROHIBITION: Do NOT generate any Architecture Flow Diagram, Use Case Diagram, Actor Matrix, or Core System Components table in this call. Those belong strictly to Section 4 in Call 2.
- For 'Integration Highlights' in Section 3, output ONLY 2-3 sentences of prose text. Do NOT emit any Mermaid code blocks (```mermaid) or subheadings.

# 1. Executive Summary & Health Verdict

Provide an executive technical overview specifically tailored to this project:
- **Core Purpose & Domain**: 2-3 sentences explaining exactly what this application does, its real-world problem domain, and who it is built for.
- **Architectural Approach**: High-level structural pattern (e.g. Full-Stack SPA with Express REST API, Layered Monolith, Microservices, MVC).

### Project Health Scorecard
| Metric | Rating | Assessment |
|---|---|---|
| Overall Code Quality | 8.0/10 | Evaluation of structure, naming, and readability in this specific codebase |
| Architecture & Modularity | Good / Moderate / Needs Improvement | Evaluation of separation of concerns between layers |
| Security Posture | Strong / Moderate / Critical Risks | Current state of authentication, tokens, secrets, and validations |
| Primary Technical Risk | Manageable / High / Moderate | The most notable vulnerability or architectural debt found |

---

# 2. Project Objective & Functional Scope

Provide a thorough, project-specific objective explaining what this application is intended to accomplish:
*(CRITICAL: DO NOT use generic filler such as 'The objective of this review is to analyze code and find issues.' That is NOT the objective. The objective must describe what THIS software project itself is built to achieve).*

- **Primary Mission & Problem Domain**: Explain the concrete business/user problem this application addresses.
- **Target Stakeholders & User Personas**: Who this system is built for (e.g. students, faculty, administrators, end users, or external clients).
- **Core Functional Pillars**: Detail 3 to 5 major capabilities implemented in the codebase (e.g. file parsing, data calculation, session tracking, report generation).
- **Technical Implementation Goals**: What the technical implementation strives to achieve (e.g. offline fallback resilience, low-latency API response, schema validation).
- **Review Evaluation Scope**: The key architectural, security, data integrity, and maintainability aspects evaluated during this review.

---

# 3. Technology Stack & Key Integrations

Identify the real technologies and libraries actually used in this codebase:

| Category | Technology | Detected Version | Primary Responsibility in This Project | Source File |
|---|---|---|---|---|
(List 6 to 12 actual dependencies and tools found in package.json, pyproject.toml, pom.xml, or source imports)

**Integration Highlights**:
Explain in 2-3 sentences how the client, server, database, and background services communicate and integrate in this specific project. (Prose text only - no diagrams or subheadings).

---
"""

# ══════════════════════════════════════════════════════════════
# CALL 2 — Architecture, Database Models & API Surface (Sections 4–6)
# ══════════════════════════════════════════════════════════════
P2 = """Analyze the architecture, database models, and route definitions in the codebase and output ONLY Sections 4, 5, and 6.
CRITICAL INSTRUCTIONS FOR CALL 2:
- Do NOT include any document title header (no '# Technical Review' or '# Formal Technical Review').
- Do NOT repeat Sections 1, 2, or 3.
- Do NOT output Sections 7 through 12.
- Section 4 is the ONLY place where the Architecture Flow Diagram and Use Case Diagram belong.
- Begin directly with '# 4. System Architecture & Component Flow'.

# 4. System Architecture & Component Flow

**Core System Components**:
| Component | Layer | Technology | Primary Role in This Project | Source File |
|---|---|---|---|---|
(List 3 to 6 actual components detected in this repository)

### Architecture Flow Diagram
Create a single valid Mermaid flowchart illustrating the REAL component flow and communication channels in this project.
CRITICAL MERMAID RULES: Every node label MUST be double-quoted inside brackets, e.g. FE["Frontend Client (React)"], BE["Express App Server"], DB[("Database Storage")].
```mermaid
graph TD
    User(["User / Browser"]) -->|HTTP / UI| FE["Frontend Client"]
    FE -->|REST API Calls| BE["Backend Server"]
    BE -->|Queries / Mutations| DB[("Database Storage")]
```

### Use Case Diagram & Actor Matrix
Identify the real user personas discovered in this project:

| Actor Persona | Permissions & Scope | Key Project Use Cases |
|---|---|---|
(List 2 to 4 real roles and their actual use cases from the code)

Create a single valid Mermaid Use Case diagram with a System Boundary showing the actual actors connected to their primary use cases in this project.
CRITICAL USE CASE MAPPING RULES:
1. Connect regular / primary users (e.g. Standard Developer, End User) to ALL primary features they interact with (e.g. Submitting Code Reviews, Interactive AI Chat, Viewing Dashboards, Authentication).
2. Elevated / Admin actors should connect to privileged administrative features (e.g. RBAC, User Management, Audit Logs, Platform Configuration) plus any core user features they also access.
3. NEVER restrict the application's primary core feature (such as Code Review or Core Analysis) exclusively to Admins unless the codebase strictly restricts it.
4. Mermaid syntax: Double-quote node labels inside parentheses or brackets, e.g. UC1["Submit Code Review"].
```mermaid
graph LR
    subgraph "System Boundary"
        UC_Auth["Authentication & Login"]
        UC_Core1["Primary Feature (e.g. AI Code Review)"]
        UC_Core2["Interactive Feature (e.g. AI Chat / Query)"]
        UC_Admin["Administrative & RBAC Controls"]
    end
    Actor_User(["Standard User / Developer"]) --> UC_Auth
    Actor_User --> UC_Core1
    Actor_User --> UC_Core2
    Actor_Admin(["Administrator / Superadmin"]) --> UC_Auth
    Actor_Admin --> UC_Admin
    Actor_Admin --> UC_Core1
```

---

# 5. Database Schema & Data Models

- **Database Engine**: Name the database detected in the code (e.g. MongoDB Atlas, PostgreSQL, SQLite, In-Memory Store, None).
- **Data Access Layer**: Name the ORM/ODM (e.g. Mongoose, Prisma, SQLAlchemy, native driver).

### Models & Collections Found
Extract the real schemas and models defined in the code:
| Collection / Model | Key Fields | Relationships / References | File Location |
|---|---|---|---|
(List each model actually found in the code with its fields, types, and references)

---

# 6. API Documentation & Route Surface

Document the actual HTTP endpoints defined in the routes and controllers:

| Method | Endpoint / Route | Auth Required | Purpose & Action |
|---|---|---|---|
(Extract 8 to 15 real routes from the routes/ or controllers/ files provided below)

**Sample API Interaction**:
Provide a real curl command for one of the primary endpoints with a realistic JSON payload based on the real schema:
```bash
curl -X POST http://localhost:PORT/api/sample-route \\
  -H "Content-Type: application/json" \\
  -d '{"key": "value"}'
```

---
"""

# ══════════════════════════════════════════════════════════════
# CALL 3 — Security Audit & Bug Analysis (Sections 7–8)
# ══════════════════════════════════════════════════════════════
P3 = """Analyze the security vulnerabilities, bugs, code quality, and technical debt for this repository. Output ONLY Sections 7 and 8.
CRITICAL INSTRUCTION: Do NOT include any document title header (no '# Technical Review' or '# Formal Technical Review'). Do NOT output Sections 1 through 6 or Sections 9 through 12. Begin directly with '# 7. Security & Vulnerability Assessment'.

# 7. Security & Vulnerability Assessment

Audit the security controls in this project and fill in the table with real findings citing actual code locations:

| Security Control | Implementation Status | Findings in This Project | Risk Level |
|---|---|---|---|
| Authentication & Session Management | Implemented / Partial / Missing | Real findings on JWT, sessions, or tokens | Low / Medium / High / Critical |
| Password & Secret Protection | Implemented / Partial / Missing | Real findings on bcrypt hashing and env vars | Low / Medium / High / Critical |
| Input Validation & Sanitization | Implemented / Partial / Missing | Real findings on request validation and schemas | Low / Medium / High / Critical |
| CORS & Origin Protection | Implemented / Partial / Missing | Real findings on CORS settings in server | Low / Medium / High / Critical |
| Sensitive Data & Error Exposure | Implemented / Partial / Missing | Real findings on errors, logs, and sensitive data | Low / Medium / High / Critical |

**Primary Security Observation**:
Provide 2-3 sentences summarizing the most critical security finding, citing exact files and potential impact.

---

# 8. Code Quality & Bug Analysis

Identify concrete bugs, missing error handlers, potential edge case failures, or performance bottlenecks discovered in the code:

| Severity | Issue Description | File / Location | Potential Impact | Recommended Fix |
|---|---|---|---|---|
(List 4 to 8 real issues discovered in the code. Distinguish between Critical, High, Medium, and Low severity. Use actual file names and line numbers where known.)

**Maintainability & Code Health**:
Provide 2-3 sentences evaluating modularity, adherence to language conventions, and technical debt.

---
"""

# ══════════════════════════════════════════════════════════════
# CALL 4 — Limitations, Future Scope, Roadmap & Conclusion (Sections 9–12)
# ══════════════════════════════════════════════════════════════
P4 = """Analyze the project boundaries, realistic future enhancements, improvement roadmap, and provide the overall conclusion. Output ONLY Sections 9, 10, 11, and 12.
CRITICAL INSTRUCTION: Do NOT include any document title header (no '# Technical Review' or '# Formal Technical Review'). Do NOT output Sections 1 through 8. Begin directly with '# 9. Project & Analysis Limitations'.

STRICT INSTRUCTIONS:
- Base all sections directly on the actual project architecture, detected dependencies, and earlier analysis findings.
- Do NOT invent hypothetical limitations or features that make no sense for this application.
- Prioritize Critical and High findings in the conclusion.

# 9. Project & Analysis Limitations

Detail the limitations that apply specifically to THIS project and THIS analysis:

### Technical & Architectural Limitations
Detail 3 to 4 concrete technical limitations supported by the code:
- **Limitation 1**: WHAT is limited, WHY it is limited (citing specific files or design patterns), and WHAT impact it has on scalability, reliability, or security.
- **Limitation 2**: WHAT is limited, WHY it is limited, and WHAT impact it has.
- **Limitation 3**: WHAT is limited, WHY it is limited, and WHAT impact it has.

### Analysis & Context Boundaries
Explicitly document the boundaries of this review:
- **Test Suite Assessment**: State whether automated test coverage exists or could not be fully assessed due to absent test suites.
- **Environment & Infrastructure**: Note any deployment, cloud infrastructure, or external integration configs not present in the repository.

---

# 10. Future Scope & Architectural Evolution

Describe realistic, high-value improvements and architectural evolutions tailored specifically to this project's domain and architecture:

- **Authentication & Security Hardening**: (e.g. Refresh-token rotation, multi-factor authentication (MFA), or stricter CORS whitelist)
- **Data Layer & Scaling Enhancements**: (e.g. Redis caching for frequent queries, database indexes, or transaction wrapping)
- **Reliability & Resilience**: (e.g. Queue-backed asynchronous task workers, rate limiting middleware, or comprehensive integration test suites)
- **DevOps & Developer Experience**: (e.g. Docker containerization, automated CI/CD pipelines via GitHub Actions, or OpenAPI/Swagger specification generation)

Explain for each point what concrete capability and benefit it unlocks for this specific project.

---

# 11. Prioritized Improvement Roadmap

Provide an actionable, prioritized roadmap for developers maintaining or upgrading this repository:

| Priority | Focus Area | Actionable Recommendation | Expected Benefit |
|---|---|---|---|
| 🔴 P1 (Immediate) | Security & Stability | Immediate fix for highest risk issue discovered | Prevents crashes or unauthorized access |
| 🟠 P2 (Short-term) | Testing & Reliability | Add automated unit/integration tests and input validation | Ensures regression safety and input integrity |
| 🟡 P3 (Medium-term) | Performance & Scaling | Add caching, database indexes, or rate limiting | Improves responsiveness under load |
| 🟢 P4 (Long-term) | Architecture & DevOps | CI/CD automation, containerization, or monitoring | Long-term operational excellence |

**Recommended Next Step**:
State in 2 sentences the exact first step the engineering team should take.

---

# 12. Overall Result & Conclusion

Provide a definitive, evidence-based conclusion summarizing the entire code review:
- **Overall Project Maturity & Quality**: A clear, technical assessment of the project's current design and code health.
- **Key Architectural Strengths**: What the project does well (e.g. modular structure, clean component separation, intuitive API design).
- **Primary Weaknesses & Critical Findings**: A direct, unvarnished summary of the most important issues discovered (weighing Critical and High findings heavily).
- **Production Readiness Verdict**: Whether the project is ready for production deployment or requires remediation before launch.
- **Final Developer Takeaway**: The primary strategic priority for the engineering team moving forward.
*(CRITICAL: Do NOT simply state 'The project is good but can be improved.' Provide a decisive, professional engineering verdict).*

---
"""




def write_progress(pfile, step, total, msg):
    if pfile:
        try: Path(pfile).write_text(f"STEP:{step}:{total}:{msg}\n", encoding="utf-8")
        except: pass

async def timed_call(prompt, label, retries=4):
    extra = {"max_tokens": 4000, "temperature": 0.15}
    for attempt in range(1, retries + 1):
        try:
            result = await asyncio.wait_for(mc.allm(prompt, **extra), timeout=LLM_TIMEOUT)
            return str(result).strip()
        except asyncio.TimeoutError:
            return (
                f"## ⚠️ {label} — Timed Out\n\n"
                f"> Generation exceeded {LLM_TIMEOUT}s. "
                f"Ask the **AI Chat** to generate this section on demand — "
                f"it has full access to the project knowledge base.\n"
            )
        except Exception as e:
            err_str = str(e).lower()
            if ("503" in err_str or "unavailable" in err_str or "high demand" in err_str) and attempt < retries:
                wait_sec = 3 * attempt
                print(f"[gen] High demand spike on {label} (attempt {attempt}). Waiting {wait_sec}s before retry...", flush=True)
                await asyncio.sleep(wait_sec)
                continue
            if ("413" in err_str or "too large" in err_str) and attempt < retries:
                print(f"[gen] Prompt exceeded limit on {label} (attempt {attempt}). Trimming context and retrying...", flush=True)
                prompt = prompt[:int(len(prompt) * 0.7)]
                await asyncio.sleep(2)
                continue
            if ("429" in err_str or "rate" in err_str or "limit" in err_str or "tpm" in err_str or "quota" in err_str) and attempt < retries:
                wait_sec = 6 * attempt
                print(f"[gen] Rate limited on {label} (attempt {attempt}). Waiting {wait_sec}s before retry...", flush=True)
                await asyncio.sleep(wait_sec)
                continue
            return f"## ⚠️ {label} — Error: {e}\n"


# ── Canonical Section Specifications & Deduplication ──────────────────────────
SECTION_SPECS = [
    (1, "Executive Summary & Health Verdict", ["executive summary", "health verdict"]),
    (2, "Project Objective & Functional Scope", ["project objective", "functional scope"]),
    (3, "Technology Stack & Key Integrations", ["technology stack", "tech stack", "key integrations"]),
    (4, "System Architecture & Component Flow", ["system architecture", "component flow"]),
    (5, "Database Schema & Data Models", ["database schema", "data models"]),
    (6, "API Documentation & Route Surface", ["api documentation", "route surface"]),
    (7, "Security & Vulnerability Assessment", ["security & vulnerability", "security and vulnerability", "vulnerability assessment", "security assessment"]),
    (8, "Code Quality & Bug Analysis", ["code quality", "bug analysis", "bug findings"]),
    (9, "Project & Analysis Limitations", ["limitations", "project & analysis limitations"]),
    (10, "Future Scope & Architectural Evolution", ["future scope", "architectural evolution"]),
    (11, "Prioritized Improvement Roadmap", ["improvement roadmap", "prioritized improvement"]),
    (12, "Overall Result & Conclusion", ["overall result", "conclusion"]),
]


def sanitize_mermaid_in_markdown(md: str) -> str:
    """
    Finds and sanitizes all ```mermaid blocks in the markdown report:
    - Normalizes Unicode smart/curly quotes to standard ASCII
    - Preserves diagram directives (graph TD, graph LR, etc.)
    - Ensures 'end' is on its own separate line
    - Quotes node labels in shapes properly
    - Sanitizes subgraph titles with straight double quotes
    """
    if not md or "```mermaid" not in md:
        return md

    def sanitize_block(match: re.Match) -> str:
        code = match.group(1).strip()
        # 1. Recover corrupted diagram headers if any (e.g. graph_TD_User -> graph TD\n    User)
        code = re.sub(r'^(graph|flowchart)[_ ]([A-Za-z]{2})_+([A-Za-z0-9_]+)', r'\1 \2\n    \3', code, flags=re.MULTILINE)

        # 2. Normalize Unicode smart/curly quotes
        code = re.sub(r'[\u201C\u201D\u201E\u201F\u2033\u2036]', '"', code)
        code = re.sub(r'[\u2018\u2019\u201A\u201B\u2032\u2035]', "'", code)

        # 3. Normalize line-break before statements following 'end'
        code = re.sub(r'(\bend\b)\s+([a-zA-Z0-9_]+)', r'\1\n    \2', code)

        lines = []
        for raw_line in code.splitlines():
            line = raw_line.rstrip()
            stripped = line.strip()
            if not stripped or stripped.startswith('%%'):
                lines.append(line)
                continue

            # Diagram direction directive: graph TD, flowchart LR, etc. Preserve!
            if re.match(r'^(?:graph|flowchart|sequenceDiagram|classDiagram|erDiagram|gantt|pie|gitGraph)\b', stripped, re.IGNORECASE):
                lines.append(line)
                continue

            # Subgraph name quoting: subgraph "System Boundary"
            m_sub = re.match(r'^(\s*subgraph\s+)(.+)$', line, re.IGNORECASE)
            if m_sub:
                name = m_sub.group(2).strip()
                if name.startswith('"') and name.endswith('"'):
                    lines.append(f'{m_sub.group(1)}{name}')
                else:
                    clean_name = name.strip('"\'').replace('"', "'")
                    lines.append(f'{m_sub.group(1)}"{clean_name}"')
                continue

            if stripped == 'end':
                lines.append(line)
                continue

            # Normalise common arrow markers
            line = re.sub(r'\|\|--\|\{', '||--o{', line)
            line = re.sub(r'\s+-->\s+', ' --> ', line)
            line = re.sub(r'\s+---\s+', ' --- ', line)
            line = re.sub(r'\s+==>\s+', ' ==> ', line)

            def quote_shape(m):
                prefix = m.group(1)
                node_id = m.group(2).strip()
                opener = m.group(3)
                label = m.group(4).strip()
                closer = m.group(5)

                if label.startswith('"') and label.endswith('"') and len(label) >= 2:
                    clean_label = label
                else:
                    inner = label.strip('"\'').replace('"', "'")
                    clean_label = f'"{inner}"'

                return f'{prefix}{node_id}{opener}{clean_label}{closer}'

            # Match shape definitions on single lines (NO whitespace in node ID!)
            line = re.sub(
                r'(^|\s+|-->\s*|---\s*|==>\s*|\|\s*)([a-zA-Z0-9_-]+)(\(\[|\[\(|\[|\(|\{\{)(.+?)(\]\)|\)\]|\]|\)|\}\})(?=\s*(-->|---|==>|\||$))',
                quote_shape,
                line
            )

            lines.append(line)

        return "```mermaid\n" + "\n".join(lines) + "\n```"

    return re.sub(r'```mermaid\n?([\s\S]*?)```', sanitize_block, md)


def clean_doc_titles(text: str) -> str:
    """Strips redundant top-level document titles that LLMs may generate between calls."""
    text = re.sub(
        r'(?m)^#{1,2}\s+(?:Formal\s+)?(?:Architectural\s+&\s+)?Technical\s+Review[^\n]*\n(?:\|[^\n]*\|\n|---|\s*)*',
        '',
        text
    )
    return text


def clean_section_content(sec_num: int, content: str) -> str:
    """
    Strips misplaced diagrams, subheadings, or bleeding content from sections
    where they strictly do not belong.
    """
    if not content:
        return ""

    if sec_num in (1, 2, 3):
        # Sections 1, 2, 3 should NEVER contain Architecture Flow Diagrams, Use Case diagrams,
        # or Mermaid code blocks (those belong strictly to Section 4 in Call 2)
        content = re.sub(r'(?i)#{1,3}\s+(?:System\s+)?Architecture\s+(?:Flow\s+)?Diagram[\s\S]*?(?=(?:#{1,3}\s+[A-Za-z0-9]|$))', '', content)
        content = re.sub(r'(?i)#{1,3}\s+Use\s+Case\s+Diagram[\s\S]*?(?=(?:#{1,3}\s+[A-Za-z0-9]|$))', '', content)
        content = re.sub(r'(?i)\*\*Core System Components\*\*[\s\S]*?(?=(?:#{1,3}\s+[A-Za-z0-9]|$))', '', content)
        content = re.sub(r'```mermaid[\s\S]*?```', '', content)

    if sec_num in (5, 6, 7, 8, 9, 10, 11, 12):
        # Sections 5 through 12 should not repeat the Architecture Flow Diagram or Use Case Diagram
        content = re.sub(r'(?i)#{1,3}\s+(?:System\s+)?Architecture\s+(?:Flow\s+)?Diagram[\s\S]*?(?=(?:#{1,3}\s+[A-Za-z0-9]|$))', '', content)
        content = re.sub(r'(?i)#{1,3}\s+Use\s+Case\s+Diagram[\s\S]*?(?=(?:#{1,3}\s+[A-Za-z0-9]|$))', '', content)

    # Clean trailing separators
    content = re.sub(r'(\n\s*---\s*)+$', '', content).strip()
    return content


def extract_sections_from_call(text: str, allowed_nums: set[int]) -> dict[int, str]:
    """
    Extracts sections designated for this specific call.
    Filters out extraneous sections or document title headers that LLM might hallucinate.
    """
    text = clean_doc_titles(text)
    pattern = re.compile(r'^(#{1,2})\s+(?:(\d+)[\.\:\s]+)?([^\n]+)$', re.MULTILINE)
    matches = list(pattern.finditer(text))

    sections_found = []
    for m in matches:
        raw_num = int(m.group(2)) if m.group(2) else None
        title = m.group(3).strip()
        title_lower = title.lower()

        if any(dt in title_lower for dt in ["technical review", "software analysis report", "formal technical review"]):
            continue

        matched_num = None
        for sec_num, canon_name, kws in SECTION_SPECS:
            if any(kw in title_lower for kw in kws):
                matched_num = sec_num
                break
        if matched_num is None and raw_num and 1 <= raw_num <= 12:
            matched_num = raw_num

        if matched_num:
            sections_found.append({
                "sec_num": matched_num,
                "start": m.start(),
                "title": title
            })

    sections_found.sort(key=lambda s: s["start"])
    extracted = {}
    for i, sec in enumerate(sections_found):
        num = sec["sec_num"]
        if num not in allowed_nums:
            continue
        start_pos = sec["start"]
        end_pos = sections_found[i+1]["start"] if i + 1 < len(sections_found) else len(text)
        content = text[start_pos:end_pos].strip()
        content = clean_doc_titles(content)
        content = re.sub(r'(\n\s*---\s*)+$', '', content).strip()

        canon_title = next(spec[1] for spec in SECTION_SPECS if spec[0] == num)
        first_nl = content.find('\n')
        sec_body = content[first_nl:] if first_nl != -1 else ""
        cleaned_body = clean_section_content(num, sec_body)
        standardized = f"# {num}. {canon_title}" + ("\n" + cleaned_body if cleaned_body else "")

        if num in extracted:
            if len(standardized) > len(extracted[num]):
                extracted[num] = standardized
        else:
            extracted[num] = standardized

    # Fallback if unparsed (e.g. timeout banner or error message)
    if not extracted and text.strip():
        first_num = sorted(allowed_nums)[0]
        canon_title = next(spec[1] for spec in SECTION_SPECS if spec[0] == first_num)
        extracted[first_num] = f"# {first_num}. {canon_title}\n\n{text.strip()}"

    return extracted


def deduplicate_review_markdown(md: str) -> str:
    """
    Post-processes and cleans review markdown, ensuring:
    1. Each of the 12 canonical sections appears exactly once in sequential order.
    2. Stray repeated Architecture Flow and Use Case diagrams are deduplicated.
    3. Mermaid diagrams are strictly syntax-sanitized.
    """
    if not md:
        return md

    header = ""
    body = md
    header_match = re.search(r'(# Software Analysis Report[\s\S]*?>[^\n]+\n\n---\n\n)', md)
    if header_match:
        header = header_match.group(1)
        body = md[header_match.end():]
    elif md.startswith("# Software Analysis Report"):
        first_sec = re.search(r'\n(?=#{1,3}\s+(?:\d+[\.\:\s]+)?[A-Z])', md)
        if first_sec:
            header = md[:first_sec.start()].strip() + "\n\n---\n\n"
            body = md[first_sec.start():]

    body = clean_doc_titles(body)
    pattern = re.compile(r'^(#{1,2})\s+(?:(\d+)[\.\:\s]+)?([^\n]+)$', re.MULTILINE)
    matches = list(pattern.finditer(body))

    sections_found = []
    for m in matches:
        raw_num = int(m.group(2)) if m.group(2) else None
        title = m.group(3).strip()
        title_lower = title.lower()

        if any(dt in title_lower for dt in ["technical review", "software analysis report", "formal technical review"]):
            continue

        matched_num = None
        for sec_num, canon_name, kws in SECTION_SPECS:
            if any(kw in title_lower for kw in kws):
                matched_num = sec_num
                break
        if matched_num is None and raw_num and 1 <= raw_num <= 12:
            matched_num = raw_num

        if matched_num:
            sections_found.append({
                "sec_num": matched_num,
                "start": m.start(),
                "title": title
            })

    sections_found.sort(key=lambda s: s["start"])
    sections = {}
    for i, sec in enumerate(sections_found):
        num = sec["sec_num"]
        start_pos = sec["start"]
        end_pos = sections_found[i+1]["start"] if i + 1 < len(sections_found) else len(body)
        content = body[start_pos:end_pos].strip()
        content = clean_doc_titles(content)
        content = re.sub(r'(\n\s*---\s*)+$', '', content).strip()

        canon_title = next(spec[1] for spec in SECTION_SPECS if spec[0] == num)
        first_nl = content.find('\n')
        sec_body = content[first_nl:] if first_nl != -1 else ""
        cleaned_body = clean_section_content(num, sec_body)
        standardized = f"# {num}. {canon_title}" + ("\n" + cleaned_body if cleaned_body else "")

        if num in sections:
            if len(standardized) > len(sections[num]):
                sections[num] = standardized
        else:
            sections[num] = standardized

    ordered_sections = []
    for num in range(1, 13):
        if num in sections:
            ordered_sections.append(sections[num].strip())

    if not ordered_sections:
        assembled = md
    else:
        assembled = (header + "\n\n---\n\n".join(ordered_sections) + "\n").strip() + "\n"

    # Global diagram deduplication:
    # Ensure '### Architecture Flow Diagram' and '### Use Case Diagram' appear at most once across the entire document
    seen_diagrams = set()
    def dedup_diagram(match: re.Match) -> str:
        diag_title = match.group(1).strip().lower()
        key = "arch" if "architecture flow" in diag_title else "usecase" if "use case" in diag_title else diag_title
        if key in seen_diagrams:
            return ""  # Remove duplicate diagram block
        seen_diagrams.add(key)
        return match.group(0)

    assembled = re.sub(
        r'(?i)(#{2,3}\s+(?:Architecture Flow Diagram|Use Case Diagram[^\n]*)\n[\s\S]*?)(?=(?:\n#{1,3}\s+|\n---\n|$))',
        dedup_diagram,
        assembled
    )

    # Clean double separators
    assembled = re.sub(r'(\n\s*---\s*){2,}', '\n\n---\n\n', assembled)

    # Sanitize all Mermaid blocks
    return sanitize_mermaid_in_markdown(assembled)


# ── Main Generator ────────────────────────────────────────────────────────────
async def generate(repo_path: str, repo_url: str, pfile: str = "") -> str:
    mc.configure(
        LLM_API_TYPE=os.getenv("LLM_API_TYPE", "openai"),
        LLM_API_BASE=os.getenv("LLM_API_BASE", ""),
        LLM_API_KEY=os.getenv("LLM_API_KEY", ""),
        MODEL=os.getenv("MODEL", "gemini-flash-lite-latest")
    )

    write_progress(pfile, 0, 4, "Extracting project intelligence and structure…")
    
    # 1. Extract rich project context metadata
    meta = extract_project_context(repo_path, repo_url)
    files, total_disc = collect_repo_files(repo_path)
    if not files:
        return "# Error\n\nNo readable source files found."

    # Record structural classifications
    meta["all_files_count"] = total_disc
    meta["test_files"] = [f["path"] for f in files if is_test(f["path"])]
    meta["entry_points"] = [f["path"] for f in files if is_core(f["path"])]
    meta["models"] = [f["path"] for f in files if is_model(f["path"])]
    meta["routes"] = [f["path"] for f in files if is_route(f["path"])]
    meta["auth_files"] = [f["path"] for f in files if is_auth(f["path"])]
    meta["services"] = [f["path"] for f in files if is_service(f["path"])]

    # 2. Extract verified static code signals (secrets, CORS, etc.)
    meta["detected_signals"] = detect_static_signals(files)

    ftree = file_tree(files)

    core_files  = [f for f in files if is_core(f["path"])]
    model_files = [f for f in files if is_model(f["path"])]
    route_files = [f for f in files if is_route(f["path"])]
    auth_files  = [f for f in files if is_auth(f["path"])]
    serv_files  = [f for f in files if is_service(f["path"])]
    other_files = [f for f in files if f not in core_files and f not in model_files and f not in route_files and f not in auth_files]

    # Context packaging for 4 focused calls
    code_call1 = pack(core_files + route_files[:6] + model_files[:4] + other_files[:6], MAX_CTX)
    code_call2 = pack(core_files + route_files + model_files, MAX_CTX)
    code_call3 = pack(auth_files + route_files[:6] + core_files + other_files[:4], MAX_CTX)
    code_call4 = pack(core_files + auth_files[:4] + serv_files[:4] + other_files[:4], MAX_CTX)

    cx_call1 = make_context(repo_url, meta, ftree, code_call1, part_scope="Part 1 of 4: Sections 1–3")
    cx_call2 = make_context(repo_url, meta, ftree, code_call2, part_scope="Part 2 of 4: Sections 4–6")
    cx_call3 = make_context(repo_url, meta, ftree, code_call3, part_scope="Part 3 of 4: Sections 7–8")

    p_name = meta["name"]
    n = len(files)
    print(f"[gen] {p_name}: {n} files analysed ({total_disc} total). Running 4 focused calls.", flush=True)

    # ── Call 1 ──
    write_progress(pfile, 1, 4, f"Sections 1–3: Executive Summary, Objective & Tech Stack for {p_name}…")
    print(f"[gen] Call 1/4: Sections 1–3 for {p_name}…", flush=True)
    res1 = await timed_call(cx_call1 + P1, "Sections 1–3")
    sec_call1 = extract_sections_from_call(res1, {1, 2, 3})
    await asyncio.sleep(2)

    # ── Call 2 ──
    write_progress(pfile, 2, 4, f"Sections 4–6: Architecture, Database Models & API Surface for {p_name}…")
    print(f"[gen] Call 2/4: Sections 4–6 for {p_name}…", flush=True)
    res2 = await timed_call(cx_call2 + P2, "Sections 4–6")
    sec_call2 = extract_sections_from_call(res2, {4, 5, 6})
    await asyncio.sleep(2)

    # ── Call 3 ──
    write_progress(pfile, 3, 4, f"Sections 7–8: Security Assessment & Bug Analysis for {p_name}…")
    print(f"[gen] Call 3/4: Sections 7–8 for {p_name}…", flush=True)
    res3 = await timed_call(cx_call3 + P3, "Sections 7–8")
    sec_call3 = extract_sections_from_call(res3, {7, 8})
    await asyncio.sleep(2)

    # ── Call 4 (Incorporate verified Call 3 findings for internal consistency) ──
    findings_parts = []
    if 7 in sec_call3:
        findings_parts.append(sec_call3[7])
    if 8 in sec_call3:
        findings_parts.append(sec_call3[8])
    if not findings_parts:
        findings_parts.append(res3)
    call3_snippet = "\n\n".join(findings_parts)[:2500]

    cx_call4 = make_context(repo_url, meta, ftree, code_call4, findings_summary=call3_snippet, part_scope="Part 4 of 4: Sections 9–12")

    write_progress(pfile, 4, 4, f"Sections 9–12: Limitations, Future Scope, Roadmap & Conclusion for {p_name}…")
    print(f"[gen] Call 4/4: Sections 9–12 for {p_name}…", flush=True)
    res4 = await timed_call(cx_call4 + P4, "Sections 9–12")
    sec_call4 = extract_sections_from_call(res4, {9, 10, 11, 12})

    header = f"""# Software Analysis Report

| Metadata | Details |
|---|---|
| **Project** | `{p_name}` |
| **Repository** | `{repo_url}` |
| **Files Analysed** | {n} source files ({total_disc} total discovered) |
| **Engine** | CodeSense AI |

> 💡 **AI Chat Available** — This document is fully indexed. Ask the AI Chat to generate diagrams,
> explain any section, discuss future scope, or analyse any part of this project in depth.

---

"""

    # Assemble all sections with absolute deduplication: each section 1..12 appears exactly once
    final_dict = {}
    final_dict.update(sec_call1)
    final_dict.update(sec_call2)
    final_dict.update(sec_call3)
    final_dict.update(sec_call4)

    ordered_sections = []
    for num in range(1, 13):
        if num in final_dict:
            ordered_sections.append(final_dict[num].strip())

    assembled_doc = header + "\n\n---\n\n".join(ordered_sections) + "\n"
    return deduplicate_review_markdown(assembled_doc)


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) < 5:
        print(json.dumps({"ok": False, "error": "Usage: script repo_path repo_url out_file progress_file"}))
        sys.exit(1)
    try:
        doc = asyncio.run(generate(sys.argv[1], sys.argv[2], sys.argv[4]))
        Path(sys.argv[3]).write_text(
            json.dumps({"ok": True, "markdown": doc}, ensure_ascii=False), encoding="utf-8")
        print("OK")
    except Exception as e:
        try: Path(sys.argv[3]).write_text(json.dumps({"ok": False, "error": str(e)}), encoding="utf-8")
        except: pass
        print("ERROR"); sys.exit(1)
