# Production image for the FastAPI backend.
#
# Railway builds this automatically when the service's root directory is
# `backend/`; Fly.io, Render or a plain `docker run` work the same way. The
# platform injects PORT and the app binds to it, so nothing here is Railway-
# specific.
#
# Pinned to the 3.12 line the project is developed and tested against -- the
# venv in the README is 3.12 too, so the container never runs an interpreter
# the test suite has not seen.
FROM python:3.12-slim

# No .pyc litter in the image, and stdout/stderr flushed straight to the
# platform's log stream rather than buffered -- buffered logs are the kind that
# go missing exactly when a deploy is failing.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencies on their own layer, before the source: they change far less
# often, so a code-only push reuses the cached install instead of redoing it.
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app

# Nothing needs root once the install is done.
RUN useradd --system --no-create-home --shell /usr/sbin/nologin appuser
USER appuser

# Railway sets PORT to the port its domain targets (detected from EXPOSE); the
# default only matters for a local `docker run -p 8000:8000`.
ENV PORT=8000
EXPOSE 8000

# `exec` makes uvicorn PID 1, so the platform's SIGTERM reaches it directly and
# a redeploy shuts the old container down cleanly instead of waiting to be
# killed. Shell form is needed for the ${PORT} expansion.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
