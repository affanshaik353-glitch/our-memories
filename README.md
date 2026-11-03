# OUR MEMORIES

A responsive photo-gallery application built with vanilla HTML/CSS/JavaScript, FastAPI, and Supabase.

## Structure

```text
frontend/
  index.html
  admin.html
  style.css
  admin.css
  script.js
  admin.js
backend/
  app.py
  requirements.txt
  routes/
    authentication/
  database/
    schema.sql
```

The frontend is deployable to GitHub Pages. FastAPI must be deployed separately to a Python host because GitHub Pages cannot execute Python.

## Supabase setup

1. Create a Supabase project.
2. Run `backend/database/schema.sql` in the Supabase SQL editor.
3. Enable Realtime for `photos`, `albums`, `likes`, `comments`, and `website_themes`.
4. Create a public storage bucket named `memory-photos`.
5. Add the frontend Supabase URL and publishable/anon key under Supabase Authentication settings.

## Backend configuration

Copy the example below into the backend host environment variables:

```text
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_ANON_KEY=your_publishable_or_anon_key
ADMIN_ID=OURWORLD123
ADMIN_PASSWORD=OUR_WORLD_123@
SESSION_SECRET=a-long-random-secret
FRONTEND_URL=https://YOUR_GITHUB_USERNAME.github.io
SESSION_COOKIE_SECURE=true
```

Generate a secure session secret with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

The admin account is created securely by the backend from `ADMIN_ID` and `ADMIN_PASSWORD`; the credentials are never bundled in frontend files.

## Local development

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate
pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```

Serve the frontend from its folder, for example:

```bash
cd frontend
python -m http.server 5500
```

Set the backend API URL in `frontend/config.js` (also configure `FRONTEND_URL` for that Pages origin).

## Production API URL

Set `API_URL` in both frontend JavaScript files to the HTTPS URL of the deployed backend, without a trailing slash.
The same URL can also be supplied by deploying JavaScript below a generated config endpoint? No credentials are required in the frontend.

Example:

```javascript
const API_URL = "https://our-memories-api.example.com";
```

## GitHub and GitHub Pages

```bash
git init
git add .
git commit -m "Create OUR MEMORIES"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/our-memories.git
git push -u origin main
```

In GitHub repository Settings > Pages, select Deploy from branch, choose `main`, and set the folder to `/frontend`.

## Backend hosting

Deploy `backend/` to Render, Railway, Fly.io, or a similar FastAPI host. Use:

```text
Build: pip install -r requirements.txt
Start: uvicorn app:app --host 0.0.0.0 --port $PORT
```

Configure every environment variable above and set `FRONTEND_URL` to the exact GitHub Pages origin.
