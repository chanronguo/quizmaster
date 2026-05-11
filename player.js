// Player-side logic — runs on phones/laptops of people joining a room.
const socket = io();
const $ = (id) => document.getElementById(id);
const SHAPES = ['▲', '◆', '●', '■'];

const screens = {
  join: $('screen-join'),
  wait: $('screen-wait'),
  answer: $('screen-answer'),
  waited: $('screen-waited'),
  result: $('screen-result'),
  final: $('screen-final'),
};
function show(name) {
  Object.entries(screens).forEach(([k, el]) => el.classList.toggle('hidden', k !== name));
}

let myScore = 0;
let countdownTimer = null;
let myAnswered = false;

// Allow pre-filling room code from URL: /player.html?code=ABCDEF
const urlCode = new URLSearchParams(location.search).get('code');
if (urlCode) $('code').value = urlCode.toUpperCase();

// --- Join ---
$('btn-join').addEventListener('click', joinRoom);
$('code').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase();
});
$('name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom();
});

function joinRoom() {
  const code = $('code').value.trim().toUpperCase();
  const name = $('name').value.trim();
  if (!code || !name) {
    $('join-error').textContent = 'Enter a room code and a nickname.';
    return;
  }
  $('join-error').textContent = '';
  $('btn-join').disabled = true;
  $('btn-join').textContent = 'Joining…';
  socket.emit('player:join', { code, name }, (resp) => {
    $('btn-join').disabled = false;
    $('btn-join').textContent = 'Join';
    if (!resp?.ok) {
      $('join-error').textContent = resp?.error || 'Could not join';
      return;
    }
    $('wait-name').textContent = resp.name;
    $('wait-code').textContent = resp.code;
    show('wait');
  });
}

// --- Question ---
socket.on('question:start', ({ index, total, question, options, durationMs, startedAt }) => {
  myAnswered = false;
  show('answer');
  $('p-index').textContent = index + 1;
  $('p-total').textContent = total;
  $('p-score').textContent = `Score: ${myScore}`;
  $('p-prompt').textContent = question || 'Pick your answer!';

  const grid = $('answer-grid');
  grid.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const btn = document.createElement('button');
    btn.className = 'answer-btn';
    btn.setAttribute('data-color', String(i));
    const label = (options && options[i]) ? options[i] : '';
    btn.innerHTML = `<span class="shape">${SHAPES[i]}</span><span class="label">${escapeHtml(label)}</span>`;
    btn.addEventListener('click', () => submitAnswer(index, i));
    grid.appendChild(btn);
  }

  startCountdown(durationMs, startedAt);
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function startCountdown(durationMs, startedAt) {
  clearInterval(countdownTimer);
  function tick() {
    const remaining = Math.max(0, Math.ceil((startedAt + durationMs - Date.now()) / 1000));
    $('p-timer').textContent = String(remaining);
    if (remaining <= 0) clearInterval(countdownTimer);
  }
  tick();
  countdownTimer = setInterval(tick, 200);
}

function submitAnswer(index, optionIndex) {
  if (myAnswered) return;
  myAnswered = true;
  // Visually lock buttons
  Array.from($('answer-grid').children).forEach((el, i) => {
    el.disabled = true;
    if (i !== optionIndex) el.style.opacity = '0.35';
  });
  socket.emit('player:answer', { index, optionIndex }, (resp) => {
    if (!resp?.ok) {
      // re-enable on error
      myAnswered = false;
      Array.from($('answer-grid').children).forEach((el) => {
        el.disabled = false;
        el.style.opacity = '';
      });
      return;
    }
    show('waited');
  });
}

// --- Result ---
socket.on('player:result', ({ correct, score, rank }) => {
  myScore = score;
  show('result');
  const banner = $('result-banner');
  banner.classList.toggle('correct', correct);
  banner.classList.toggle('wrong', !correct);
  $('result-title').textContent = correct ? '✅ Correct!' : '❌ Not this time';
  $('result-sub').textContent = correct
    ? 'Nice — points added to your total.'
    : 'Better luck next question!';
  $('result-rank').textContent = rank > 0 ? `#${rank}` : '—';
  $('result-score').textContent = score;
});

// --- Final ---
socket.on('game:finished', ({ leaderboard }) => {
  clearInterval(countdownTimer);
  show('final');
  const me = leaderboard.find((p) => p.id === socket.id);
  const rank = me ? leaderboard.indexOf(me) + 1 : null;
  if (rank === 1) {
    $('final-title').textContent = '🏆 You won!';
  } else if (rank && rank <= 3) {
    $('final-title').textContent = `🎉 You finished #${rank}!`;
  } else if (rank) {
    $('final-title').textContent = `Game over — #${rank}`;
  } else {
    $('final-title').textContent = 'Game over';
  }
  $('final-rank-text').textContent = rank
    ? `You placed #${rank} out of ${leaderboard.length}`
    : 'Thanks for playing!';
  $('final-score').textContent = me?.score ?? myScore;
});

socket.on('room:closed', () => {
  alert('The host ended the room.');
  location.href = '/';
});

socket.on('disconnect', () => {
  // Don't redirect on transient blips — only on explicit close.
});
