# Dev commands & when to run them

Purpose: concise, copy-paste commands and a quick decision guide for rebuilding/restarting services when you change files in this repository.

Decision matrix (short):
- Change backend Python source (.py) or its dependencies (`pyproject.toml`, `requirements.txt`): rebuild `backend` image.
- Change frontend source (.ts, .tsx, React components) or frontend deps (`package.json`): rebuild `frontend` image.
- Change Dockerfile, build args, or base images: rebuild affected image(s).
- Change Celery task code or Celery worker deps: rebuild `celery-worker` (same image as `backend`).
- Change SQL in `postgres-init/`: to re-run, you must recreate DB volumes (down -v) because init scripts only run on fresh DB.
- Change only env/config (no code): restart containers (no `--build` needed).

Commands (run from `src/`):

- Rebuild & recreate only backend + frontend (recommended when both changed):
```bash
docker compose up --build -d backend frontend
```

- Build images first, then start (two-step):
```bash
docker compose build backend frontend
docker compose up -d backend frontend
```

- Rebuild and start a single service (example: backend):
```bash
docker compose up --build -d backend
```

- Rebuild backend + celery worker (when worker code/deps changed):
```bash
docker compose up --build -d backend celery-worker
```

- Full rebuild of all services (use when Dockerfiles or base images change):
```bash
docker compose up --build -d
```

- Quick restart without rebuilding (picks up env/config but not code):
```bash
docker compose restart backend frontend
```

- Tear down and remove volumes (use when you need a fresh DB to re-run `postgres-init`):
```bash
docker compose down -v
docker compose up --build -d
```

Local development (fast feedback loop — avoid rebuilding Docker images each change):
- Frontend (hot reload):
```bash
cd src/frontend
npm install
npm run dev
```
- Backend (autoreload):
```bash
cd src/backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
When running locally, set env vars or use `.env` so the frontend can reach your backend (e.g. `NEXT_PUBLIC_API_URL=http://localhost:8000/api`).

Tests & linters (use after changes):
- Backend unit tests:
```bash
cd src/backend
pytest -v
ruff check .
```
- Frontend lint & tests:
```bash
cd src/frontend
npm run lint
npx vitest run
```

File-type quick rules
- Backend Python (.py): rebuild `backend` image (or run locally with `uvicorn --reload`).
- Backend deps (`pyproject.toml`, `requirements.txt`): rebuild `backend` image.
- Frontend TS/TSX (.ts/.tsx) or assets in `src/frontend/src`: rebuild `frontend` image (or run `npm run dev` locally).
- Frontend deps (`package.json`, lockfile): rebuild `frontend` image.
- Dockerfile changes: rebuild affected images (use full `--build`).
- SQL in `postgres-init/`: to apply new init SQL, recreate DB volumes (`down -v`) and bring stack up.
- Static files under `frontend/public/`: if not volume-mounted, rebuild `frontend` to include changes in image.

Examples (typical workflows)
- I changed only React components and want fast feedback: run frontend locally with `npm run dev`.
- I changed backend Python and want Dockerized run: `docker compose up --build -d backend`.
- I changed frontend + backend and want both running in Docker: `docker compose up --build -d backend frontend`.
- I added a new DB bootstrap SQL and want it to run: `docker compose down -v && docker compose up --build -d`.

Short best-practices
- For local dev prefer running services locally (hot-reload) to avoid rebuilds.
- If using Docker Compose images in development, treat `--build` as required when you change source or dependencies.
- Keep `backend` and `celery-worker` builds together if they share the same Dockerfile, to avoid mismatched images.

If you want, I can add `make` shortcuts or npm scripts to the repo to simplify the most common commands.
