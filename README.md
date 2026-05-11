# QuizMaster

A Kahoot-style **live quiz website** with AI-generated questions. The host opens the site on a big screen; players join from any phone or laptop browser with a room code. No app install needed.

## Features

- **Live multiplayer** via WebSockets (Socket.IO) — real-time room codes, answers, scoreboards.
- **AI-generated questions** — host enters a topic, AI writes fresh multiple-choice questions on demand. Works with Anthropic Claude, OpenAI, or a built-in mock provider (no API key needed for testing).
- **Kahoot-style scoring** — faster correct answers earn more points (1000 → 500 based on response time).
- **Live leaderboard** between every question, plus a final podium for the top 3.
- **Mobile-friendly** player UI with big colored answer buttons (▲ ◆ ● ■).
- **Up to 64 players** per room.

## Project layout

```
quizmaster/
├── package.json
├── .env.example          → copy to .env and fill in
├── server/
│   ├── index.js          → Express + Socket.IO server
│   └── ai.js             → AI question generator (Claude / OpenAI / mock)
└── public/
    ├── index.html        → landing page (Host or Join)
    ├── host.html / .js   → host's big-screen view
    ├── player.html / .js → player view (mobile-friendly)
    └── styles.css
```

## Run it locally

You need **Node.js 18+** installed.

```bash
cd quizmaster
npm install
cp .env.example .env       # edit if you want real AI questions
npm start
```

Then open `http://localhost:3000` in your browser. The host clicks **Host a new quiz**; other players visit the same URL on their phones and click **Join with a code**.

### AI provider options

Open `.env` and set:

| `AI_PROVIDER` | What it does |
|---|---|
| `mock` (default) | Returns canned placeholder questions. No API key needed. Use for testing the UI. |
| `anthropic` | Calls Claude. Set `ANTHROPIC_API_KEY`. Get a key at [console.anthropic.com](https://console.anthropic.com). |
| `openai` | Calls OpenAI. Set `OPENAI_API_KEY`. |

If a real provider fails (bad key, rate limit, etc.) the server falls back to mock questions automatically so the game still runs.

## Letting friends play over the internet

For a quick share, run [ngrok](https://ngrok.com/) alongside your local server:

```bash
ngrok http 3000
```

Share the `https://…ngrok-free.app` URL with your friends. They go to that URL on their phone, click **Join with a code**, enter the code shown on your screen, and they're in.

## Deploy to a real host

This is a standard Node.js + WebSockets app. It deploys cleanly to anything that supports long-lived TCP connections:

- **Render.com** — set build command `npm install`, start command `npm start`. Add `AI_PROVIDER` and `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) in the dashboard.
- **Railway / Fly.io / Heroku** — same deal, set env vars in the dashboard.
- **VPS** — `npm install && npm start`, put nginx in front, point a domain at it.

**Heads up:** serverless platforms (Vercel/Netlify functions) don't work well here because Socket.IO needs a persistent connection. Use a "regular" Node host.

## How a game flows

1. **Host** opens `/` → **Host a new quiz** → enters a topic + question count + difficulty → clicks **Create room**. AI generates the questions in the background.
2. Host gets a **6-letter room code** on a big screen.
3. **Players** open the same site on phones → **Join with a code** → enter code + nickname → land in the lobby.
4. Once questions are ready and at least one player has joined, host clicks **Start game**.
5. Each question shows for **20 seconds**. Players tap a colored button. Faster correct answers = more points.
6. Between questions, everyone sees a **leaderboard**.
7. After the last question, a **winner podium** appears.

## Tuning

Edit constants at the top of `server/index.js`:

- `QUESTION_DURATION_MS` — time per question (default 20s)
- `REVEAL_DURATION_MS` — time on the between-question leaderboard (default 5s)
- `MAX_PLAYERS` — max per room (default 64)

## Tech

- Backend: **Node.js**, **Express**, **Socket.IO**
- Frontend: plain **HTML/CSS/JS** (no build step)
- AI: **Anthropic Claude** or **OpenAI**, with a mock fallback

## License

MIT — do what you want with it.
