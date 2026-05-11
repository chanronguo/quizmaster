// Host-side logic for the big screen view.
const socket = io();
const $ = (id) => document.getElementById(id);
const SHAPES = ['▲', '◆', '●', '■'];
const COLORS = ['#e21b3c', '#1368ce', '#d89e00', '#26890c'];

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
    music.start('lobby');
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
  music.setMood('question');
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
  music.setMood('reveal');

  // Flash correct answer on question buttons
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
  music.setMood('final');
  renderPodium($('podium'), leaderboard);
  renderBarChart($('final-barchart'), leaderboard);
});

socket.on('room:closed', () => {
  music.stop();
  alert('Room closed.');
  location.href = '/';
});

// --- helpers ---
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

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

function renderBarChart(container, rows) {
  container.innerHTML = '<h3>Final standings</h3>';
  if (!rows || rows.length === 0) return;
  const maxScore = Math.max(...rows.map((r) => r.score), 1);
  rows.forEach((row, i) => {
    const pct = (row.score / maxScore) * 100;
    const bar = document.createElement('div');
    bar.className = 'bar-row' + (i === 0 ? ' gold' : i === 1 ? ' silver' : i === 2 ? ' bronze' : '');
    bar.innerHTML = `
      <span class="bar-rank">#${i + 1}</span>
      <span class="bar-name">${escapeHtml(row.name)}</span>
      <div class="bar-track">
        <div class="bar-fill" style="width:0%">
          <span class="bar-score">${row.score}</span>
        </div>
      </div>
    `;
    container.appendChild(bar);
    // Animate the bar width after a tiny delay so the transition runs
    requestAnimationFrame(() => {
      bar.querySelector('.bar-fill').style.width = pct + '%';
    });
  });
}

// =================================================================
// Procedural happy music (Web Audio API)
// =================================================================
const music = (() => {
  let ctx = null;
  let master = null;
  let playing = false;
  let timer = null;
  let beat = 0;
  let mood = 'lobby';
  let userWantsMusic = false;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.07;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  function freq(note) {
    if (note === '-' || !note) return 0;
    const notes = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    const m = note.match(/^([A-G])(#|b)?(-?\d+)$/);
    if (!m) return 440;
    let s = notes[m[1]];
    if (m[2] === '#') s += 1;
    if (m[2] === 'b') s -= 1;
    return 440 * Math.pow(2, (s + (parseInt(m[3]) - 4) * 12 - 9) / 12);
  }

  function tone(f, when, dur, vol = 1, type = 'triangle') {
    if (!f) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = f;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.35 * vol, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    osc.connect(g).connect(master);
    osc.start(when);
    osc.stop(when + dur + 0.1);
  }

  const TUNES = {
    lobby:    { tempo: 96,  mel: ['C4','E4','G4','E4','F4','A4','G4','E4','D4','F4','A4','F4','C4','E4','G4','C5'] },
    question: { tempo: 132, mel: ['C4','E4','G4','C5','G4','E4','C4','E4','D4','F4','A4','D5','A4','F4','D4','F4'] },
    reveal:   { tempo: 84,  mel: ['G4','-','E4','-','C4','-','-','-','F4','-','D4','-','G4','-','C5','-'] },
    final:    { tempo: 120, mel: ['C5','E5','G5','C5','D5','F5','A5','D5','E5','G5','B5','E5','C5','G5','C6','-'] },
  };

  function schedule() {
    if (!playing || !ctx) return;
    const tune = TUNES[mood] || TUNES.lobby;
    const beatDur = 60 / tune.tempo / 2;
    const note = tune.mel[beat % tune.mel.length];
    const when = ctx.currentTime + 0.05;
    if (note !== '-') {
      tone(freq(note), when, beatDur * 0.9, 1, 'triangle');
      if (beat % 4 === 0) {
        const lower = note.replace(/(\d+)/, (d) => Math.max(1, parseInt(d) - 2));
        tone(freq(lower), when, beatDur * 2, 0.5, 'sine');
      }
    }
    beat++;
    timer = setTimeout(schedule, beatDur * 1000);
  }

  function updateButton() {
    const btn = document.getElementById('music-btn');
    if (btn) btn.textContent = playing ? '🔊' : '🔇';
  }

  return {
    start(m) {
      userWantsMusic = true;
      if (!ensure()) return;
      mood = m || mood;
      if (playing) return;
      playing = true;
      schedule();
      updateButton();
    },
    stop() {
      userWantsMusic = false;
      playing = false;
      if (timer) clearTimeout(timer);
      updateButton();
    },
    setMood(m) {
      mood = m;
      beat = 0;
      if (userWantsMusic && !playing) this.start(m);
    },
    toggle() {
      if (playing) this.stop();
      else this.start();
    },
    isPlaying() { return playing; },
  };
})();

// Music toggle button (floating)
(function injectMusicButton() {
  const btn = document.createElement('button');
  btn.id = 'music-btn';
  btn.className = 'music-btn';
  btn.title = 'Toggle music';
  btn.textContent = '🔇';
  btn.addEventListener('click', () => music.toggle());
  document.body.appendChild(btn);
})();
