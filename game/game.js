import { BOARD, FRUITS, randomFruit, clamp } from './fruits.js';
import { readStorage, writeStorage, clearSession, validSession } from './storage.js';
import { GameAudio } from './audio.js';
import { FruitPhysics } from './physics.js';
import { GameRenderer } from './renderer.js';

const $ = id => document.getElementById(id);
const canvas = $('game-canvas');
const overlay = $('game-overlay');
const audio = new GameAudio();
const rawBest = readStorage('best', 0);
const freshToolUses = () => ({ bomb: 1, tidy: 1, upgrade: 1, shake: 1 });
const state = {
  status: 'loading', score: 0, best: Number.isSafeInteger(rawBest) && rawBest >= 0 ? rawBest : 0,
  current: 0, next: 0, highest: 0, aim: BOARD.width / 2, aiming: false,
  nextDropAt: 0, drops: 0, physics: null, renderer: null, bestAtStart: 0,
  tool: null, targetId: null,
  toolUses: freshToolUses(),
};
let activePointer = null;
let saved = readStorage('session', null);
if (!validSession(saved)) saved = null;
if (saved?.toolUses) state.toolUses = { ...saved.toolUses };
let lastFrame = 0;
let accumulator = 0;
let announcementTimer;
let toastTimer;
let resumeAfterDialog = false;

for (const [index, fruit] of FRUITS.entries()) {
  const step = document.createElement('span');
  step.className = 'fruit-step'; step.title = `${index + 1}. ${fruit.name}`;
  const image = new Image(); image.src = fruit.image; image.alt = fruit.name;
  step.append(image); $('fruit-chain').append(step);
  if (index < FRUITS.length - 1) {
    const arrow = document.createElement('span'); arrow.className = 'chain-arrow'; arrow.textContent = '›'; arrow.setAttribute('aria-hidden', 'true'); $('fruit-chain').append(arrow);
  }
}

function syncAudioButtons() {
  $('sound-button').setAttribute('aria-pressed', String(audio.enabled));
  $('sound-button').setAttribute('aria-label', audio.enabled ? '关闭音效' : '开启音效');
  $('sound-button').querySelector('use').setAttribute('href', audio.enabled ? '#i-sound' : '#i-muted');
  $('music-button').setAttribute('aria-pressed', String(audio.musicEnabled));
  $('music-button').textContent = audio.musicEnabled ? '已开启' : '已关闭';
}

function updateUI() {
  $('score').textContent = state.score;
  $('best').textContent = state.best;
  $('next-image').src = FRUITS[state.next].image;
  $('next-image').alt = `下一颗：${FRUITS[state.next].name}`;
  $('pause-button').disabled = state.status !== 'playing';
  $('restart-button').disabled = state.status === 'loading';
  $('board-frame').dataset.state = state.status;
  $('board-frame').dataset.fruitCount = state.physics?.fruits.length || 0;
  $('board-frame').dataset.tool = state.tool || '';
  $('board-frame').classList.toggle('targeting', !!state.tool);
  $('tool-prompt').hidden = !state.tool;
  $('tool-instruction').textContent = state.tool === 'bomb' ? '点选一颗水果炸掉 · 已暂停' : '点选一颗水果升一级 · 已暂停';
  for (const button of document.querySelectorAll('button[data-tool]')) {
    const remaining = state.toolUses[button.dataset.tool];
    button.disabled = state.status !== 'playing' || remaining === 0;
    button.classList.toggle('used-up', remaining === 0);
    button.querySelector('.tool-count').textContent = remaining ? '1' : '已用';
    button.setAttribute('aria-label', `${button.querySelector('.tool-name').textContent}，${remaining ? '剩余 1 次' : '本局已使用'}`);
    if (button.hasAttribute('aria-pressed')) button.setAttribute('aria-pressed', String(button.dataset.tool === state.tool));
  }
  canvas.setAttribute('aria-label', `水果篮，${state.score} 分，${state.physics?.fruits.length || 0} 颗水果。${state.tool ? '点选水果使用道具，按 Esc 取消；左右方向键选择，回车确认。' : `当前${FRUITS[state.current].name}。左右拖动后松手投放，或使用方向键和空格。`}`);
  $('board-hint').style.opacity = state.status === 'playing' && !state.tool && state.drops < 3 ? '1' : '0';
  $('progress-label').textContent = state.highest >= 10 ? '西瓜达成！继续挑战双西瓜' : `已合出 ${state.highest + 1} / 11 种水果`;
  for (const [index, step] of [...$('fruit-chain').querySelectorAll('.fruit-step')].entries()) {
    step.classList.toggle('unlocked', index <= state.highest);
    step.classList.toggle('latest', index === state.highest);
  }
}

