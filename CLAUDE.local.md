# CLAUDE.md — System Design Simulator

## Project Overview

**What it is:** A browser-based tool where users visually design distributed systems (drag-and-drop components like load balancers, servers, databases, caches, queues) and get real-time performance feedback based on queueing theory. Instead of reading about system design, users build a design, simulate traffic, and watch it either hold up or fall over — with bottlenecks visually flagged.

**Problem it solves:** System design education today is either passive (videos, books, static diagrams) or interview-drilling flashcards. Nothing lets a learner actually *build* a system and see the consequences of their choices — e.g., "what happens if I don't add a cache in front of my database at 10k req/sec?" This simulator makes that consequence visible and immediate.

**Core loop:** Design → set traffic pattern → simulate → see latency/bottlenecks → redesign → re-simulate.

**Target user:** CS students and junior engineers studying system design (interview prep + genuine learning), plus this serves as the author's own resume portfolio piece.

**Differentiator / niche:** Existing tools (Excalidraw, ByteByteGo, System Design Primer) are either pure drawing or passive content. This is the first accessible tool that actually *simulates* the design using real queueing math (M/M/1 model) rather than just letting users draw boxes and arrows.

---

## Project Status

**Phase:** Backend complete and hardened. Frontend is currently empty — no canvas, no components, no implementation. Frontend work is to be built following the blueprint handed over by Claude Design, not planned from scratch here. Nothing is deployed yet.

