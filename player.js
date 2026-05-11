// Player-side logic — runs on phones/laptops of people joining a room.
const socket = io();
const $ = (id) => document.getElementById(id);
const SHAPES = ['▲', '◆', '●', '■'];
const COLORS = ['#e21b3c', '#1368ce', '#d89e00', '#26890c'];

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
let lastRankContext = null;

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
    music.start('lobby');
  });
}

// --- Question ---
socket.on('question:start', ({ index, total, question, options, durationMs, startedAt }) => {
  myAnswered = false;
  show('answer');
  music.setMood('question');
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
  Array.from($('answer-grid').children).forEach((el, i) => {
    el.disabled = true;
    if (i !== optionIndex) el.style.opacity = '0.35';
  });
  socket.emit('player:answer', { index, optionIndex }, (resp) => {
    if (!resp?.ok) {
      myAnswered = false;
      Array.from($('answer-grid').children).forEach((el) => {
        el.disabled = false;
        el.style.opacity = '';
      });
    }
    // The server emits player:result right after this, so we just wait.
  });
}

// --- Instant result (right after answering) ---
socket.on('player:result', (data) => {
  const { correct, points, score, correctIndex, correctOption, prevRank, rankContext } = data;
  myScore = score;
  show('result');
  music.setMood('reveal');

  const banner = $('result-banner');
  banner.classList.toggle('correct', correct);
  banner.classList.toggle('wrong', !correct);

  $('result-title').textContent = correct ? '✅ Correct!' : '❌ Wrong';

  // Subtitle: points earned (if correct), OR the correct answer (if wrong)
  if (correct) {
    $('result-sub').innerHTML = `<strong>+${points}</strong> points`;
  } else {
    $('result-sub').innerHTML =
      `Correct answer: <span class="correct-pill" style="background:${COLORS[correctIndex]}">` +
      `${SHAPES[correctIndex]} ${escapeHtml(correctOption || '')}</span>`;
  }

  $('result-score').textContent = score;

  // Render the rank-context card
  renderRankCard(rankContext, prevRank);
  lastRankContext = rankContext;
});

// --- After all players answered, server sends a final rank update ---
socket.on('player:rankUpdate', ({ rankContext }) => {
  if (!rankContext) return;
  const prev = lastRankContext ? lastRankContext.rank : rankContext.rank;
  renderRankCard(rankContext, prev);
  lastRankContext = rankContext;
});

function renderRankCard(rc, prevRank) {
  if (!rc) {
    $('rank-card').classList.add('hidden');
    return;
  }
  $('rank-card').classList.remove('hidden');

  const myRank = rc.rank;
  const movement = (prevRank || myRank) - myRank; // positive = moved up
  const movementEl = $('rank-movement');
  movementEl.classList.remove('up', 'down', 'flat');
  if (movement > 0) {
    movementEl.textContent = `↑ +${movement}`;
    movementEl.classList.add('up');
  } else if (movement < 0) {
    movementEl.textContent = `↓ ${movement}`;
    movementEl.classList.add('down');
  } else {
    movementEl.textContent = '—';
    movementEl.classList.add('flat');
  }

  $('rank-me-rank').textContent = `#${myRank}`;
  $('rank-me-name').textContent = rc.me.name;
  $('rank-me-score').textContent = `${rc.me.score} pts`;

  const aboveEl = $('rank-above');
  if (rc.above) {
    aboveEl.classList.remove('hidden');
    $('rank-above-rank').textContent = `#${rc.above.rank}`;
    $('rank-above-name').textContent = rc.above.name;
    $('rank-above-score').textContent = `${rc.above.score} pts`;
    $('rank-above-diff').textContent = `${rc.above.score - rc.me.score} pts ahead`;
  } else {
    aboveEl.classList.add('hidden');
  }

  const belowEl = $('rank-below');
  if (rc.below) {
    belowEl.classList.remove('hidden');
    $('rank-below-rank').textContent = `#${rc.below.rank}`;
    $('rank-below-name').textContent = rc.below.name;
    $('rank-below-score').textContent = `${rc.below.score} pts`;
    $('rank-below-diff').textContent = `${rc.me.score - rc.below.score} pts behind`;
  } else {
    belowEl.classList.add('hidden');
  }

  // Trigger a pop animation on the me-row when rank changed
  const meRow = $('rank-me');
  meRow.classList.remove('pop');
  void meRow.offsetWidth; // restart animation
  meRow.classList.add('pop');
}

// --- Final ---
socket.on('game:finished', ({ leaderboard }) => {
  clearInterval(countdownTimer);
  show('final');
  music.setMood('final');
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
  music.stop();
  alert('The host ended the room.');
  location.href = '/';
});

socket.on('disconnect', () => {
  // Don't redirect on transient blips — only on explicit close.
});

// =================================================================
// Procedural happy music (Web Audio API, no external file)
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
      // restart melody index for clean transitions
      beat = 0;
      if (userWantsMusic && !playing) this.start(m);
    },
    toggle() {
      if (playing) this.stop();
      else this.start();
    },
    isPlaying() { return playing; },
  };

  function updateButton() {
    const btn = document.getElementById('music-btn');
    if (btn) btn.textContent = playing ? '🔊' : '🔇';
  }
})();

// Inject the music toggle button into the page
(function injectMusicButton() {
  const btn = document.createElement('button');
  btn.id = 'music-btn';
  btn.className = 'music-btn';
  btn.title = 'Toggle music';
  btn.textContent = '🔇';
  btn.addEventListener('click', () => music.toggle());
  document.body.appendChild(btn);
})();