function toast(message) {
  clearTimeout(toastTimer);$('toast').textContent = message;$('toast').classList.add('show');
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2300);
}

function announce(message) {
  clearTimeout(announcementTimer);$('merge-announcement').textContent = message;$('merge-announcement').classList.add('show');
  announcementTimer = setTimeout(() => $('merge-announcement').classList.remove('show'), 1900);
}

function clearTool() {
  state.tool = null;state.targetId = null;state.aiming = false;activePointer = null;
  accumulator = 0;lastFrame = 0;
  updateUI();
}

function toolTargets() {
  return (state.physics?.fruits || []).filter(body => state.tool !== 'upgrade' || body.plugin.level < FRUITS.length - 1);
}

function bodyAt(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left) / rect.width * BOARD.width;
  const y = (clientY - rect.top) / rect.height * BOARD.height;
  return toolTargets().map(body => ({ body, distance: Math.hypot(body.position.x - x, body.position.y - y) / (body.circleRadius + 5) }))
    .filter(hit => hit.distance <= 1).sort((a, b) => a.distance - b.distance)[0]?.body || null;
}

function useTarget(body) {
  if (!body || !state.tool || state.status !== 'playing' || state.toolUses[state.tool] !== 1) return;
  const { x, y } = body.position;
  const level = body.plugin.level;
  const tool = state.tool;
  if (tool === 'bomb') {
    if (!state.physics.removeFruit(body)) return;
    state.renderer.burst(level, x, y, '砰！');
  } else {
    const upgraded = state.physics.upgradeFruit(body);
    if (!upgraded) { toast('西瓜已经是最高等级啦');return; }
    state.highest = Math.max(state.highest, upgraded.plugin.level);
    state.renderer.burst(upgraded.plugin.level, upgraded.position.x, upgraded.position.y, '升级！');
    toast(`已升级为${FRUITS[upgraded.plugin.level].name}`);
  }
  state.toolUses[tool] = 0;
  audio.play(tool, .4);clearTool();save();
}

function selectTool(tool) {
  if (state.status !== 'playing' || state.toolUses[tool] !== 1) return;
  audio.unlock();
  if (!state.physics.fruits.length) { toast('篮子还是空的，先放几颗水果吧');return; }
  if (state.tool === tool) { clearTool();return; }
  clearTool();
  if (tool === 'bomb' || tool === 'upgrade') {
    if (tool === 'upgrade' && !state.physics.fruits.some(b => b.plugin.level < FRUITS.length - 1)) { toast('西瓜已经是最高等级啦');return; }
    state.tool = tool;updateUI();canvas.focus({ preventScroll: true });
  } else if (tool === 'tidy') {
    const removed = state.physics.removeSmallest();
    if (removed) {
      state.toolUses.tidy = 0;
      state.renderer.burst(removed.plugin.level, removed.position.x, removed.position.y, '清理！');
      toast(`已去掉一颗${FRUITS[removed.plugin.level].name}`);audio.play('tidy', .4);updateUI();save();
    }
  } else if (tool === 'shake') {
    if (!state.physics.shake()) { toast('正在摇晃，稍等一下');return; }
    state.toolUses.shake = 0;
    $('board-frame').classList.remove('shaking');
    void $('board-frame').offsetWidth;
    $('board-frame').classList.add('shaking');
    audio.play('shake', .4);updateUI();save();
  }
}
for (const button of document.querySelectorAll('button[data-tool]')) button.addEventListener('click', () => selectTool(button.dataset.tool));
$('cancel-tool').addEventListener('click', clearTool);
$('board-frame').addEventListener('animationend', () => $('board-frame').classList.remove('shaking'));