**Repo:** [github.com/DanielGuerrero59/System-Design-Simulator](https://github.com/DanielGuerrero59/System-Design-Simulator), single `main` branch. The 10 backend commits, newest first:
```
8c9ae50  Fix error handling and make CORS and deps deployment-safe
0d13eaa  Harden the engine against malformed and oversized input
2593d55  Add the FastAPI app and the /simulate route
f714283  Add the graph engine: traffic propagation and critical path
291197c  Add component classes behind a self-registering registry
91b9614  Ignore stray nested clone of this repository
14f5589  Drop unused NumPy dependency
5b3d1bc  Add M/M/1 queueing formulas with unit tests
35cf2ee  Add simulation constants and the /simulate API contract
fff784a  Scaffold backend structure and Python environment
```

**Backend — complete and hardened.** 1,097 lines of source, 808 lines of tests, 124 tests passing.
| File | Lines | Role |
|---|---|---|
| `backend/app/simulation/constants.py` | 127 | enums, service rates, thresholds, input ceilings |
| `backend/app/simulation/queueing.py` | 125 | M/M/1 formulas, framework-free |
| `backend/app/simulation/components.py` | 264 | one class per type; replicas, cache hit ratios |
| `backend/app/simulation/engine.py` | 214 | graph validation, traffic flow, critical path |
| `backend/app/schemas.py` | 187 | the `/simulate` request/response contract |
| `backend/app/main.py` | 180 | FastAPI app, CORS, error handling |

Survived two review passes: `queueing.py` (8 findings) and the components/engine/API commits (11 findings — including a server-crashing bug where FastAPI's own error handler couldn't serialize the `Infinity` it was trying to reject). All fixed and verified.

**Frontend — empty.** No canvas, no components, no implementation exists yet. Frontend work should follow the blueprint handed over by Claude Design as the primary source of truth for layout, components, and interaction design — do not re-derive the frontend plan from this file.

**Not built:** the frontend. Deployment. Traffic presets beyond a steady rate. Persistence.

**Modelling decisions (deliberate simplifications):**
- Replicas = N independent M/M/1 queues, each seeing λ/N
- Fan-out splits traffic evenly across outgoing edges
- Total latency = the critical (slowest) path, not the sum of every component in the graph
- Saturation = `null` latency + `"saturated"` status, never `Infinity`
- Exactly one entry point required per design

**Architectural constraints held:**
- Dependency direction: `schemas.py` → simulation package, never reverse; the engine has no FastAPI/Pydantic import and is testable without a server
- `ComponentSpec` is a plain frozen dataclass, deliberately not `schemas.NodeConfig`
- Open/closed via `__init_subclass__` — a new component type is a new class, with an import-time check that fails if a `ComponentType` has no implementation
- Test expectations are hand-derived from the formulas, never recorded from output — has now caught three of the author's own arithmetic errors before they shipped

**Environment & repo:**
- Python 3.12.6 venv, built against the python.org interpreter (the MSYS2/mingw Python on `PATH` produces broken venvs)
- Node.js 24.19.0 lives at `C:\Program Files\nodejs` and is often absent from the shell `PATH` — prepend it rather than assuming `npm` resolves
- Dependencies pinned exactly
- `ALLOWED_ORIGINS` (comma-separated) falls back to localhost dev ports; must include the Vercel origin once deployed
- Public repo, linear history, single branch, no secrets, GitHub-noreply commit metadata; `CLAUDE.md` and `.venv/` gitignored and verified 404 on GitHub

**Still open:**
- Frontend — build it, following the Claude Design blueprint as the primary reference
- Deployment — Vercel + Railway, and the two env vars pointing at each other
- Traffic presets (spike / ramp) — schema supports one steady rate, written to extend
- Persistence — save/share designs, or session-only for v1
- Stray empty `System-Design-Simulator/` clone in the project root — gitignored, still clutter

**Next:** build the frontend from the Claude Design blueprint, then deploy.

---

## Tech Stack

**Frontend**
- React
- React Flow (drag-and-drop node/edge canvas — this is the library that renders the diagram)
- Tailwind CSS

**Backend**
- FastAPI (Python) — receives the graph structure + traffic input, runs the simulation, returns latency/bottleneck data

**Deployment**
- Frontend: Vercel
- Backend: Railway (or Fly.io)

**Why this stack:** Author has prior Python backend experience and some Java exposure but no production web app built yet. FastAPI keeps the backend in familiar Python. React Flow is purpose-built for exactly this diagram-canvas use case rather than hand-rolling SVG drag-and-drop.

---

## Coding Style & Conventions

Standards a reviewing engineer should expect to see followed:

**General**
- Small, single-responsibility functions and components. A component that renders the canvas should not also contain simulation math.
- Explicit types everywhere feasible — TypeScript on the frontend (not plain JS), Python type hints on all function signatures on the backend.
- No magic numbers in the simulation logic — service rates, thresholds, and constants live in a config/constants file, named and documented (e.g., `DEFAULT_DB_SERVICE_RATE_RPS = 5000`).
- Comments explain *why*, not *what* — especially around the queueing math, since the formulas won't be self-explanatory to a reader unfamiliar with M/M/1.

**Frontend (React)**
- Functional components + hooks only, no class components.
- Component files organized by feature (`/canvas`, `/simulation-results`, `/sidebar`) rather than by type (`/components`, `/hooks` dumped flat).
- Simulation-result state kept separate from canvas/diagram state — don't conflate "what the user drew" with "what the backend returned."
- API calls isolated in a dedicated service/client module, never fetched directly inside components.

**Backend (FastAPI)**
- Pydantic models for all request/response schemas — no raw dicts crossing the API boundary.
- Simulation engine (the queueing math) lives in its own module, fully decoupled from the FastAPI route handlers, and is unit-testable without spinning up a server.
- Each component type's behavior (service rate, latency formula) modeled as its own class implementing a shared interface, so adding a new component type later doesn't require touching existing ones (open/closed principle).
- Input validation at the API boundary — reject malformed graphs (cycles where they shouldn't exist, disconnected nodes) before they hit the simulation engine.

**Testing**
- Unit tests on the simulation math first — this is the core intellectual property of the app and the easiest thing to silently get wrong.
- At minimum: known-input/known-output tests for the M/M/1 formula, and a couple of end-to-end tests simulating a full simple graph (LB → Server → DB).
- Expected values in known-input/known-output tests must be hand-derived from the formula (or an independent identity), never generated by running the implementation and pasting its output. A test built from the code's own output can only prove the code hasn't changed since — not that it was right to begin with. Where possible, cross-check a derived quantity (like queue length) against an independent identity rather than the same arithmetic the implementation uses, so a passing test is real evidence rather than circular.

**Git / workflow**
- Small, atomic commits with descriptive messages (not "wip" or "fixes").
- README written as if a stranger needs to run this locally in under 5 minutes — setup steps, env vars, how to run frontend and backend separately.

---