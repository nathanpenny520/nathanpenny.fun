// ============================================================================
// UFO BATTLE — a small vertical shooter for the games page.
// Loaded only by pages/games.html; every other page never runs this file.
// Controls: drag with finger/mouse or arrows/WASD, firing is automatic,
// Space or P pauses. Best score lives in localStorage, no backend involved.
// ============================================================================

(function () {
  const canvas = document.getElementById('ufoGameCanvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('ufoOverlay');
  const scoreEl = document.getElementById('ufoScore');
  const bestEl = document.getElementById('ufoBest');
  const livesEl = document.getElementById('ufoLives');
  const pauseBtn = document.getElementById('ufoPauseBtn');
  const muteBtn = document.getElementById('ufoMuteBtn');
  const stage = canvas.parentElement;

  // Logical playfield; the canvas is CSS-scaled to fit its card.
  const W = 420;
  const H = 560;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const BEST_KEY = 'ufoBattleBest';
  const SOUND_KEY = 'gamesSound';

  const PLAYER_SPEED = 360;      // keyboard movement, px/s
  const FIRE_COOLDOWN = 0.22;    // seconds between shots
  const BULLET_SPEED = 540;
  const TWIN_SHOT_AT = 1000;     // score that unlocks the second barrel

  // Enemy archetypes: small darting scouts up to slow heavy cruisers.
  const ENEMY_TYPES = [
    { size: 34, r: 16, hp: 1, score: 100, vy: 135, weight: 0.58 },
    { size: 46, r: 22, hp: 2, score: 250, vy: 92,  weight: 0.30 },
    { size: 62, r: 30, hp: 4, score: 500, vy: 62,  weight: 0.12 }
  ];

  let state = 'ready';           // ready | playing | paused | over
  let score = 0;
  let best = Number(localStorage.getItem(BEST_KEY) || 0);
  let lives = 3;
  let elapsed = 0;               // seconds since run started
  let spawnTimer = 0;
  let fireTimer = 0;
  let invincible = 0;            // seconds of post-hit invincibility left

  const player = { x: W / 2, y: H - 70, r: 17, targetX: null, targetY: null };
  let bullets = [];
  let enemies = [];
  let particles = [];
  let popups = [];

  // Twinkling star backdrop, generated once.
  const stars = Array.from({ length: 70 }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    r: Math.random() * 1.4 + 0.4,
    phase: Math.random() * Math.PI * 2,
    speed: Math.random() * 1.4 + 0.6
  }));

  // ------------------------------------------------------------------
  // Audio: tiny synthesized bleeps; no audio files anywhere.
  // ------------------------------------------------------------------
  let audioCtx = null;
  let muted = localStorage.getItem(SOUND_KEY) === 'off';

  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }

  function beep(freqFrom, freqTo, duration, type, volume) {
    if (muted || !audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const now = audioCtx.currentTime;
    osc.type = type;
    osc.frequency.setValueAtTime(freqFrom, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(freqTo, 1), now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  const sfx = {
    shoot: () => beep(880, 320, 0.08, 'square', 0.03),
    hit: () => beep(240, 160, 0.08, 'triangle', 0.05),
    explode: () => beep(180, 40, 0.28, 'sawtooth', 0.07),
    ouch: () => beep(300, 60, 0.4, 'sawtooth', 0.09),
    over: () => { beep(400, 200, 0.25, 'square', 0.06); setTimeout(() => beep(300, 80, 0.5, 'square', 0.06), 180); }
  };

  // ------------------------------------------------------------------
  // HUD and overlays (DOM, so they follow the site theme for free).
  // ------------------------------------------------------------------
  function renderHud() {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(Math.max(best, score));
    livesEl.textContent = lives > 0 ? '❤️'.repeat(lives) : '—';
  }

  function clearOverlay() {
    overlay.innerHTML = '';
    overlay.hidden = true;
  }

  function overlayButton(label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'game-btn game-btn-primary';
    btn.textContent = label;
    return btn;
  }

  function showReadyOverlay() {
    overlay.innerHTML = '';
    const title = document.createElement('p');
    title.className = 'game-overlay-title';
    title.textContent = '🛸 UFO Battle';
    const text = document.createElement('p');
    text.className = 'game-overlay-text';
    text.textContent = 'Defend Earth. Drag to move — you fire automatically.';
    const btn = overlayButton('Start');
    btn.addEventListener('click', startGame);
    overlay.append(title, text, btn);
    overlay.hidden = false;
  }

  function showPauseOverlay() {
    overlay.innerHTML = '';
    const title = document.createElement('p');
    title.className = 'game-overlay-title';
    title.textContent = '⏸ Paused';
    const btn = overlayButton('Resume');
    btn.addEventListener('click', resumeGame);
    overlay.append(title, btn);
    overlay.hidden = false;
  }

  function showGameOverOverlay() {
    overlay.innerHTML = '';
    const title = document.createElement('p');
    title.className = 'game-overlay-title';
    title.textContent = score >= best && score > 0 ? '🏆 New best!' : '💥 Ship down';
    const text = document.createElement('p');
    text.className = 'game-overlay-text';
    text.textContent = 'Score ' + score + (best > 0 ? ' · best ' + best : '');
    const btn = overlayButton('Play again');
    btn.addEventListener('click', startGame);
    overlay.append(title, text, btn);
    overlay.hidden = false;
  }

  // ------------------------------------------------------------------
  // State transitions.
  // ------------------------------------------------------------------
  function startGame() {
    ensureAudio();
    score = 0;
    lives = 3;
    elapsed = 0;
    spawnTimer = 0.4;
    fireTimer = 0;
    invincible = 0;
    player.x = W / 2;
    player.y = H - 70;
    player.targetX = null;
    player.targetY = null;
    bullets = [];
    enemies = [];
    particles = [];
    popups = [];
    state = 'playing';
    pauseBtn.disabled = false;
    pauseBtn.textContent = 'Pause';
    clearOverlay();
    renderHud();
  }

  function pauseGame() {
    if (state !== 'playing') return;
    state = 'paused';
    pauseBtn.textContent = 'Resume';
    showPauseOverlay();
  }

  function resumeGame() {
    if (state !== 'paused') return;
    state = 'playing';
    pauseBtn.textContent = 'Pause';
    clearOverlay();
  }

  function togglePause() {
    if (state === 'playing') pauseGame();
    else if (state === 'paused') resumeGame();
  }

  function gameOver() {
    state = 'over';
    pauseBtn.disabled = true;
    if (score > best) {
      best = score;
      localStorage.setItem(BEST_KEY, String(best));
    }
    sfx.over();
    showGameOverOverlay();
    renderHud();
  }

  // ------------------------------------------------------------------
  // Input.
  // ------------------------------------------------------------------
  const keys = {};

  window.addEventListener('keydown', (e) => {
    const key = e.key;
    const handled = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'p', 'P', 'a', 'd', 'w', 's'];
    if (!handled.includes(key)) return;
    // Only hijack the keys while this game is actually on screen and active.
    if (state === 'ready' || state === 'over') return;
    e.preventDefault();
    if (key === ' ' || key === 'p' || key === 'P') {
      togglePause();
      return;
    }
    keys[key] = true;
  });

  window.addEventListener('keyup', (e) => { keys[e.key] = false; });

  // Drag anywhere on the stage; the ship sits above the finger, not under it.
  let dragging = false;

  stage.addEventListener('pointerdown', (e) => {
    if (state !== 'playing') return;
    dragging = true;
    stage.setPointerCapture(e.pointerId);
    updateDragTarget(e);
  });

  stage.addEventListener('pointermove', (e) => {
    if (dragging && state === 'playing') updateDragTarget(e);
  });

  stage.addEventListener('pointerup', () => { dragging = false; });
  stage.addEventListener('pointercancel', () => { dragging = false; });

  function updateDragTarget(e) {
    const rect = canvas.getBoundingClientRect();
    player.targetX = (e.clientX - rect.left) * (W / rect.width);
    player.targetY = (e.clientY - rect.top) * (H / rect.height) - 70;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseGame();
  });

  pauseBtn.addEventListener('click', () => { ensureAudio(); togglePause(); });

  muteBtn.addEventListener('click', () => {
    muted = !muted;
    localStorage.setItem(SOUND_KEY, muted ? 'off' : 'on');
    muteBtn.textContent = muted ? 'Sound: off' : 'Sound: on';
  });
  muteBtn.textContent = muted ? 'Sound: off' : 'Sound: on';

  // ------------------------------------------------------------------
  // Spawning, movement, collisions.
  // ------------------------------------------------------------------
  function difficulty() {
    return 1 + Math.min(elapsed / 50, 1.6);
  }

  function spawnEnemy() {
    let roll = Math.random();
    let type = ENEMY_TYPES[ENEMY_TYPES.length - 1];
    for (const candidate of ENEMY_TYPES) {
      if (roll < candidate.weight) { type = candidate; break; }
      roll -= candidate.weight;
    }
    enemies.push({
      x: type.r + Math.random() * (W - type.r * 2),
      y: -type.r - 10,
      vy: type.vy * difficulty() * (0.85 + Math.random() * 0.3),
      driftPhase: Math.random() * Math.PI * 2,
      driftFreq: 1 + Math.random() * 1.6,
      hp: type.hp,
      r: type.r,
      size: type.size,
      score: type.score,
      flash: 0
    });
  }

  function explode(x, y, big) {
    const count = big ? 14 : 8;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * (big ? 160 : 100);
      particles.push({
        x: x, y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.5 + Math.random() * 0.3,
        maxLife: 0.8,
        color: Math.random() < 0.5 ? '#1abc9c' : '#f1c40f'
      });
    }
  }

  function addScorePopup(x, y, points) {
    popups.push({ x: x, y: y, text: '+' + points, life: 0.8 });
  }

  function update(dt) {
    elapsed += dt;
    invincible = Math.max(0, invincible - dt);

    // Keyboard movement, then ease toward the drag target if there is one.
    let vx = 0;
    let vy = 0;
    if (keys['ArrowLeft'] || keys['a'] || keys['A']) vx -= 1;
    if (keys['ArrowRight'] || keys['d'] || keys['D']) vx += 1;
    if (keys['ArrowUp'] || keys['w'] || keys['W']) vy -= 1;
    if (keys['ArrowDown'] || keys['s'] || keys['S']) vy += 1;
    if (vx || vy) {
      const len = Math.hypot(vx, vy);
      player.x += (vx / len) * PLAYER_SPEED * dt;
      player.y += (vy / len) * PLAYER_SPEED * dt;
      player.targetX = null;
    }
    if (player.targetX !== null) {
      const ease = 1 - Math.exp(-14 * dt);
      player.x += (player.targetX - player.x) * ease;
      player.y += (player.targetY - player.y) * ease;
    }
    player.x = Math.min(Math.max(player.x, 24), W - 24);
    player.y = Math.min(Math.max(player.y, H * 0.4), H - 34);

    // Automatic fire; twin barrels after the score threshold.
    fireTimer -= dt;
    if (fireTimer <= 0) {
      fireTimer = FIRE_COOLDOWN;
      if (score >= TWIN_SHOT_AT) {
        bullets.push({ x: player.x - 8, y: player.y - 18 });
        bullets.push({ x: player.x + 8, y: player.y - 18 });
      } else {
        bullets.push({ x: player.x, y: player.y - 22 });
      }
      sfx.shoot();
    }

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnTimer = Math.max(0.45, 1.15 - elapsed * 0.011);
      spawnEnemy();
    }

    for (const b of bullets) b.y -= BULLET_SPEED * dt;
    bullets = bullets.filter((b) => b.y > -20);

    for (const e of enemies) {
      e.y += e.vy * dt;
      e.x += Math.sin(elapsed * e.driftFreq + e.driftPhase) * 26 * dt;
      e.flash = Math.max(0, e.flash - dt);
    }
    enemies = enemies.filter((e) => e.y < H + e.r + 20);

    // Bullet hits enemy.
    for (const e of enemies) {
      for (const b of bullets) {
        if (b.dead || e.dead) continue;
        if (Math.hypot(b.x - e.x, b.y - e.y) < e.r + 4) {
          b.dead = true;
          e.hp -= 1;
          e.flash = 0.09;
          if (e.hp <= 0) {
            e.dead = true;
            score += e.score;
            explode(e.x, e.y, e.size >= 46);
            addScorePopup(e.x, e.y, e.score);
            sfx.explode();
          } else {
            sfx.hit();
          }
        }
      }
    }
    bullets = bullets.filter((b) => !b.dead);
    enemies = enemies.filter((e) => !e.dead);

    // Enemy reaches the ship.
    if (invincible <= 0) {
      for (const e of enemies) {
        if (Math.hypot(player.x - e.x, player.y - e.y) < e.r + player.r) {
          e.dead = true;
          explode(e.x, e.y, true);
          lives -= 1;
          invincible = 1.6;
          sfx.ouch();
          if (lives <= 0) gameOver();
          break;
        }
      }
      enemies = enemies.filter((e) => !e.dead);
    }

    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);

    for (const p of popups) {
      p.y -= 40 * dt;
      p.life -= dt;
    }
    popups = popups.filter((p) => p.life > 0);
  }

  // ------------------------------------------------------------------
  // Rendering.
  // ------------------------------------------------------------------
  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Starfield backdrop.
    for (const s of stars) {
      ctx.globalAlpha = 0.25 + 0.45 * Math.abs(Math.sin(elapsed * s.speed + s.phase));
      ctx.fillStyle = '#cfd8ea';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Player rocket, blinking while invincible. The 🚀 glyph leans 45°,
    // so it is rotated to point straight up.
    const blinkOff = invincible > 0 && Math.floor(invincible * 10) % 2 === 0;
    if (!blinkOff) {
      ctx.save();
      ctx.translate(player.x, player.y);
      ctx.rotate(-Math.PI / 4);
      ctx.font = '34px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🚀', 0, 0);
      ctx.restore();
    }

    // Bullets: small glowing darts.
    ctx.fillStyle = '#7ef2c8';
    for (const b of bullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Enemies: UFO glyphs, flashing white briefly when shot.
    for (const e of enemies) {
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.font = e.size + 'px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (e.flash > 0) ctx.globalAlpha = 0.45;
      ctx.fillText('🛸', 0, 0);
      ctx.restore();
      ctx.globalAlpha = 1;

      // Tiny health pips for tougher UFOs.
      if (e.hp > 1) {
        ctx.fillStyle = '#f1c40f';
        for (let i = 0; i < e.hp; i++) {
          ctx.fillRect(e.x - (e.hp - 1) * 5 + i * 10 - 2, e.y + e.r + 5, 4, 4);
        }
      }
    }

    for (const p of particles) {
      ctx.globalAlpha = Math.max(p.life / p.maxLife, 0);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    ctx.font = 'bold 15px "Open Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#7ef2c8';
    for (const p of popups) {
      ctx.globalAlpha = Math.min(p.life * 2, 1);
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------
  // Main loop.
  // ------------------------------------------------------------------
  let lastTime = performance.now();

  function frame(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    if (state === 'playing') {
      update(dt);
      renderHud();
    }
    draw();
    requestAnimationFrame(frame);
  }

  renderHud();
  showReadyOverlay();
  requestAnimationFrame(frame);
})();