function save() {
  if (!state.physics || !['playing', 'paused'].includes(state.status)) return;
  const success = writeStorage('session', {
    version: 1, score: state.score, current: state.current, next: state.next,
    highest: state.highest, drops: state.drops, bodies: state.physics.snapshot(),
    toolUses: { ...state.toolUses },
  });
  if (!success) $('footer-note').textContent = '当前浏览器无法保存进度';
}

function merge(level, x, y) {
  const doubleMelon = level === FRUITS.length;
  const points = doubleMelon ? 1000 : (level + 1) * (level + 2) / 2;
  state.score += points;
  if (state.score > state.best) { state.best = state.score;writeStorage('best', state.best); }
  if (level > state.highest && !doubleMelon) {
    state.highest = level;
    if (level >= 6) announce(level === 10 ? '合出大西瓜啦！' : `新朋友 · ${FRUITS[level].name}`);
  }
  if (doubleMelon) announce('双西瓜达成！奖励 +1000');
  audio.play(doubleMelon ? 'watermelon' : level >= 6 ? 'merge-large' : 'merge', .4);
  state.renderer.burst(level, x, y, points);
  updateUI();
}

function lose() {
  state.status = 'over';state.aiming = false;activePointer = null;
  state.tool = null;state.targetId = null;
  audio.setPlaying(false);audio.play('lose', .35);clearSession();saved = null;
  $('danger-message').hidden = true;
  overlay.classList.add('paused');overlay.hidden = false;
  $('welcome-fruits').hidden = true;
  $('overlay-kicker').textContent = state.score > state.bestAtStart ? '今天的你，又进步了一点' : '这一篮，也是满满的收获';
  $('overlay-title').textContent = state.score > state.bestAtStart ? '新的最高纪录！' : '小篮子装满啦';
  $('overlay-description').textContent = '再来一次，下颗西瓜也许就在前面。';
  $('end-score').hidden = false;$('final-score').textContent = state.score;
  $('play-label').textContent = '再玩一局';$('overlay-note').textContent = `本局合出：${FRUITS[state.highest].name}`;
  updateUI();
}

function setPlaying() {
  state.status = 'playing';overlay.hidden = true;state.aiming = false;activePointer = null;
  state.tool = null;state.targetId = null;
  lastFrame = 0;accumulator = 0;audio.setPlaying(true);audio.unlock();updateUI();
  canvas.focus({ preventScroll: true });
}

function startFresh() {
  state.physics?.destroy();
  state.physics = new FruitPhysics(merge, lose);
  Object.assign(state, { score: 0, current: 0, next: 0, highest: 0, aim: 210, nextDropAt: 0, drops: 0, bestAtStart: state.best });
  state.toolUses = freshToolUses();
  state.renderer.effects = [];saved = null;clearSession();
  $('danger-message').hidden = true;$('merge-announcement').classList.remove('show');
  setPlaying();save();
}

function restoreGame() {
  state.physics = new FruitPhysics(merge, lose);
  Object.assign(state, { score: saved.score, current: saved.current, next: saved.next, highest: saved.highest, drops: Number.isSafeInteger(saved.drops) ? saved.drops : 0, bestAtStart: state.best });
  state.toolUses = saved.toolUses ? { ...saved.toolUses } : freshToolUses();
  state.physics.restore(saved.bodies);saved = null;setPlaying();
}

