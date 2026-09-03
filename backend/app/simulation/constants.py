"""Shared vocabulary and tunable constants for the simulation engine.

Every number the queueing math depends on lives here rather than inline in a
formula. Two reasons: a reader can audit all the modelling assumptions in one
place, and "what if a Postgres box were twice as fast?" becomes a one-line
change instead of a search-and-replace through the engine.

The service rates below are per *single instance*. They are deliberately
round, order-of-magnitude-honest figures for a modest cloud VM -- not
benchmarks of any specific product. What matters pedagogically is the
*ratios* between tiers, since those are what determine which component
becomes the bottleneck first.
"""

from enum import Enum


class ComponentType(str, Enum):
    """The component palette available in v1.

    Inherits from `str` so FastAPI serialises these as plain JSON strings
    ("database", not {"value": "database"}) and the React side can compare
    them directly against string literals.
    """

    LOAD_BALANCER = "load_balancer"
    APP_SERVER = "app_server"
    DATABASE = "database"
    CACHE = "cache"
    MESSAGE_QUEUE = "message_queue"


class NodeStatus(str, Enum):
    """Traffic-light health of a single component under the simulated load."""

    HEALTHY = "healthy"
    WARNING = "warning"
    CRITICAL = "critical"
    SATURATED = "saturated"


# --- Service rates (mu): requests one instance completes per second ---------

# An L7 load balancer does very little work per request -- parse headers, pick
# a backend, forward. It should almost never be the constraint, and if a user
# manages to saturate it that is itself an interesting lesson.
DEFAULT_LOAD_BALANCER_SERVICE_RATE_RPS = 50_000

# Application code: business logic, serialisation, some blocking I/O. The
# slowest tier per instance, but also the easiest one to scale horizontally,
# which is exactly the lesson we want a user to discover by adding replicas.
DEFAULT_APP_SERVER_SERVICE_RATE_RPS = 2_000

# Relational database with disk-backed storage. Harder to scale out than the
# app tier, so once the app tier is replicated this becomes the real wall --
# the moment a cache starts to look attractive.
DEFAULT_DATABASE_SERVICE_RATE_RPS = 5_000

# In-memory key-value store. Fast enough that it is rarely the constraint;
# its purpose in the model is to absorb load before it reaches the database.
DEFAULT_CACHE_SERVICE_RATE_RPS = 100_000

# Append-only log broker. Sequential writes are cheap.
DEFAULT_MESSAGE_QUEUE_SERVICE_RATE_RPS = 20_000

DEFAULT_SERVICE_RATES_RPS: dict[ComponentType, float] = {
    ComponentType.LOAD_BALANCER: DEFAULT_LOAD_BALANCER_SERVICE_RATE_RPS,
    ComponentType.APP_SERVER: DEFAULT_APP_SERVER_SERVICE_RATE_RPS,
    ComponentType.DATABASE: DEFAULT_DATABASE_SERVICE_RATE_RPS,
    ComponentType.CACHE: DEFAULT_CACHE_SERVICE_RATE_RPS,
    ComponentType.MESSAGE_QUEUE: DEFAULT_MESSAGE_QUEUE_SERVICE_RATE_RPS,
}


# --- Cache behaviour -------------------------------------------------------

# Fraction of requests served from cache, so the tier behind it only sees
# lambda * (1 - hit_ratio). 0.8 is a defensible default for a read-heavy
# workload and makes the "add a cache" before/after dramatic without being
# dishonest.
DEFAULT_CACHE_HIT_RATIO = 0.80


# --- Status thresholds -----------------------------------------------------

# Utilisation (rho) at which we start warning. At rho = 0.7 a request already
# spends ~3.3x its idle service time at the node, which is where queueing
# delay stops being noise and starts being felt.
UTILIZATION_WARNING_THRESHOLD = 0.70

# Above this the M/M/1 latency curve turns sharply upward (~6.7x idle service
# time at 0.85, ~10x at 0.9), so a small traffic increase causes a large
# latency increase. This is the "you are one bad day from an outage" band.
UTILIZATION_CRITICAL_THRESHOLD = 0.85

# At rho >= 1.0 arrivals meet or exceed service capacity: the queue grows
# without bound and latency is undefined rather than merely large. The engine
# treats this as a distinct failure state, never as a very big number.
UTILIZATION_SATURATED = 1.0


# --- Input guardrails ------------------------------------------------------

# Enforced at the API boundary so absurd input is rejected before it reaches
# the engine, rather than producing a plausible-looking but meaningless result.
MIN_REPLICAS = 1
MAX_REPLICAS = 1_000
MAX_TRAFFIC_RPS = 10_000_000.0

# Ceilings on design size. Not a modelling limit -- a design with hundreds of
# components stopped being a teaching aid long before this -- but a guard on a
# public endpoint, where an unbounded node list is an easy way to make the
# server do a great deal of work for one request.
MAX_NODES = 200
MAX_EDGES = 1_000

# An upper bound matters as much as the lower one: float('inf') satisfies
# gt=0, and an infinitely fast component would contribute exactly zero
# latency and could never be flagged as the bottleneck.
MAX_SERVICE_RATE_RPS = 10_000_000.0


# --- Unit conversion -------------------------------------------------------

# The queueing formulas work in seconds; the API reports milliseconds, because
# the interesting latencies in a healthy system are fractions of a second.
MILLISECONDS_PER_SECOND = 1000.0
