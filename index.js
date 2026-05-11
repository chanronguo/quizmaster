// QuizMaster — Kahoot-style live quiz website.
// Express serves the static frontend; Socket.IO handles the real-time game.

require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { generateQuestions, PROVIDER } = require('./ai');

const PORT = Number(process.env.PORT) || 3000;
const QUESTION_DURATION_MS = 20_000; // 20s per question
const REVEAL_DURATION_MS = 5_000;    // 5s to show correct answer + scoreboard
const MAX_PLAYERS = 64;
const MAX_NAME_LEN = 16;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(__dirname));

// ---------- In-memory room store ----------
// rooms[code] = {
//   code, hostSocketId, status: 'lobby'|'loading'|'question'|'reveal'|'finished',
//   players: { [socketId]: { id, name, score, answers: [{questionIndex, optionIndex, ms, correct}] } },
//   questions: [{question, options, correctIndex}],
//   currentIndex: -1,
//   questionStartedAt: number,
//   timers: { question, reveal },
// }
const rooms = new Map();

function newRoomCode() {
  // 6-character uppercase code, no confusing chars (no 0/O, 1/I)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function publicRoomState(room) {
  return {
    code: room.code,
    status: room.status,
    playerCount: Object.keys(room.players).length,
    players: Object.values(room.players).map((p) => ({ id: p.id, name: p.name, score: p.score })),
    currentIndex: room.currentIndex,
    totalQuestions: room.questions.length,
  };
}

