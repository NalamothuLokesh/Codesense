# Comparative Analysis & Academic Differentiation: CodeSense vs. CIAO (De Luca et al., 2026)

> **Document Purpose:** This document provides a comprehensive, rigorous comparative analysis between **CodeSense** and **CIAO** (*"CIAO - Code In Architecture Out: Automated Software Architecture Documentation with Large Language Models"*, arXiv:2604.08293v1, April 2026). It details architectural differences, feature divergence, algorithmic innovations, and academic positioning strategies to protect research paper submissions to IEEE venues from redundancy and novelty objections.

---

## Executive Summary

When evaluating a research submission, IEEE reviewers apply strict standards regarding novelty, incrementalism, and redundancy. A surface-level comparison might suggest that both CIAO and CodeSense consume a repository and generate technical documentation. 

However, a deep technical and functional audit reveals that **the two systems belong to distinct problem domains**:
* **CIAO** is an experimental **Software Architecture Recovery (SAR)** CLI script designed strictly to generate passive, ISO/IEC/IEEE 42010 and C4-compliant architectural Markdown documentation.
* **CodeSense** is an enterprise-grade, **dual-stage Automated Code Review, Security Auditing, and Interactive RAG (Retrieval-Augmented Generation) Exploration Platform**.

Architecture visualization constitutes **100% of CIAO's functional scope**, but represents **only ~15% (Section 4 out of 12) of CodeSense's comprehensive analysis pipeline**.

---

## 1. Master Feature-by-Feature Comparison Matrix

| Feature / Capability Dimension | CIAO (De Luca et al., 2026) | CodeSense Platform | Novelty / Academic Distinction |
| :--- | :---: | :---: | :--- |
| **Primary Scientific Field** | Software Architecture Recovery (SAR) | Automated Code Review & Security Auditing | Distinct fields, research questions, and evaluation metrics. |
| **System Architecture** | Single-run Python CLI Script | Decoupled 3-Tier Enterprise Web Platform | Terminal script vs. full-stack production platform. |
| **Interactive Developer UI** | ❌ None (CLI only) | ✅ React 19 SPA (Dark/Light, Command Palette) | Real-time browser rendering & state monitoring. |
| **Post-Review Interaction** | ❌ None (Terminates on file generation) | ✅ Dynamic Conversational RAG Assistant | Addresses CIAO's explicitly stated future work. |
| **Vector Database & Embeddings**| ❌ None | ✅ Persistent ChromaDB Vector Collections | Enables semantic retrieval and source-cited Q&A. |
| **Vulnerability & Security Audit** | ❌ None | ✅ OWASP Top 10 Audit (Section 7) | Evaluates auth, secrets, inputs, CORS, & exposure. |
| **Line-Attributed Bug Detection** | ❌ None | ✅ Categorized Defect Triage (Section 8) | Identifies runtime bugs with exact `file:line` fixes. |
| **Deterministic Heuristic Pre-Scan**| ❌ None (Pure generative prompting) | ✅ Static Heuristic Engine (`detect_static_signals`) | Enforces ground-truth facts to eliminate hallucinations. |
| **Database Schema Extraction** | ❌ None (Coarse container labels only) | ✅ Deep ORM Model Reverse-Engineering (Sec. 5) | Maps fields, types, and cross-model references. |
| **API Endpoint Cataloging** | ❌ None | ✅ Route Surface + Executable `curl` Payloads (Sec. 6) | Real HTTP method, route, & JSON payload discovery. |
| **Actionable Engineering Roadmap** | ❌ None (Passive descriptive text) | ✅ Prioritized Remediation Backlog P1–P4 (Sec. 11) | Direct transition from audit to remediation. |
| **Quantitative Health Scoring** | ❌ None | ✅ Project Health Scorecard out of 10 (Sec. 1) | Objective rating of quality, modularity, & risk. |
| **Context Management Strategy** | Monolithic Concatenation via `REPOMIX` | Intelligent Semantic Prioritization & Budgeting | Prevents token exhaustion and prompt dilution. |
| **Diagramming Engine** | PlantUML rendered to static `.png` images | Dynamic in-browser Mermaid.js | Eliminates CIAO's #1 reported error (32 complaints). |
| **Persistence & Multi-Tenancy** | ❌ None (Overwrites local file) | ✅ MongoDB (User profiles, history, RBAC) | Full session management, search, and admin oversight. |

---

## 2. In-Depth Technical Divergence

### A. Operational Scope: Passive SAR vs. Active Review & Remediation
* **CIAO:** Follows ISO/IEC/IEEE 42010, SEI Views & Beyond, and C4 models. Its 8 sections exclusively describe the current structural composition of the codebase (Context, Containers, Components, Code, Cross-Cutting, Rationale, Deployment). It does not evaluate whether the code works correctly or whether it contains security vulnerabilities.
* **CodeSense:** Focuses on actionable software quality and defensive engineering. It produces a 12-section technical specification that assesses security posture, identifies bugs with file-and-line citations, documents database models, catalogs routes with executable test requests, and lays out a 4-tier engineering roadmap (P1 Immediate to P4 Long-Term).

### B. Input Ingestion: Monolithic Flattening vs. Hierarchical Context-Budgeting
* **CIAO:** Relies on `REPOMIX` to strip comments and concatenate all repository files into a single, massive textual document. On larger repositories (>50,000 LOC), this strategy leads to context dilution ("lost in the middle"), token limit overflow, and steep API costs.
* **CodeSense:** Implements an intelligent priority scheduler (`collect_repo_files` in `generate_review_doc.py`). It parses manifest files (`package.json`, `pom.xml`, `pyproject.toml`, `Cargo.toml`, `go.mod`), isolates entry points, and ranks files into semantic priority classes:
  $$\text{Manifests} \succ \text{Core Architecture} \succ \text{Models} \succ \text{Routes} \succ \text{Auth/Middleware} \succ \text{Services} \succ \text{Tests}$$
  Each tier is governed by explicit per-file and cumulative token budgets (`MAX_HI = 10,000`, `MAX_FILE = 5,000`, `MAX_CTX = 40,000`), guaranteeing high-signal prompt density without timeouts.

