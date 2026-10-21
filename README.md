# Meeting Copilot Live MVP

A mobile-friendly web prototype that uses browser speech recognition to display a transcript, detect likely questions, and request suggested answers from a FastAPI backend. It supports a user-provided bio/keyword profile and PDF, DOCX, or TXT resume text extraction for personalized answer suggestions.

## Important limitations

- Microphone/speech recognition starts only after the user taps **Start listening**. Browsers generally require a user gesture before starting microphone-related features; this app does not silently activate the microphone on page load.
- The browser Web Speech API is not supported consistently across all browsers/devices. Chrome on Android may support it, but availability and behavior can change.
- Browser speech recognition may transmit audio to the browser vendor's speech service. This app does not store audio recordings, but it does send detected question text and a short transcript context to the configured AI API.
- Use only with required participant consent and employer approval. Do not process confidential meetings through unapproved services.
- Resume text is extracted in memory by the backend and returned to the browser; it is not written to disk by this endpoint. The profile stays in page state and is sent with each answer request to the backend and configured AI provider. Clear it when finished.
- The MVP is not production-hardened. Its in-memory rate limit is basic and resets on restart. Add authentication, robust rate limiting, monitoring, and privacy controls before public use.
- Render free instances may sleep after inactivity; first response can be slow. AI API quotas vary.
- This app suggests answers; it does not join Teams, access Teams chat, or guarantee that every question is detected.

## Stack

- Frontend: React + TypeScript + Vite
- Backend: FastAPI + HTTPX
- AI: Groq-compatible chat completions endpoint

## Prerequisites

- Python 3.11+
- Node.js LTS
- Git
- A Groq API key and a model currently available to your account

## Run locally on Windows PowerShell

### 1. Backend

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `backend/.env` and set `GROQ_API_KEY`, `GROQ_MODEL`, and `FRONTEND_ORIGINS`.

Run:

```powershell
uvicorn main:app --reload --port 8000
```

Health check: http://localhost:8000/health

### 2. Frontend

Open a second terminal from the project root:

```powershell
cd frontend
Copy-Item .env.example .env.local
npm install
npm run dev
```

Open the URL Vite prints, normally http://localhost:5173.

The frontend defaults to `http://localhost:8000` if `VITE_API_URL` is not set.

## Deploy backend to Render

Create a new Web Service from this GitHub repository.

- Root Directory: `backend`
- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Instance: Free, if available in your account

Set environment variables in Render:

- `GROQ_API_KEY`: your secret key
- `GROQ_MODEL`: a model ID currently available to your account
- `FRONTEND_ORIGINS`: your exact deployed Cloudflare Pages origin, e.g. `https://your-project.pages.dev`

Do not commit `.env` or put your AI key in the frontend.

## Deploy frontend to Cloudflare Pages

Import the repository into Cloudflare Pages.

- Root directory: `frontend`
- Build command: `npm run build`
- Build output directory: `dist`

Set this build environment variable:

- `VITE_API_URL`: your Render service URL, e.g. `https://your-service.onrender.com`

Redeploy after changing frontend environment variables.

## Deployment test

1. Open `https://YOUR-RENDER-SERVICE.onrender.com/health` and expect `{"status":"ok"}`.
2. Open the deployed Pages URL on your phone.
3. Tap **Start listening** and respond to the browser's permission prompt.
4. Test with a non-confidential practice conversation. A finalized utterance that looks like a question should create a suggested answer.
5. Test manual question entry.
6. Test on the exact phone/browser you plan to use. If speech recognition is unsupported, use manual question entry or add a separately approved transcription service.

## Production security checklist

- Require user authentication or another server-verified access control before exposing a public AI endpoint.
- Add robust rate limiting and usage limits.
- Review the speech recognition provider's data processing and retention terms.
- Obtain permission before capturing real meeting audio.
- Do not save transcripts by default.
- Never put API keys in browser code or Git.
