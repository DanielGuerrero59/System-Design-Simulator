# System Design Simulator

A browser-based tool where you visually design distributed systems — drag in load
balancers, servers, databases, caches and queues, wire them together — and get
real performance feedback from queueing theory rather than from a diagram that
just sits there.

Set a traffic rate, hit **Simulate**, and every component is coloured by how busy
it is. Push the load high enough and a component saturates: its queue grows
without bound, so the app reports its latency as `∞` rather than inventing a
number. Add replicas, put a cache in front of the database, and watch the
bottleneck move.

The numbers come from an **M/M/1** model, not from hand-waving. Utilisation is
`ρ = λ / μ`; average time in system is `1 / (μ − λ)`. What the tool teaches is
the shape of that curve — why 70% busy is comfortable, 85% is precarious, and
100% is a different kind of thing altogether.

---

## Run it locally

You need **Python 3.12+** and **Node.js 20+**. Two terminals, about three
minutes.

### 1. Backend (FastAPI, port 8000)

```bash
cd backend
python -m venv .venv
```

Activate the virtual environment — `source .venv/bin/activate` on macOS and
Linux, or on Windows:

```bash
source .venv/Scripts/activate
```

(In PowerShell that is `.venv\Scripts\Activate.ps1`.) Then:

```bash
pip install -r requirements.txt
```

```bash
uvicorn app.main:app --reload --port 8000
```

Check it: <http://127.0.0.1:8000/health> returns `{"status":"ok"}`, and
<http://127.0.0.1:8000/docs> gives you the interactive API reference.

### 2. Frontend (React + Vite, port 5173)

```bash
cd frontend
npm install
```

```bash
npm run dev
```

Open <http://127.0.0.1:5173>. The canvas starts with a load balancer → app
server → database design already drawn, so there is something to simulate
immediately.

### 3. Run the tests

```bash
cd backend && .venv/Scripts/python -m pytest
```

124 tests, all on the simulation math and the API boundary. Expected values are
hand-derived from the formulas rather than recorded from the implementation's
own output — a test built from the code's output can only prove the code has not
changed, not that it was right to begin with.

---

## Environment variables

Neither is required for local development; both matter once this is deployed.

| Variable | Side | Default | What it does |
|---|---|---|---|
| `ALLOWED_ORIGINS` | backend | localhost dev ports (5173, 3000) | Comma-separated list of origins the browser may call the API from. |
| `VITE_API_BASE_URL` | frontend | `http://127.0.0.1:8000` | Where the frontend sends `/simulate`. Inlined at build time. |

Deployment needs both, pointing at each other:

```bash
ALLOWED_ORIGINS=https://your-app.vercel.app
```

```bash
VITE_API_BASE_URL=https://your-api.up.railway.app
```

Get `ALLOWED_ORIGINS` wrong and everything keeps passing except the browser:
`curl` works, the test suite works, and the only symptom is a CORS failure in
the console. It is worth setting deliberately.

---

## How it is put together

```
backend/app/
  simulation/
    constants.py    service rates, thresholds, input ceilings — every tunable number
    queueing.py     the M/M/1 formulas, framework-free
    components.py   one class per component type, behind a self-registering registry
    engine.py       graph validation, traffic propagation, critical path
  schemas.py        the /simulate request and response contract
  main.py           FastAPI app, CORS, error handling

frontend/src/
  api/              types mirroring the Pydantic schemas; the only module that calls fetch
  design/           the diagram store — what the user drew, and nothing else
  canvas/           React Flow wiring and the custom component node
  sidebar/          palette, traffic controls, per-node inspector
  simulation-results/  the result store, and the table that reports it
```

Two boundaries are load-bearing:

**The engine does not know FastAPI exists.** `schemas.py` imports from the
simulation package and never the reverse, so the queueing math is unit-testable
without a server anywhere in the picture.

**The design and the results are separate stores.** One holds what the user
drew; the other holds a claim the backend made about a particular version of it.
Keeping them apart is what lets the app say "these numbers describe an earlier
version of your design" instead of quietly showing stale figures as current.

---

## Modelling decisions

These are deliberate simplifications. Stating them plainly matters, because they
determine every number the app reports.

- **Replicas are N independent M/M/1 queues**, each seeing `λ/N`. A real load
  balancer in front of a shared pool does better than this (M/M/c), so the model
  is pessimistic — but it is far easier to reason about, and it still rewards
  horizontal scaling the way a learner expects.
- **Fan-out splits traffic evenly.** A node with three outgoing edges sends a
  third of its downstream traffic along each.
- **A cache reduces what continues downstream, not what it receives itself.** It
  still has to check before it can answer.
- **End-to-end latency is the critical path**, not the sum of every component. A
  request traverses one route through the graph, so the honest figure is the
  slowest route.
- **Saturation is a state, not a big number.** At `ρ ≥ 1` the API returns `null`
  latency and a `"saturated"` status. It never returns `Infinity`, and the UI
  never renders a figure in its place.
- **Exactly one entry point per design.** Traffic enters the system in one place.