function pause() {
  if (state.status !== 'playing') return;
  state.status = 'paused';state.aiming = false;activePointer = null;
  state.tool = null;state.targetId = null;
  audio.setPlaying(false);save();overlay.hidden = false;overlay.classList.add('paused');
  $('welcome-fruits').hidden = true;$('end-score').hidden = true;
  $('overlay-kicker').textContent = '水果们也休息一下';$('overlay-title').textContent = '慢慢来，等你回来';
  $('overlay-description').textContent = '这一篮快乐已经为你保留。';$('play-label').textContent = '继续游戏';
  $('overlay-note').textContent = '准备好，就接着玩';updateUI();
}

function drop() {
  if (state.status !== 'playing' || state.tool || state.physics.time < state.nextDropAt) return;
  const radius = FRUITS[state.current].radius;
  const x = clamp(state.aim, BOARD.left + radius + 2, BOARD.right - radius - 2);
  if (!state.physics.canDrop(state.current, x)) { toast('这个位置有点挤，换个落点试试'); return; }
  state.physics.addFruit(state.current, x, BOARD.spawn);
  state.drops++;state.current = state.next;state.next = randomFruit();
  const nextRadius = FRUITS[state.current].radius;
  state.aim = clamp(state.aim, BOARD.left + nextRadius + 2, BOARD.right - nextRadius - 2);
  state.nextDropAt = state.physics.time + 430;
  audio.play('drop', .3);updateUI();
  $('next-image').classList.add('pop');setTimeout(() => $('next-image').classList.remove('pop'), 150);
}

function updateAim(clientX) {
  const rect = canvas.getBoundingClientRect();
  const radius = FRUITS[state.current].radius;
  state.aim = clamp((clientX - rect.left) / rect.width * BOARD.width, BOARD.left + radius + 2, BOARD.right - radius - 2);
}

canvas.addEventListener('pointerdown', event => {
  if (state.status !== 'playing' || activePointer !== null || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
  event.preventDefault();canvas.focus({ preventScroll: true });activePointer = event.pointerId;
  if (state.tool) state.targetId = bodyAt(event.clientX, event.clientY)?.id ?? null;
  else { state.aiming = true;updateAim(event.clientX); }
  canvas.setPointerCapture(event.pointerId);audio.unlock();
});
canvas.addEventListener('pointermove', event => {
  if (state.status !== 'playing') return;
  if (state.tool) {
    if (activePointer === event.pointerId || (event.pointerType === 'mouse' && activePointer === null)) state.targetId = bodyAt(event.clientX, event.clientY)?.id ?? null;
    return;
  }
  if (activePointer === event.pointerId || (event.pointerType === 'mouse' && activePointer === null)) updateAim(event.clientX);
});
canvas.addEventListener('pointerup', event => {
  if (event.pointerId !== activePointer) return;
  event.preventDefault();
  const target = state.tool ? bodyAt(event.clientX, event.clientY) : null;
  const tool = state.tool;
  if (!tool) updateAim(event.clientX);
  state.aiming = false;activePointer = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (tool) {
    if (target) useTarget(target);
    else toast(tool === 'upgrade' ? '点一颗可升级的水果，或点「取消」' : '请点篮子里的水果，或点「取消」');
  } else drop();
});
const cancelPointer = () => { activePointer = null;state.aiming = false; };
canvas.addEventListener('pointercancel', cancelPointer);
canvas.addEventListener('lostpointercapture', cancelPointer);
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('keydown', event => {
  if (state.status !== 'playing') return;
  if (state.tool) {
    if (['ArrowLeft', 'ArrowRight', ' ', 'ArrowDown', 'Enter', 'Escape'].includes(event.key)) event.preventDefault();
    if (event.key === 'Escape') clearTool();
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const targets = toolTargets();
      const index = targets.findIndex(b => b.id === state.targetId);
      state.targetId = targets.length ? targets[(index + (event.key === 'ArrowLeft' ? -1 : 1) + targets.length) % targets.length].id : null;
    } else if (event.key === 'Enter' && !event.repeat) useTarget(state.physics.fruits.find(b => b.id === state.targetId));
    return;
  }
  const radius = FRUITS[state.current].radius;
  if (['ArrowLeft', 'ArrowRight', ' ', 'ArrowDown'].includes(event.key)) event.preventDefault();
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') state.aim = clamp(state.aim + (event.key === 'ArrowLeft' ? -12 : 12), BOARD.left + radius + 2, BOARD.right - radius - 2);
  if ((event.key === ' ' || event.key === 'ArrowDown') && !event.repeat) { audio.unlock();drop(); }
  if (event.key === 'Escape') pause();
});

