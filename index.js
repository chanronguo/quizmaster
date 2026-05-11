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
const rooms = new Map();

function newRoomCode() {
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

  // Reset per-question answer log on each player and snapshot rank at start.
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
  room.timers.question = setTimeout
