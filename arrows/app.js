import { createBoard, freeArrows, firstBlocker, pointSegmentDistance, movingPath } from './engine.js';

const $ = id => document.getElementById(id);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const canvas = $('board'), ctx = canvas.getContext('2d'), dialog = $('dialog');
const STORAGE_KEY = 'arrows-escape-v1';
let stored = {};
try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch { /* A fresh game remains playable. */ }
if (!stored || typeof stored !== 'object' || Array.isArray(stored)) stored = {};
const settings = { sound: true, dark: false, ...stored.settings };
const saves = stored.saves && typeof stored.saves === 'object' ? stored.saves : {};
const completed = new Set(Array.isArray(stored.completed) ? stored.completed : []);
let manifest, board, mode = 'main', levelIndex = 0, saveKey = 'main';
let removed = new Set(), hearts = 3, mistakes = 0, hints = 0, seconds = 180, started = false;
let finished = false, busy = true, pendingWin = false, requestId = 0;
let width = 0, height = 0, baseCell = 40, zoom = 1, pan = { x: 0, y: 0 };
let hintId = -1, hintUntil = 0, selectedId = -1, hoverId = -1;
let animations = new Map(), particles = [], toastTimer, audioContext, dirty = true;
let lastTime = performance.now(), savedSecond = 180, lastSecond = 180;
const packs = new Map(), pointers = new Map();
let gesture = null, pinching = false, initialPinch = null;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function daySeed() { return [...today()].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0); }
function validIndex(value, count) { return Number.isInteger(value) && value >= 0 && value < count ? value : 0; }
function activeKey() { return mode === 'daily' ? `daily:${today()}` : mode; }
function persist() {
  if (board && !busy) saves[saveKey] = { index: levelIndex, id: board.id, removed: [...removed], hearts, mistakes, hints, seconds, started, finished };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings, saves, completed: [...completed] })); }
  catch { $('save-status').textContent = '浏览器存储不可用，本局仍可游玩'; }
}
function toast(message) {
  $('toast').textContent = message; $('toast').classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 2600);
}
function sound(kind) {
  if (!settings.sound) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    const now = audioContext.currentTime;
    const notes = kind === 'win' ? [523.25, 659.25, 783.99] : kind === 'mistake' ? [170, 130] : kind === 'hint' ? [659] : [440, 660];
    notes.forEach((hz, i) => {
      const osc = audioContext.createOscillator(), gain = audioContext.createGain(), start = now + i * .075;
      osc.type = 'sine'; osc.frequency.setValueAtTime(hz, start);
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(.045, start + .014); gain.gain.exponentialRampToValueAtTime(.001, start + .2);
      osc.connect(gain); gain.connect(audioContext.destination); osc.start(start); osc.stop(start + .22);
    });
  } catch { /* Sound is optional when a browser blocks audio. */ }
}
function theme() { document.documentElement.classList.toggle('dark', settings.dark); dirty = true; }
theme();

async function getPack(name) {
  if (!packs.has(name)) {
    const promise = fetch(`./data/${name}`).then(response => {
      if (!response.ok) throw new Error('关卡文件暂时无法读取');
      return response.json();
    }).catch(error => { packs.delete(name); throw error; });
    packs.set(name, promise);
  }
  return packs.get(name);
}

