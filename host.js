// Host-side logic for the big screen view.
const socket = io();
const $ = (id) => document.getElementById(id);
const SHAPES = ['▲', '◆', '●', '■'];

const screens = {
  setup: $('screen-setup'),
  lobby: $('screen-lobby'),
  question: $('screen-question'),
  reveal: $('screen-reveal'),
  final: $('screen-final'),
};
function show(name) {
  Object.entries(screens).forEach(([k, el]) => el.classList.toggle('hidden', k !== name));
}

let countdownTimer = null;
let revealTimer = null;
let roomCode = null;
let questionsReady = false;
let playerCount = 0;

// --- Setup ---
$('btn-create').addEventListener('click', () => {
  const topic = $('topic').value.trim();
  const count = Number($('count').value);
  const difficulty = $('difficulty').value;
  if (!topic) {
    $('setup-error').textContent = 'Enter a topic.';
    return;
  }
  $('setup-error').textContent = '';
  $('btn-create').disabled = true;
  $('btn-create').textContent = 'Creating…';
  socket.emit('host:createRoom', { topic, count, difficulty }, (resp) => {
    if (!resp?.ok) {
      $('setup-error').textContent = resp?.error || 'Failed to create room';
      $('btn-create').disabled = false;
      $('btn-create').textContent = 'Create room';
      return;
    }
    roomCode = resp.code;
    $('room-code').textContent = resp.code;
    $('join-url').textContent = location.origin + '/player.html  •  code ' + resp.code;
    show('lobby');
  });
});

// --- Lobby ---
socket.on('host:questionsReady', ({ count }) => {
  questionsReady = true;
  $('questions-status').innerHTML = `${count} questions ready ✓`;
  updateStartButton();
});
socket.on('host:playerJoined', ({ name }) => {
  // animation handled via room:state list
});
socket.on('room:state', (state) => {
  playerCount = state.players.length;
  $('player-count').textContent = state.players.length;
  const list = $('player-list');
  list.innerHTML = '';
  state.players.forEach((p) => {
    const chip = document.createElement('div');
    chip.className = 'player-chip';
    chip.textContent = p.name;
    list.appendChild(chip);
  });
  updateStartButton();
});
function updateStartButton() {
  $('btn-start').disabled = !(questionsReady && playerCount > 0);
}
$('btn-start').addEventListener('click', () => {
  $('btn-start').disabled = true;
  socket.emit('host:startGame', {}, (resp) => {
    if (!resp?.ok) {
      $('lobby-error').textContent = resp?.error || 'Could not start';
      $('btn-start').disabled = false;
    }
  });
});

// --- Question screen ---
socket.on('question:start', ({ index, total, question, options, durationMs, startedAt }) => {
  show('question');
  $('q-index').textContent = index + 1;
  $('q-total').textContent = total;
  $('q-text').textContent = question;
  $('answer-progress').textContent = `0 / ${playerCount} answered`;

  const grid = $('answer-grid');
  grid.innerHTML = '';
  options.forEach((opt, i) => {
    const btn = document.createElement('div');
    btn.className = 'answer-btn';
    btn.setAttribute('data-color', String(i));
    btn.innerHTML = `<span class="shape">${SHAPES[i]}</span><span class="label">${escapeHtml(opt)}</span>`;
    grid.appendChild(btn);
  });

  startCountdown(durationMs, startedAt);
});
socket.on('host:answerProgress', ({ answered, totalPlayers }) => {
  $('answer-progress').textContent = `${answered} / ${totalPlayers} answered`;
});

function startCountdown(durationMs, startedAt) {
  clearInterval(countdownTimer);
  function tick() {
    const remaining = Math.max(0, Math.ceil((startedAt + durationMs - Date.now()) / 1000));
    $('q-timer').textContent = String(remaining);
    if (remaining <= 0) clearInterval(countdownTimer);
  }
  tick();
  countdownTimer = setInterval(tick, 200);
}

// --- Reveal ---
socket.on('question:reveal', ({ correctIndex, optionCounts, leaderboard }) => {
  clearInterval(countdownTimer);

  // Briefly stay on question view to flash correct answer
  const grid = $('answer-grid');
  if (grid) {
    Array.from(grid.children).forEach((el, i) => {
      el.classList.toggle('correct', i === correctIndex);
      el.classList.toggle('wrong', i !== correctIndex);
    });
  }

  setTimeout(() => {
    show('reveal');
    $('reveal-text').textContent =
      `Correct answer: ${SHAPES[correctIndex]}`;
    const total = optionCounts.reduce((a, b) => a + b, 0);
    $('reveal-counts').textContent =
      total > 0
        ? `Picks: ` +
          optionCounts.map((c, i) => `${SHAPES[i]} ${c}`).join('   ')
        : 'No one picked an answer.';
    renderLeaderboard($('reveal-leaderboard'), leaderboard, 'Leaderboard');

    let count = 5;
    $('reveal-countdown').textContent = count;
    clearInterval(revealTimer);
    revealTimer = setInterval(() => {
      count -= 1;
      $('reveal-countdown').textContent = Math.max(0, count);
      if (count <= 0) clearInterval(revealTimer);
    }, 1000);
  }, 1200);
});

// --- Final ---
socket.on('game:finished', ({ leaderboard, winner }) => {
  clearInterval(countdownTimer);
  clearInterval(revealTimer);
  show('final');
  renderPodium($('podium'), leaderboard);
  renderLeaderboard($('final-leaderboard'), leaderboard, 'Final standings');
});

socket.on('room:closed', () => {
  alert('Room closed.');
  location.href = '/';
});

// --- helpers ---
function renderLeaderboard(container, rows, title) {
  container.innerHTML = `<h3>${title}</h3>`;
  rows.slice(0, 10).forEach((row, i) => {
    const div = document.createElement('div');
    div.className = 'lb-row' + (i === 0 ? ' gold' : i === 1 ? ' silver' : i === 2 ? ' bronze' : '');
    div.innerHTML = `
      <span class="lb-rank">${i + 1}</span>
      <span class="lb-name">${escapeHtml(row.name)}</span>
      <span class="lb-score">${row.score} pts</span>
    `;
    container.appendChild(div);
  });
}

function renderPodium(container, rows) {
  container.innerHTML = '';
  const order = [1, 0, 2]; // visual order: 2nd, 1st, 3rd
  order.forEach((rankIdx) => {
    const r = rows[rankIdx];
    const div = document.createElement('div');
    div.className = 'podium-step ' + (rankIdx === 0 ? 'first' : rankIdx === 1 ? 'second' : 'third');
    div.innerHTML = r
      ? `<div class="medal">${['🥇','🥈','🥉'][rankIdx]}</div>
         <div class="who">${escapeHtml(r.name)}</div>
         <div class="pts">${r.score} pts</div>`
      : `<div class="medal">${['🥇','🥈','🥉'][rankIdx]}</div><div class="who">—</div>`;
    container.appendChild(div);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