### C. Hallucination Mitigation: Unguided Prompting vs. Hybrid Static Grounding
* **CIAO:** The empirical evaluation of CIAO reported substantial developer friction regarding inaccurate relationships, omitted classes, and diagram hallucinations (32 occurrences in survey feedback). CIAO relies purely on natural-language role prompting (*"Meticulous Software Architect"*).
* **CodeSense:** Implements a **hybrid static-analysis + generative architecture**. Before any LLM call, `detect_static_signals()` executes deterministic heuristic analyzers that detect hardcoded secret fallbacks, permissive wildcard CORS headers, disabled TLS verification, tokens in localStorage, and synchronous event-loop blocking I/O. These verified code locations are injected into the prompt as *empirical ground truth*, preventing the LLM from hallucinating vulnerabilities.

### D. Interaction Paradigm: Static Markdown File vs. Dual-Stage RAG Platform
* **CIAO:** CIAO's execution terminates the moment `README.md` is written to disk. The paper explicitly identifies this limitation in Section VII:
  > *"Future studies may investigate whether human-in-the-loop refinement can further improve documentation quality and adoption."*
* **CodeSense:** Resolves this exact limitation by providing a **dual-stage architecture**. In Stage 1, the 12-section specification is generated. In Stage 2, `chat_service.py` automatically chunks and indexes the review artifacts and high-priority code files into **ChromaDB vector embeddings**. Developers can query the codebase in natural language, request specific refactoring implementations, clarify reported bugs, and navigate complex dependencies interactively.

### E. Diagramming Reliability: Fragile External Images vs. Resilient In-Browser Rendering
* **CIAO:** Generates PlantUML text, calls an external renderer to produce static PNG/SVG files, and links them into the markdown. Participants in the CIAO study singled out diagrams as the most fragile artifact (e.g., truncated class hierarchies, phantom dependencies).
* **CodeSense:** Generates structured Mermaid.js diagrams directly within markdown, rendered live in the React frontend. Strict syntax constraints (e.g., automated label sanitization and quote escaping) ensure reliable visualization of both system architectures and use-case actor matrices.

---

## 3. The Academic "Delta" for IEEE Submission

To ensure peer reviewers immediately recognize the novelty of CodeSense over CIAO, papers should be framed around the following academic contributions:

### Suggested Paper Titles
1. **Option 1 (Recommended):** *CodeSense: A Hybrid Static-Analysis and Context-Budgeted LLM Framework for Automated Code Review and Interactive Codebase Comprehension*
2. **Option 2:** *Bridging Static Software Auditing and Dynamic Exploration: A Multi-Stage Generative Pipeline for Full-Repository Triage*
3. **Option 3:** *Beyond Passive Architectural Recovery: Evidence-Grounded Vulnerability Detection and Conversational Code Exploration using Large Language Models*

### Formulated Research Questions (RQs)
* **RQ1 (Static Grounding & Precision):** To what extent does pre-flight deterministic static analysis reduce false-positive hallucination rates in LLM-generated security and defect reviews?
* **RQ2 (Context-Budgeting vs. Monolithic Flattening):** How does selective priority-based context packing compare against monolithic repository aggregation (e.g., Repomix) in terms of token efficiency, execution latency, and architectural coverage?
* **RQ3 (Developer Utility in Dual-Stage Exploration):** How does developer task comprehension improve when using a dual-stage system (static technical review + interactive RAG chat) compared to static architectural documentation alone?
* **RQ4 (Cross-Model Cost-Benefit Trade-offs):** What are the performance, accuracy, and operational cost differences when executing repository reviews on localized small language models (e.g., Ollama/Qwen 2.5) versus hosted frontier LLMs (e.g., Gemini Flash, GPT-4o)?

---

## 4. Formal Related Work Text (Ready for Manuscript Inclusion)

> *"Recent work has investigated Large Language Models for repository-scale documentation. Most notably, De Luca et al. [1] introduced CIAO, an LLM-based workflow designed to reconstruct system-level software architecture documentation based on ISO/IEC/IEEE 42010 and the C4 model. While CIAO advances automated architecture recovery, it is inherently limited to passive structural documentation, relies on monolithic repository flattening that scales poorly to complex codebases, and lacks post-generation developer interactivity.*
>
> *CodeSense departs from this paradigm by addressing active code review, vulnerability assessment, and interactive code exploration. Rather than treating repository ingestion as a single concatenation task, CodeSense introduces a prioritized, budget-constrained context scheduling mechanism. Furthermore, CodeSense integrates a deterministic static analysis pre-scanner to ground LLM evaluations in verified code signals, eliminating hallucinations in security defect triage. Finally, unlike static documentation generators, CodeSense incorporates a dynamic retrieval-augmented generation (RAG) conversational engine, enabling developers to interactively query, clarify, and remediate findings identified in the generated review."*

---

## 5. Conclusion

CodeSense is **not** an incremental variation or a "better prompt" for CIAO. The two tools share only a single high-level capability (generating an architecture diagram from a repository). 

CodeSense's inclusion of **vulnerability auditing, defect triage, database model extraction, API cataloging, heuristic static pre-scanning, and interactive RAG chat** places it in a separate, more comprehensive research and functional category that satisfies IEEE requirements for technical novelty and academic contribution.