async function loadLevel(targetMode = mode, index, restart = false) {
  persist();
  const token = ++requestId;
  busy = true; pendingWin = false; animations.clear(); particles = []; pointers.clear(); gesture = null; pinching = false;
  clearTimeout(toastTimer); $('toast').classList.remove('visible'); $('toast').textContent = '';
  dialog.close(); $('loading').hidden = false;
  setToolsDisabled(true);
  mode = targetMode; saveKey = activeKey();
  document.querySelectorAll('.mode').forEach(button => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  try {
    if (!manifest) {
      const response = await fetch('./data/manifest.json');
      if (!response.ok) throw new Error('关卡目录暂时无法读取');
      manifest = await response.json();
    }
    if (token !== requestId) return;
    const config = manifest.modes[mode];
    const saved = saves[saveKey];
    if (index === undefined) index = mode === 'daily' ? daySeed() % config.count : validIndex(saved?.index, config.count);
    levelIndex = validIndex(index, config.count);
    const pack = await getPack(config.packs[Math.floor(levelIndex / manifest.packSize)]);
    if (token !== requestId) return;
    board = createBoard(pack[levelIndex % manifest.packSize]);
    const restore = !restart && saved?.id === board.id;
    removed = new Set(restore && Array.isArray(saved.removed) ? saved.removed.filter(i => Number.isInteger(i) && i >= 0 && i < board.arrows.length) : []);
    hearts = restore && Number.isInteger(saved.hearts) ? Math.max(0, Math.min(3, saved.hearts)) : 3;
    mistakes = restore ? Math.max(0, Number(saved.mistakes) || 0) : 0;
    hints = restore ? Math.max(0, Number(saved.hints) || 0) : 0;
    seconds = restore && Number.isFinite(saved.seconds) ? Math.max(0, Math.min(180, saved.seconds)) : 180;
    started = restore ? Boolean(saved.started) : false;
    finished = removed.size === board.arrows.length;
    hintId = -1; hoverId = -1; selectedId = -1;
    busy = false; fit(); updateUI(); persist(); setToolsDisabled(false);
    $('loading').hidden = true;
    if (finished) showResult(true);
    else if (hearts <= 0 || (mode === 'thunderrush' && seconds <= 0)) showResult(false);
    // Warm only the next small pack; the full library is never downloaded on startup.
    const nextPack = config.packs[Math.floor((levelIndex + 1) / manifest.packSize)];
    if (nextPack) getPack(nextPack).catch(() => {});
  } catch (error) {
    if (token !== requestId) return;
    $('loading').hidden = true;
    showDialog(`<div class="dialog-heading"><h2 id="dialog-title">棋盘还没准备好</h2></div><p class="dialog-subtitle">${navigator.onLine ? '关卡载入失败，请重试。' : '当前处于离线状态，这组关卡尚未缓存。联网打开一次后即可离线游玩。'}</p><div class="dialog-actions"><button class="primary" id="reload-level">重新载入</button><button class="secondary" id="offline-first">回到第一关</button></div>`);
    $('reload-level').onclick = () => loadLevel(targetMode, index, restart);
    $('offline-first').onclick = () => loadLevel('main', 0, true);
    console.error('Level loading failed:', error);
  }
}

function setToolsDisabled(disabled) {
  for (const id of ['restart', 'hint', 'fit', 'zoom-in', 'zoom-out', 'levels-button']) $(id).disabled = disabled;
}
function updateUI() {
  if (!board) return;
  const count = board.arrows.length, left = count - removed.size;
  $('left-count').textContent = left; $('total-count').textContent = ` / ${count}`;
  $('progress').style.width = `${removed.size / count * 100}%`;
  $('level-title').textContent = mode === 'daily' ? `${today().slice(5).replace('-', ' / ')} 每日一题` : mode === 'thunderrush' ? `挑战 ${levelIndex + 1}` : `第 ${String(levelIndex + 1).padStart(2, '0')} 关`;
  $('level-eyebrow').textContent = mode === 'daily' ? '每天一道，给思绪留点空白' : mode === 'thunderrush' ? '三分钟，找到每一个出口' : '慢慢想，总有出路';
  $('difficulty').textContent = count <= 5 ? '初见 · 认识箭头' : count < 25 ? '轻松 · 渐入佳境' : count < 65 ? '专注 · 理清思路' : count < 120 ? '进阶 · 环环相扣' : '挑战 · 耐心解开';
  $('hearts').innerHTML = Array.from({ length: 3 }, (_, i) => `<svg class="${i >= hearts ? 'empty' : ''}" aria-hidden="true"><use href="#i-heart"/></svg>`).join('');
  $('hearts').setAttribute('aria-label', `剩余 ${hearts} 颗心`);
  updateTimerLabel();
  $('note-text').textContent = finished ? '棋盘已清空，做得不错' : count <= 5 ? '点击箭头，让它沿着箭头方向离开' : '前方有箭头挡住时，先帮它的邻居离开';
  $('hint').disabled = busy || finished || hearts <= 0 || (mode === 'thunderrush' && seconds <= 0);
  dirty = true;
}
function updateTimerLabel() {
  $('life-caption').textContent = mode === 'thunderrush' ? `${Math.floor(Math.ceil(seconds) / 60)}:${String(Math.ceil(seconds) % 60).padStart(2, '0')} ${started ? '剩余' : '点击后计时'}` : mistakes ? `还有 ${hearts} 次机会` : '每一步，都从容';
}
function fit() { zoom = 1; pan = { x: 0, y: 0 }; resize(); }
function resize() {
  const bounds = $('board-wrap').getBoundingClientRect();
  width = bounds.width; height = bounds.height;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  if (board) baseCell = Math.max(1, Math.min((width - 100) / Math.max(board.w - 1, 1), (height - 110) / Math.max(board.h - 1, 1), 57));
  $('zoom-value').textContent = `${Math.round(zoom * 100)}%`;
  dirty = true;
}
new ResizeObserver(resize).observe($('board-wrap'));
function transform() {
  const cell = baseCell * zoom;
  return { cell, x: width / 2 - (board.w - 1) * cell / 2 + pan.x, y: (height - 25) / 2 - (board.h - 1) * cell / 2 + pan.y };
}
function zoomAt(next, center = { x: width / 2, y: (height - 25) / 2 }) {
  if (!board || busy) return;
  next = Math.max(.7, Math.min(6, next));
  const ratio = next / zoom;
  pan.x = center.x - width / 2 - (center.x - width / 2 - pan.x) * ratio;
  pan.y = center.y - (height - 25) / 2 - (center.y - (height - 25) / 2 - pan.y) * ratio;
  zoom = next; clampPan(); $('zoom-value').textContent = `${Math.round(zoom * 100)}%`; dirty = true;
}
function clampPan() {
  if (!board) return;
  const limitX = Math.max(width * .25, (board.w - 1) * baseCell * zoom / 2);
  const limitY = Math.max(height * .25, (board.h - 1) * baseCell * zoom / 2);
  pan.x = Math.max(-limitX, Math.min(limitX, pan.x)); pan.y = Math.max(-limitY, Math.min(limitY, pan.y));
}

function selectAt(position) {
  if (!board) return { id: -1 };
  const t = transform(), point = { x: (position.x - t.x) / t.cell, y: (position.y - t.y) / t.cell };
  const candidates = [];
  for (const arrow of board.arrows) {
    if (removed.has(arrow.id)) continue;
    let distance = Infinity;
    for (let i = 1; i < arrow.points.length; i++) distance = Math.min(distance, pointSegmentDistance(point, arrow.points[i - 1], arrow.points[i]));
    if (distance * t.cell < Math.min(19, t.cell * .46)) candidates.push({ id: arrow.id, distance: distance * t.cell });
  }
  candidates.sort((a, b) => a.distance - b.distance);
  if (candidates.length > 1 && candidates[1].distance - candidates[0].distance < 1.8) return { id: -1, ambiguous: true };
  return candidates[0] || { id: -1 };
}

function moveArrow(id) {
  if (busy || finished || hearts <= 0 || dialog.open || removed.has(id) || animations.has(id) || (mode === 'thunderrush' && seconds <= 0)) return;
  const arrow = board.arrows[id];
  if (!arrow) return;
  started = true; hintId = -1; selectedId = -1;
  const blocker = firstBlocker(arrow, removed), now = performance.now();
  if (blocker) {
    hearts--; mistakes++;
    animations.set(id, { type: 'bump', start: now, duration: reduceMotion.matches ? 150 : 480, distance: Math.min(.55, Math.max(.12, blocker.distance - .15)), blocker: blocker.id });
    sound('mistake'); toast(hearts > 0 ? '前方被挡住了，先移开挡路的箭头' : '三颗心用完了，再试一次吧');
  } else {
    removed.add(id);
    animations.set(id, { type: 'exit', start: now, duration: reduceMotion.matches ? 100 : Math.min(950, 350 + arrow.length * 7), distance: arrow.length + Math.hypot(board.w, board.h) + 8 });
    sound('move');
    if (removed.size === board.arrows.length) pendingWin = true;
  }
  updateUI(); persist();
}
function hint() {
  if (!board || busy || finished || hearts <= 0 || (mode === 'thunderrush' && seconds <= 0)) return;
  const free = freeArrows(board, removed);
  if (!free.length) { toast('正在移出箭头，请稍等'); return; }
  const arrow = free[0];
  hintId = arrow.id; hintUntil = performance.now() + 5000; hints++; sound('hint');
  const t = transform(), head = arrow.points[0];
  if (head.x * t.cell + t.x < 30 || head.x * t.cell + t.x > width - 30 || head.y * t.cell + t.y < 30 || head.y * t.cell + t.y > height - 60) {
    pan = { x: -(head.x - (board.w - 1) / 2) * t.cell, y: -(head.y - (board.h - 1) / 2) * t.cell };
  }
  toast('绿色箭头前方畅通，试着点击它'); persist(); dirty = true;
}

function strokeArrow(arrow, points, color, cell, alpha = 1, glow = false) {
  if (points.length < 2) return;
  ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, Math.min(5, cell * .085)) / cell;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 10; }
  ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
  const norm = Math.hypot(arrow.dx, arrow.dy), ux = arrow.dx / norm, uy = arrow.dy / norm;
  const head = points[0], size = Math.min(.33, 14 / cell);
  ctx.beginPath();
  ctx.moveTo(head.x - ux * size - uy * size * .8, head.y - uy * size + ux * size * .8);
  ctx.lineTo(head.x, head.y);
  ctx.lineTo(head.x - ux * size + uy * size * .8, head.y - uy * size - ux * size * .8);
  ctx.stroke(); ctx.shadowBlur = 0; ctx.globalAlpha = 1;
}

