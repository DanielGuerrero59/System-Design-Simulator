# System Design Simulator

**Try it: <https://system-design-simulator-seven-kappa.vercel.app>.** The API it
talks to is at <https://system-design-simulator-production-f005.up.railway.app/docs>.

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

Open <http://127.0.0.1:5173>. The frontend is a three-level game: each level
sets a traffic target, a latency cap and a credit budget, and you have to build
a design that meets all three. Level 01 starts with a database on the canvas —
add an app server, wire it up, and press **Run traffic**.

### 3. Run the tests

```bash
cd backend && .venv/Scripts/python -m pytest
```

124 tests, all on the simulation math and the API boundary. Expected values are
hand-derived from the formulas rather than recorded from the implementation's
own output — a test built from the code's output can only prove the code has not
changed, not that it was right to begin with.

```bash
cd frontend && npm test
```

65 tests on the pure layers: the game's win conditions, the graph questions the
UI answers without asking the backend, request building, node placement and
number formatting. No DOM, so they run in about a second.

The same discipline applies. `game/levels.test.ts` writes out the M/M/1
formulas rather than importing them, so each level is checked against the model
instead of against another copy of the app's own arithmetic — and it asserts
both that the documented solution clears and that the naive design fails. A
suite that only tries the intended answer can pass while the game asks for
nothing at all, which is precisely the bug these were written after.

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

## Deploy

The backend runs anywhere that can build a Dockerfile; the frontend is a static
Vite build. The intended pairing is **Railway** for the API and **Vercel** for
the site, each deploying straight from this repository so that a push to `main`
ships. Backend first — the frontend needs its URL.

### 1. Backend on Railway

1. **New Project → Deploy from GitHub repo**, and pick this repository.
2. In the service's **Settings**, set **Root Directory** to `backend`. Railway
   finds the `Dockerfile` there and builds it; the `railway.json` next to it
   points the health check at `/health` and restarts the service on failure.
3. **Settings → Networking → Generate Domain** (port `8000` if it asks). The
   URL it gives you is `VITE_API_BASE_URL`.

Check it: `https://<your-api>.up.railway.app/health` returns `{"status":"ok"}`.

### 2. Frontend on Vercel

1. **Add New → Project**, and import this repository.
2. Set **Root Directory** to `frontend`. Vercel detects Vite and runs
   `npm run build` into `dist/` on its own.
3. Under **Environment Variables**, add `VITE_API_BASE_URL` with the Railway
   URL from above, without a trailing slash. It is inlined at build time, so
   setting it after the first deploy means redeploying.
4. Deploy. The resulting `https://<your-site>.vercel.app` is `ALLOWED_ORIGINS`.

### 3. Close the loop

Back in Railway, under the service's **Variables**, add
`ALLOWED_ORIGINS=https://<your-site>.vercel.app` — no trailing slash, because
CORS compares origins byte for byte — and apply it so the service redeploys.

Open the site and press **Run traffic**. Numbers on the canvas mean both
variables are right. If the panel says it cannot reach the API while `/health`
works in a tab, it is `ALLOWED_ORIGINS`.

Vercel's preview deployments get their own origins, so they hit the CORS wall by
design; add one to `ALLOWED_ORIGINS` (comma-separated) if you need it.

### The same container, locally

```bash
cd backend && docker build -t sds-api . && docker run --rm -p 8000:8000 sds-api
```

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
  game/             levels, objectives, and the verdict; all the rules in one place
  canvas/           React Flow wiring, the component card, the traffic source
  sidebar/          the parts bin
  panel/            objectives, the slowest-path figure, the coaching line
  simulation-results/  the result store and the heat ramp
```

Three boundaries are load-bearing:

**The engine does not know FastAPI exists.** `schemas.py` imports from the
simulation package and never the reverse, so the queueing math is unit-testable
without a server anywhere in the picture.

**The design and the results are separate stores.** One holds what the user
drew; the other holds a claim the backend made about a particular version of it.
Keeping them apart is what lets the app say "these numbers describe an earlier
version of your design" instead of quietly showing stale figures as current.

**The game does not invent numbers.** Every figure on screen comes from
`/simulate`. The game layer adds only what the backend has no opinion about:
what a level asks for, what a component costs in credits, and whether the
current design clears the bar. Utilisation, latency and saturation are read
from the API response — including the "every node under 85%" objective, which
tests each node's reported `status` rather than re-deriving the threshold on the
client, where the copy would be free to disagree with the original.

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