function leaderboard(room) {
  return Object.values(room.players)
    .map((p) => ({ id: p.id, name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

// Compute rank context for a player: their rank, neighbour above, neighbour below.
function rankContextFor(room, playerId) {
  const sorted = leaderboard(room);
  const idx = sorted.findIndex((p) => p.id === playerId);
  if (idx < 0) return null;
  const me = sorted[idx];
  return {
    rank: idx + 1,
    total: sorted.length,
    me: { name: me.name, score: me.score },
    above: idx > 0 ? { rank: idx, name: sorted[idx - 1].name, score: sorted[idx - 1].score } : null,
    below: idx < sorted.length - 1
      ? { rank: idx + 2, name: sorted[idx + 1].name, score: sorted[idx + 1].score }
      : null,
  };
}

function clearRoomTimers(room) {
  if (room.timers?.question) clearTimeout(room.timers.question);
  if (room.timers?.reveal) clearTimeout(room.timers.reveal);
  room.timers = {};
}

function destroyRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  clearRoomTimers(room);
  io.to(`room:${code}`).emit('room:closed');
  rooms.delete(code);
  console.log(`[room ${code}] destroyed`);
}

// ---------- Game flow ----------
function startNextQuestion(code) {
  const room = rooms.get(code);
  if (!room) return;
  room.currentIndex += 1;

  if (room.currentIndex >= room.questions.length) {
    finishGame(code);
    return;
  }

  const q = room.questions[room.currentIndex];
  room.status = 'question';
  room.questionStartedAt = Date.now();

  // Reset per-question answer log on each player so we know who answered.
  // Also snapshot each player's rank at the START of this question so we can show
  // how their rank changed after they answer.
  const sortedAtStart = leaderboard(room);
  Object.values(room.players).forEach((p) => {
    p.currentAnswer = null;
    const idx = sortedAtStart.findIndex((x) => x.id === p.id);
    p.questionStartRank = idx + 1;
  });

  const payload = {
    index: room.currentIndex,
    total: room.questions.length,
    question: q.question,
    options: q.options,
    durationMs: QUESTION_DURATION_MS,
    startedAt: room.questionStartedAt,
  };
  io.to(`room:${code}`).emit('question:start', payload);
  console.log(`[room ${code}] question ${room.currentIndex + 1}/${room.questions.length}`);

  clearRoomTimers(room);
  room.timers.question = setTimeout(() => revealAnswer(code), QUESTION_DURATION_MS);
}

function revealAnswer(code) {
  const room = rooms.get(code);
  if (!room) return;
  const q = room.questions[room.currentIndex];
  if (!q) return;
  room.status = 'reveal';

  // Tally per-option counts for the host display
  const optionCounts = [0, 0, 0, 0];
  Object.values(room.players).forEach((p) => {
    if (p.currentAnswer && Number.isInteger(p.currentAnswer.optionIndex)) {
      optionCounts[p.currentAnswer.optionIndex] += 1;
    }
  });

  io.to(`room:${code}`).emit('question:reveal', {
    index: room.currentIndex,
    correctIndex: q.correctIndex,
    optionCounts,
    leaderboard: leaderboard(room).slice(0, 10),
  });

  // Send each player a FINAL rank update so their rank-context card reflects
  // everyone's answers (including players who answered after them).
  Object.values(room.players).forEach((p) => {
    io.to(p.id).emit('player:rankUpdate', {
      index: room.currentIndex,
      rankContext: rankContextFor(room, p.id),
    });
  });

  clearRoomTimers(room);
  room.timers.reveal = setTimeout(() => startNextQuestion(code), REVEAL_DURATION_MS);
}

function finishGame(code) {
  const room = rooms.get(code);
  if (!room) return;
  room.status = 'finished';
  clearRoomTimers(room);
  const final = leaderboard(room);
  io.to(`room:${code}`).emit('game:finished', {
    leaderboard: final,
    winner: final[0] || null,
  });
  console.log(`[room ${code}] finished — winner: ${final[0]?.name || 'nobody'}`);
}

function scoreFor(timeTakenMs) {
  // Kahoot-style scoring: 1000 base, scaled down by how long they took.
  // Answer at t=0 → 1000 pts, at t=duration → 500 pts. Wrong = 0.
  const fraction = Math.max(0, Math.min(1, timeTakenMs / QUESTION_DURATION_MS));
  return Math.round(1000 - 500 * fraction);
}

// ---------- Socket handlers ----------
io.on('connection', (socket) => {
  // ----- Host creates a room -----
  socket.on('host:createRoom', async (opts, ack) => {
    try {
      const topic = String(opts?.topic || '').trim() || 'general knowledge';
      const count = Math.max(3, Math.min(15, Number(opts?.count) || 5));
      const difficulty = ['easy', 'medium', 'hard'].includes(opts?.difficulty)
        ? opts.difficulty
        : 'medium';

      const code = newRoomCode();
      const room = {
        code,
        hostSocketId: socket.id,
        status: 'loading',
        players: {},
        questions: [],
        currentIndex: -1,
        questionStartedAt: 0,
        timers: {},
        config: { topic, count, difficulty },
      };
      rooms.set(code, room);
      socket.join(`room:${code}`);
      socket.data.role = 'host';
      socket.data.roomCode = code;

      ack?.({ ok: true, code, status: 'loading' });
      io.to(socket.id).emit('host:roomCreated', { code, config: room.config });

      // Generate questions in background
      const questions = await generateQuestions({ topic, count, difficulty });
      const stillExists = rooms.get(code);
      if (!stillExists) return; // Host disconnected before questions came back
      stillExists.questions = questions;
      stillExists.status = 'lobby';
      io.to(`room:${code}`).emit('room:state', publicRoomState(stillExists));
      io.to(socket.id).emit('host:questionsReady', { count: questions.length });
      console.log(`[room ${code}] ready (${questions.length} questions on "${topic}")`);
    } catch (err) {
      console.error('host:createRoom error', err);
      ack?.({ ok: false, error: err.message });
    }
  });

  // ----- Host starts the game -----
  socket.on('host:startGame', (_, ack) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || room.hostSocketId !== socket.id) return ack?.({ ok: false, error: 'Not host' });
    if (room.status !== 'lobby') return ack?.({ ok: false, error: 'Game already started' });
    if (Object.keys(room.players).length === 0) return ack?.({ ok: false, error: 'No players yet' });
    if (room.questions.length === 0) return ack?.({ ok: false, error: 'Questions not ready' });
    ack?.({ ok: true });
    startNextQuestion(code);
  });

  // ----- Host ends room early -----
  socket.on('host:endGame', (_, ack) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || room.hostSocketId !== socket.id) return ack?.({ ok: false });
    finishGame(code);
    ack?.({ ok: true });
  });

  // ----- Player joins -----
  socket.on('player:join', ({ code, name } = {}, ack) => {
    code = String(code || '').toUpperCase().trim();
    name = String(name || '').trim().slice(0, MAX_NAME_LEN);
    if (!code || !name) return ack?.({ ok: false, error: 'Code and name required' });

    const room = rooms.get(code);
    if (!room) return ack?.({ ok: false, error: 'Room not found' });
    if (room.status !== 'lobby' && room.status !== 'loading')
      return ack?.({ ok: false, error: 'Game already started' });
    if (Object.keys(room.players).length >= MAX_PLAYERS)
      return ack?.({ ok: false, error: 'Room is full' });
    const nameTaken = Object.values(room.players).some(
      (p) => p.name.toLowerCase() === name.toLowerCase()
    );
    if (nameTaken) return ack?.({ ok: false, error: 'Name already taken in this room' });

    room.players[socket.id] = {
      id: socket.id,
      name,
      score: 0,
      currentAnswer: null,
    };
    socket.join(`room:${code}`);
    socket.data.role = 'player';
    socket.data.roomCode = code;

    ack?.({ ok: true, code, name, status: room.status });
    io.to(`room:${code}`).emit('room:state', publicRoomState(room));
    io.to(room.hostSocketId).emit('host:playerJoined', { id: socket.id, name });
    console.log(`[room ${code}] player joined: ${name}`);
  });

  // ----- Player submits an answer -----
  socket.on('player:answer', ({ index, optionIndex } = {}, ack) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || room.status !== 'question') return ack?.({ ok: false });
    const player = room.players[socket.id];
    if (!player) return ack?.({ ok: false });
    if (index !== room.currentIndex) return ack?.({ ok: false });
    if (player.currentAnswer) return ack?.({ ok: false, error: 'Already answered' });
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 3)
      return ack?.({ ok: false });

    const ms = Date.now() - room.questionStartedAt;
    const q = room.questions[room.currentIndex];
    const correct = optionIndex === q.correctIndex;
    const points = correct ? scoreFor(ms) : 0;
    player.currentAnswer = { optionIndex, ms, correct, points };
    player.score += points;

    ack?.({ ok: true, points });

    // INSTANT result for the answering player — show correct/wrong + rank context.
    const rankContext = rankContextFor(room, socket.id);
    io.to(socket.id).emit('player:result', {
      index: room.currentIndex,
      correct,
      points,
      score: player.score,
      yourOption: optionIndex,
      correctIndex: q.correctIndex,
      correctOption: q.options[q.correctIndex],
      prevRank: player.questionStartRank || rankContext.rank,
      rankContext,
    });

    // Tell host how many have answered (for "X of Y answered")
    const totalPlayers = Object.keys(room.players).length;
    const answered = Object.values(room.players).filter((p) => p.currentAnswer).length;
    io.to(room.hostSocketId).emit('host:answerProgress', { answered, totalPlayers });

    // If everyone answered, reveal early
    if (answered >= totalPlayers) {
      clearRoomTimers(room);
      // Small delay so the last answerer sees their tap register
      room.timers.question = setTimeout(() => revealAnswer(code), 400);
    }
  });

  // ----- Disconnect -----
  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    if (socket.data.role === 'host') {
      console.log(`[room ${code}] host disconnected, closing room`);
      destroyRoom(code);
      return;
    }
    if (room.players[socket.id]) {
      const name = room.players[socket.id].name;
      delete room.players[socket.id];
      io.to(`room:${code}`).emit('room:state', publicRoomState(room));
      io.to(room.hostSocketId).emit('host:playerLeft', { id: socket.id, name });
      console.log(`[room ${code}] player left: ${name}`);
    }
  });
});

// Health check
app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: rooms.size, provider: PROVIDER }));

server.listen(PORT, () => {
  console.log(`\nQuizMaster running at http://localhost:${PORT}`);
  console.log(`AI provider: ${PROVIDER}`);
  console.log(`Open the URL above to host a game; share the room code with players.\n`);
});