function draw(now) {
  if (!board || !width || !height) return;
  const dpr = Math.min(devicePixelRatio || 1, 2), t = transform();
  const style = getComputedStyle(document.documentElement);
  const ink = style.getPropertyValue('--ink').trim(), green = style.getPropertyValue('--green').trim();
  const line = style.getPropertyValue('--line').trim(), red = style.getPropertyValue('--red').trim();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
  ctx.save(); ctx.translate(t.x, t.y); ctx.scale(t.cell, t.cell);
  if (t.cell >= 9) {
    ctx.fillStyle = line;
    ctx.beginPath();
    for (let y = 0; y < board.h; y++) for (let x = 0; x < board.w; x++) {
      if (x * t.cell + t.x < -2 || x * t.cell + t.x > width + 2 || y * t.cell + t.y < -2 || y * t.cell + t.y > height + 2) continue;
      ctx.moveTo(x + 1 / t.cell, y); ctx.arc(x, y, 1 / t.cell, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  for (const arrow of board.arrows) {
    if (removed.has(arrow.id) || animations.has(arrow.id)) continue;
    const highlighted = arrow.id === hintId || arrow.id === selectedId;
    strokeArrow(arrow, arrow.points, highlighted ? green : ink, t.cell, hoverId === arrow.id ? .65 : 1, highlighted);
    if (highlighted) {
      const head = arrow.points[0]; ctx.strokeStyle = green; ctx.globalAlpha = .4;
      ctx.lineWidth = 1.5 / t.cell; ctx.setLineDash([5 / t.cell, 6 / t.cell]);
      ctx.beginPath(); ctx.moveTo(head.x + arrow.dx * .5, head.y + arrow.dy * .5);
      ctx.lineTo(head.x + arrow.dx * 100, head.y + arrow.dy * 100); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
  }
  for (const [id, animation] of animations) {
    const fraction = Math.min(1, (now - animation.start) / animation.duration), arrow = board.arrows[id];
    if (fraction >= 1) { animations.delete(id); dirty = true; continue; }
    const distance = animation.type === 'exit' ? animation.distance * fraction * fraction : Math.sin(fraction * Math.PI) * animation.distance;
    strokeArrow(arrow, movingPath(arrow, distance), animation.type === 'exit' ? green : red, t.cell, animation.type === 'exit' ? 1 - fraction * .3 : 1);
    if (animation.type === 'bump') {
      const blockingArrow = board.arrows[animation.blocker];
      if (!removed.has(blockingArrow.id)) strokeArrow(blockingArrow, blockingArrow.points, red, t.cell, .6);
    }
  }
  ctx.restore();
  for (const p of particles) {
    const elapsed = (now - p.start) / 1000;
    ctx.globalAlpha = Math.max(0, 1 - elapsed / 1.5); ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(width / 2 + p.vx * elapsed, height / 2 + p.vy * elapsed + 120 * elapsed * elapsed, p.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1; particles = particles.filter(p => now - p.start < 1500);
}

function tick(now) {
  const delta = Math.min((now - lastTime) / 1000, .2); lastTime = now;
  if (mode === 'thunderrush' && started && !busy && !finished && !pendingWin && hearts > 0 && seconds > 0 && !document.hidden && !dialog.open) {
    seconds = Math.max(0, seconds - delta);
    if (Math.ceil(seconds) !== lastSecond) { lastSecond = Math.ceil(seconds); updateTimerLabel(); }
    if (Math.floor(seconds / 5) !== savedSecond) { savedSecond = Math.floor(seconds / 5); persist(); }
    if (seconds <= 0) { persist(); updateUI(); showResult(false); }
  }
  if (hintId >= 0 && now > hintUntil) { hintId = -1; dirty = true; }
  if (dirty || animations.size || particles.length) { dirty = false; draw(now); }
  if (pendingWin && !animations.size) { pendingWin = false; complete(); }
  if (!busy && hearts <= 0 && !animations.size && !dialog.open && !finished) showResult(false);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

function complete() {
  finished = true; completed.add(`${mode}:${board.id}`); updateUI(); persist(); sound('win');
  if (!reduceMotion.matches) particles = Array.from({ length: 35 }, () => ({ start: performance.now(), vx: (Math.random() - .5) * 420, vy: -90 - Math.random() * 210, r: 2 + Math.random() * 3, color: ['#416b55', '#a6bb94', '#d88d68'][Math.floor(Math.random() * 3)] }));
  showResult(true);
}
function showDialog(html) { $('dialog-content').innerHTML = html; if (!dialog.open) dialog.showModal(); }
function closeButton() { return `<button id="close-dialog" aria-label="关闭">${icon('close')}</button>`; }
function bindClose() { if ($('close-dialog')) $('close-dialog').onclick = () => dialog.close(); }
function showResult(won) {
  const last = manifest && levelIndex === manifest.modes[mode].count - 1;
  showDialog(`<div class="result"><div class="win-mark">${icon(won ? 'check' : 'reset')}</div><h2 id="dialog-title">${won ? '每一支，都找到了出口' : mode === 'thunderrush' && seconds <= 0 ? '时间到了，歇一口气' : '再想一步，就有新出路'}</h2><p>${won ? mode === 'daily' ? '今日一题已完成，明天再来相见。' : last ? '这一组关卡全部走过了，回头再挑一关吧。' : '把复杂一点点解开，就是这么简单。' : '仔细看箭头前方，先移开没有阻挡的那一支。'}</p><div class="result-stats"><div><strong>${removed.size}</strong><span>移出箭头</span></div><div><strong>${mistakes}</strong><span>碰撞次数</span></div><div><strong>${hints}</strong><span>使用提示</span></div></div><div class="dialog-actions"><button class="secondary" id="result-retry">再玩一次</button><button class="primary" id="result-next">${won ? mode === 'daily' ? '继续经典闯关' : last ? '返回第一关' : '下一关 →' : '重新挑战'}</button></div></div>`);
  $('result-retry').onclick = () => loadLevel(mode, levelIndex, true);
  $('result-next').onclick = () => !won ? loadLevel(mode, levelIndex, true) : mode === 'daily' ? loadLevel('main') : loadLevel(mode, last ? 0 : levelIndex + 1);
}

function showSettings() {
  showDialog(`<div class="dialog-heading"><h2 id="dialog-title">让思绪舒服一点</h2>${closeButton()}</div><p class="dialog-subtitle">按照你的节奏，慢慢解开。</p><div class="setting-row"><span>${icon('sound')}游戏音效</span><button id="sound-toggle" class="switch" role="switch" aria-label="游戏音效" aria-checked="${settings.sound}"></button></div><div class="setting-row"><span>${icon('moon')}深色棋盘</span><button id="dark-toggle" class="switch" role="switch" aria-label="深色棋盘" aria-checked="${settings.dark}"></button></div><div class="install-note"><strong>把小游戏放到 iPad 主屏幕</strong><br>在 Safari 打开本页，点击「分享」→「添加到主屏幕」。<br>单指点击箭头，拖动平移，双指缩放。大棋盘建议先放大再点击。<br>已打开的关卡组可在 HTTPS 环境下离线游玩。<br>进度保存在当前浏览器，清除网站数据后会重置。</div>`);
  bindClose();
  $('sound-toggle').onclick = () => { settings.sound = !settings.sound; $('sound-toggle').setAttribute('aria-checked', settings.sound); sound('hint'); persist(); };
  $('dark-toggle').onclick = () => { settings.dark = !settings.dark; $('dark-toggle').setAttribute('aria-checked', settings.dark); theme(); persist(); };
}
function showLevels(page = Math.floor((mode === 'main' ? levelIndex : validIndex(saves.main?.index, manifest.modes.main.count)) / 48)) {
  if (!manifest) return;
  const count = manifest.modes.main.count, lastPage = Math.ceil(count / 48) - 1;
  page = Math.max(0, Math.min(lastPage, page));
  const start = page * 48, end = Math.min(count, start + 48);
  showDialog(`<div class="dialog-heading"><h2 id="dialog-title">挑一道，慢慢解</h2>${closeButton()}</div><p class="dialog-subtitle">${count.toLocaleString()} 道经典关卡 · 按箭头数量由浅入深排列</p><div class="level-grid">${Array.from({ length: end - start }, (_, i) => `<button class="level-cell ${mode === 'main' && levelIndex === start + i ? 'current' : ''}" data-level="${start + i}" aria-label="第 ${start + i + 1} 关">${start + i + 1}</button>`).join('')}</div><div class="level-pagination"><button id="prev-page" ${page === 0 ? 'disabled' : ''}>← 上一页</button><span>${page + 1} / ${lastPage + 1}</span><button id="next-page" ${page === lastPage ? 'disabled' : ''}>下一页 →</button></div><form class="jump-form" id="jump-form"><input id="jump-level" type="number" inputmode="numeric" min="1" max="${count}" placeholder="输入关卡编号，1–${count}" aria-label="跳转关卡编号" required><button type="submit">前往</button></form>`);
  bindClose();
  $('prev-page').onclick = () => showLevels(page - 1); $('next-page').onclick = () => showLevels(page + 1);
  dialog.querySelectorAll('[data-level]').forEach(button => { button.onclick = () => loadLevel('main', Number(button.dataset.level)); });
  $('jump-form').onsubmit = event => { event.preventDefault(); const value = Number($('jump-level').value); if (Number.isInteger(value) && value >= 1 && value <= count) loadLevel('main', value - 1); };
  const cells = [...dialog.querySelectorAll('[data-level]')];
  Promise.all([...new Set(cells.map(button => Math.floor(Number(button.dataset.level) / manifest.packSize)))].map(async packId => {
    const pack = await getPack(manifest.modes.main.packs[packId]);
    for (const button of cells) { const index = Number(button.dataset.level); if (Math.floor(index / manifest.packSize) === packId && completed.has(`main:${pack[index % manifest.packSize].id}`)) button.classList.add('done'); }
  })).catch(() => {});
}

function point(event) { const bounds = canvas.getBoundingClientRect(); return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }; }
function pinchInfo() { const [a, b] = [...pointers.values()]; return { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; }
canvas.addEventListener('pointerdown', event => {
  if (busy || !board || event.button > 0) return;
  canvas.setPointerCapture(event.pointerId);
  const position = point(event); pointers.set(event.pointerId, position);
  if (pointers.size === 1) { gesture = { start: position, moved: false, pan: { ...pan } }; }
  else if (pointers.size === 2) { pinching = true; initialPinch = { ...pinchInfo(), zoom }; gesture = null; }
});
canvas.addEventListener('pointermove', event => {
  const position = point(event);
  if (!pointers.has(event.pointerId)) { if (event.pointerType === 'mouse' && !busy && board) { const id = selectAt(position).id; if (id !== hoverId) { hoverId = id; dirty = true; } } return; }
  pointers.set(event.pointerId, position);
  if (pinching && pointers.size >= 2) {
    const info = pinchInfo();
    zoomAt(initialPinch.zoom * info.distance / initialPinch.distance, initialPinch.center);
    pan.x += info.center.x - initialPinch.center.x; pan.y += info.center.y - initialPinch.center.y;
    initialPinch = { ...info, zoom }; clampPan(); dirty = true;
  } else if (gesture) {
    const dx = position.x - gesture.start.x, dy = position.y - gesture.start.y;
    if (Math.hypot(dx, dy) > 7) gesture.moved = true;
    if (gesture.moved) { pan = { x: gesture.pan.x + dx, y: gesture.pan.y + dy }; clampPan(); dirty = true; }
  }
});
function pointerEnd(event, canceled = false) {
  if (!pointers.has(event.pointerId)) return;
  const position = point(event);
  if (!canceled && !pinching && gesture && !gesture.moved) {
    const target = selectAt(position);
    if (target.ambiguous) toast('这里的箭头挨得很近，双指放大再试试');
    else if (target.id >= 0) moveArrow(target.id);
  }
  pointers.delete(event.pointerId);
  if (!pointers.size) { gesture = null; pinching = false; initialPinch = null; }
}
canvas.addEventListener('pointerup', event => pointerEnd(event));
canvas.addEventListener('pointercancel', event => pointerEnd(event, true));
canvas.addEventListener('lostpointercapture', event => pointerEnd(event, true));
canvas.addEventListener('pointerleave', () => { hoverId = -1; dirty = true; });
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('wheel', event => { event.preventDefault(); zoomAt(zoom * Math.exp(-event.deltaY * .002), point(event)); }, { passive: false });
canvas.addEventListener('keydown', event => {
  if (!board || busy || dialog.open) return;
  if (['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault(); const available = board.arrows.filter(a => !removed.has(a.id));
    if (!available.length) return;
    const index = available.findIndex(a => a.id === selectedId), step = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
    selectedId = available[(index + step + available.length) % available.length].id; dirty = true;
  } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (selectedId >= 0) moveArrow(selectedId); }
});
document.addEventListener('keydown', event => { if (!dialog.open && !['INPUT', 'TEXTAREA'].includes(event.target.tagName) && event.key.toLowerCase() === 'h') hint(); });
document.querySelectorAll('.mode').forEach(button => { button.onclick = () => loadLevel(button.dataset.mode); });
$('hint').onclick = hint; $('fit').onclick = fit;
$('zoom-in').onclick = () => zoomAt(zoom * 1.3); $('zoom-out').onclick = () => zoomAt(zoom / 1.3);
$('settings-button').onclick = showSettings; $('levels-button').onclick = () => showLevels();
$('restart').onclick = () => {
  if (!board || busy) return;
  showDialog(`<div class="dialog-heading"><h2 id="dialog-title">重新理一理思路？</h2>${closeButton()}</div><p class="dialog-subtitle">本关的箭头和三颗心会恢复，其他关卡的记录会保留。</p><div class="dialog-actions"><button class="secondary" id="cancel-restart">继续想想</button><button class="primary" id="confirm-restart">重新开始</button></div>`);
  bindClose(); $('cancel-restart').onclick = () => dialog.close(); $('confirm-restart').onclick = () => loadLevel(mode, levelIndex, true);
};
dialog.addEventListener('cancel', event => { if (busy || (board && !finished && (hearts <= 0 || (mode === 'thunderrush' && seconds <= 0)))) event.preventDefault(); });
document.addEventListener('visibilitychange', () => { persist(); lastTime = performance.now(); });
window.addEventListener('pagehide', persist);
loadLevel();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('./sw.js').catch(() => { $('save-status').textContent = '进度已保存，离线缓存暂不可用'; });
}
