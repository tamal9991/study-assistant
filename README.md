# 📚 studybud

Upload your notes, ask questions about them, and let the AI quiz you. studybud
takes any document (PDF, Word, images, or plain text) and turns it into a study
buddy that answers your questions and makes quizzes to find your weak spots.

This guide works for both **Windows** and **macOS**. Follow it top to bottom —
it assumes you've never set the project up before. 🙂

## What's inside

- **Frontend:** React + Vite + Tailwind (the website you see)
- **Backend:** FastAPI (Python) — the API
- **Database:** PostgreSQL
- **AI:** OpenRouter (for answering questions and making quizzes)

```
modern-project/
├── backend/     # Python API (FastAPI)
└── frontend/    # React website (Vite)
```

---

## Before you start (install these)

| Tool           | Why you need it   | Get it                                             |
| -------------- | ----------------- | -------------------------------------------------- |
| Python 3.11+   | runs the backend  | https://www.python.org/downloads/                  |
| Node.js 18+    | runs the frontend | https://nodejs.org                                 |
| PostgreSQL 14+ | stores your data  | https://www.postgresql.org/download/               |
| OpenRouter key | powers the AI     | https://openrouter.ai/keys (free models available) |

**Optional:** if you want to upload **image** files, install Tesseract OCR:

- macOS: `brew install tesseract`
- Windows: download the installer from https://github.com/UB-Mannheim/tesseract/wiki

> Tip: while installing PostgreSQL on Windows, also install **pgAdmin** (comes
> with it) and make sure `psql` is added to your PATH so the commands below work.

---

## Step 1 — Create the database 🗄️

studybud needs its own database. Open a terminal and run these.

**macOS / Linux:**

```bash
# Create the user (role) that owns the database
psql -d postgres -c "CREATE ROLE study_user WITH LOGIN PASSWORD 'devpass';"

# Create the database
psql -d postgres -c "CREATE DATABASE studybud OWNER study_user;"
```

**Windows (PowerShell or Command Prompt):**

```powershell
psql -U postgres -c "CREATE ROLE study_user WITH LOGIN PASSWORD 'devpass';"
psql -U postgres -c "CREATE DATABASE studybud OWNER study_user;"
```

Check it worked:

```bash
psql -U postgres -c "\l studybud"
```

> Already have a `study_user`? Skip the first command.
> Whatever name/password you use here must match the `DATABASE_URL` in Step 2.

---

## Step 2 — Set up the backend ⚙️

Open a terminal in the project and go into the `backend` folder:

```bash
cd backend
```

**Create a virtual environment** (keeps Python packages tidy):

macOS / Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

Windows (PowerShell):

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
```

**Install the Python packages:**

```bash
pip install -r requirements.txt
```

**Set up your environment file.** Copy the example, then open `.env` and fill it in:

macOS / Linux:

```bash
cp .env.example .env
```

Windows (PowerShell):

```powershell
copy .env.example .env
```

Open `backend/.env` and set these:

```
DATABASE_URL=postgresql://study_user:devpass@localhost:5432/studybud
JWT_SECRET=<paste a long random string here>
OPENROUTER_API_KEY=<your OpenRouter key>
```

Need a `JWT_SECRET`? Run this and paste the output:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

**Create the tables** (this builds the database schema):

```bash
alembic upgrade head
```

**Start the backend:**

```bash
uvicorn app.main:app --reload --port 8000
```

Leave this running. The API is now at http://localhost:8000
(you can see all the endpoints at http://localhost:8000/docs).

---

## Step 3 — Set up the frontend 🎨

Open a **new** terminal (keep the backend running) and run:

```bash
cd frontend
npm install
npm run dev
```

It will print a link like `http://localhost:5173`. Open it in your browser and
you should see the studybud home page. 🎉

The frontend automatically sends API requests to the backend on port 8000, so
you don't need to configure anything else.

---

## Daily run (after the first setup)

Once everything is installed, you only need two terminals:

**Terminal 1 — backend:**

```bash
cd backend
source .venv/bin/activate      # Windows: .venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --port 8000
```

**Terminal 2 — frontend:**

```bash
cd frontend
npm run dev
```

---

## Settings (.env explained)

| Variable             | Required? | What it is                                    |
| -------------------- | --------- | --------------------------------------------- |
| `DATABASE_URL`       | ✅ yes    | how to connect to your Postgres database      |
| `JWT_SECRET`         | ✅ yes    | secret used to keep you logged in securely    |
| `JWT_ALGORITHM`      | optional  | defaults to `HS256`                           |
| `JWT_EXPIRE_MINUTES` | optional  | how long a login lasts (default 1440 = 1 day) |
| `OPENROUTER_API_KEY` | ✅ yes    | your AI key                                   |
| `OPENROUTER_MODEL`   | optional  | which AI model to use                         |

---

## If something breaks 🛠️

- **`psql: command not found`** → PostgreSQL isn't on your PATH. Reinstall it and
  tick the "add to PATH" option, or use pgAdmin to run the SQL from Step 1.
- **Backend won't start / database error** → double-check `DATABASE_URL` in
  `.env` matches the database name, user, and password from Step 1, and that
  PostgreSQL is actually running.
- **`.venv\Scripts\Activate.ps1` blocked on Windows** → run PowerShell as admin
  once and execute: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
- **Frontend loads but nothing works** → make sure the backend terminal is still
  running on port 8000.
- **Image upload fails** → install Tesseract OCR (see "Before you start").

---

## What you can do in the app

- **Sign up / log in** — your own account.
- **Upload notes** — PDF, Word, text, or images.
- **Chat** — ask questions about your documents. Each chat has its own URL, so
  refreshing keeps you in the same place.
- **Quiz yourself** — generate a quiz from your notes, answer it, and get a
  report showing which topics you're strong and weak on.