$('play-button').addEventListener('click', () => {
  audio.unlock();
  if (state.status === 'paused') setPlaying();
  else if (state.status === 'welcome' && saved) restoreGame();
  else startFresh();
});
$('pause-button').addEventListener('click', pause);
$('sound-button').addEventListener('click', () => { audio.toggleSound();syncAudioButtons(); });
$('music-button').addEventListener('click', () => {
  audio.unlock();audio.toggleMusic();syncAudioButtons();
  if (audio.musicEnabled && state.status !== 'playing') toast('开始或继续游戏时播放音乐');
});

function openDialog(id) {
  resumeAfterDialog = state.status === 'playing';
  pause();$(id).showModal();audio.play('button', .25);
}
$('help-button').addEventListener('click', () => openDialog('help-dialog'));
$('restart-button').addEventListener('click', () => {
  if (state.status === 'welcome' && !saved) return;
  if (state.status === 'over') { startFresh();return; }
  openDialog('restart-dialog');
});
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => $(button.dataset.close).close());
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('close', () => {
    if (resumeAfterDialog && state.status === 'paused' && !document.hidden) setPlaying();
    resumeAfterDialog = false;
  });
}
$('confirm-restart').addEventListener('click', () => { resumeAfterDialog = false;$('restart-dialog').close();startFresh(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('pagehide', () => { pause();save(); });
setInterval(save, 2500);

function frame(timestamp) {
  const delta = lastFrame ? Math.min(timestamp - lastFrame, 90) : 0;
  lastFrame = timestamp;
  if (state.status === 'playing' && !state.tool) {
    accumulator += delta;
    const step = 1000 / 60;
    let steps = 0;
    while (accumulator >= step && steps++ < 5 && state.status === 'playing') {
      state.physics.step(step);accumulator -= step;
    }
    $('danger-message').hidden = state.status !== 'playing' || !(state.physics.danger > .1);
  } else accumulator = 0;
  state.renderer.draw(state, delta);
  requestAnimationFrame(frame);
}

async function init() {
  syncAudioButtons();updateUI();
  try {
    if (!window.Matter) throw new Error('物理引擎未能加载');
    const images = await Promise.all(FRUITS.map(fruit => new Promise((resolve, reject) => {
      const img = new Image();img.onload = () => resolve(img);img.onerror = () => reject(new Error('水果图片未能加载'));img.src = fruit.image;
    })));
    state.renderer = new GameRenderer(canvas, images);
    state.status = 'welcome';
    if (saved) {
      $('overlay-kicker').textContent = '这一篮快乐，还在等你';$('overlay-title').textContent = '欢迎回到水果小院';
      $('overlay-description').textContent = `上次玩到了 ${saved.score} 分，接着合成吧。`;$('play-label').textContent = '继续上次的游戏';
      $('overlay-note').textContent = '也可以点击下方「重新开始」';
    } else $('play-label').textContent = '开始收获快乐';
    $('play-button').disabled = false;updateUI();requestAnimationFrame(frame);
    if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('./sw.js').catch(() => {});
  } catch (error) {
    $('overlay-title').textContent = '水果还没准备好';$('overlay-description').textContent = `${error.message}，请刷新页面重试。`;
    $('play-label').textContent = '刷新重试';$('play-button').disabled = false;
    $('play-button').replaceWith($('play-button').cloneNode(true));$('play-button').addEventListener('click', () => location.reload());
    console.error(error);
  }
}
init();
