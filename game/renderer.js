import { BOARD, FRUITS } from './fruits.js';

export class GameRenderer {
  constructor(canvas, images) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: false });
    this.images = images;
    this.effects = [];
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.resize = this.resize.bind(this);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(canvas.closest('.play-area'));
    this.resize();
  }

  resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const area = this.canvas.closest('.play-area').getBoundingClientRect();
    const width = Math.min(area.width, area.height * BOARD.width / BOARD.height);
    const height = width * BOARD.height / BOARD.width;
    this.canvas.parentElement.style.width = `${width}px`;
    this.canvas.parentElement.style.height = `${height}px`;
    this.canvas.width = Math.max(1, Math.round((width - 2) * ratio));
    this.canvas.height = Math.max(1, Math.round((height - 2) * ratio));
  }

  fruit(level, x, y, radius, angle = 0, opacity = 1, scale = 1) {
    const ctx = this.context;
    const image = this.images[level];
    if (!image) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.globalAlpha = opacity;
    // Fit the visible body to the collider, leaving a little extra room for stems.
    const width = radius * 2.09 * scale;
    const height = width * image.naturalHeight / image.naturalWidth;
    ctx.drawImage(image, -width / 2, -height / 2 - radius * .025, width, height);
    ctx.restore();
  }

  burst(level, x, y, points) {
    const color = FRUITS[Math.min(level, 10)].color;
    this.effects.push({ type: 'label', x, y, age: 0, duration: 950, text: typeof points === 'number' ? `+${points}` : points, color: '#587347' });
    if (!this.reducedMotion) {
      this.effects.push({ type: 'ring', x, y, age: 0, duration: 400, color, radius: FRUITS[Math.min(level, 10)].radius });
      for (let i = 0; i < 9; i++) {
        const angle = Math.random() * Math.PI * 2;
        this.effects.push({ type: 'particle', x, y, vx: Math.cos(angle) * (40 + Math.random() * 70), vy: Math.sin(angle) * 90 - 35, size: 2 + Math.random() * 3, age: 0, duration: 450 + Math.random() * 350, color });
      }
    }
    if (this.effects.length > 120) this.effects.splice(0, this.effects.length - 120);
  }

  draw(state, delta) {
    const ctx = this.context;
    ctx.setTransform(this.canvas.width / BOARD.width, 0, 0, this.canvas.height / BOARD.height, 0, 0);
    ctx.fillStyle = '#fcf7e8';
    ctx.fillRect(0, 0, BOARD.width, BOARD.height);
    const basket = ctx.createLinearGradient(0, 100, 0, BOARD.floor);
    basket.addColorStop(0, '#fbf4df'); basket.addColorStop(1, '#f3e5bf');
    ctx.fillStyle = basket;
    ctx.fillRect(BOARD.left, 88, BOARD.right - BOARD.left, BOARD.floor - 88);
    ctx.strokeStyle = '#eadcbb';ctx.lineWidth = 1;
    ctx.beginPath();ctx.moveTo(BOARD.left, 88);ctx.lineTo(BOARD.right, 88);ctx.stroke();
    ctx.fillStyle = '#ffffff4d';ctx.fillRect(BOARD.left + 2, 89, 5, BOARD.floor - 89);
    ctx.fillStyle = '#d5bf9240';ctx.fillRect(BOARD.right - 5, 89, 5, BOARD.floor - 89);
    ctx.strokeStyle = '#cdb488';ctx.lineWidth = 2.5;
    ctx.beginPath();ctx.moveTo(BOARD.left, 88);ctx.lineTo(BOARD.left, BOARD.floor - 8);
    ctx.quadraticCurveTo(BOARD.left, BOARD.floor, BOARD.left + 8, BOARD.floor);
    ctx.lineTo(BOARD.right - 8, BOARD.floor);ctx.quadraticCurveTo(BOARD.right, BOARD.floor, BOARD.right, BOARD.floor - 8);
    ctx.lineTo(BOARD.right, 88);ctx.stroke();
    ctx.fillStyle = '#c6ae7950';ctx.fillRect(26, BOARD.floor + 4, BOARD.width - 52, 3);

    const danger = state.physics?.danger || 0;
    ctx.save();ctx.setLineDash([5, 6]);ctx.lineWidth = danger > 0 ? 1.7 : 1;
    ctx.strokeStyle = danger > 0 ? `rgba(194,98,70,${.5 + danger * .5})` : '#cebc925e';
    ctx.beginPath();ctx.moveTo(26, BOARD.danger);ctx.lineTo(394, BOARD.danger);ctx.stroke();ctx.restore();
    if (danger > 0) {
      ctx.fillStyle = `rgba(207,108,75,${danger * .08})`;ctx.fillRect(19, 89, 382, 50);
    }

    const bodies = state.physics?.fruits || [];
    for (const body of bodies) {
      const age = state.physics.time - body.plugin.born;
      const scale = !this.reducedMotion && age < 180 ? 1 + Math.sin(age / 180 * Math.PI) * .065 : 1;
      this.fruit(body.plugin.level, body.position.x, body.position.y, body.circleRadius, body.angle, 1, scale);
    }

    if (state.tool && state.status === 'playing') {
      for (const body of bodies) {
        if (state.tool === 'upgrade' && body.plugin.level === 10) continue;
        const selected = body.id === state.targetId;
        ctx.save();ctx.strokeStyle = state.tool === 'bomb' ? '#bd7150' : '#6d914f';ctx.lineWidth = selected ? 3 : 1.3;
        ctx.globalAlpha = selected ? 1 : .55;ctx.setLineDash(selected ? [] : [4, 4]);
        ctx.beginPath();ctx.arc(body.position.x, body.position.y, body.circleRadius + 5, 0, Math.PI * 2);ctx.stroke();ctx.restore();
      }
    }

    if (state.status === 'playing' && !state.tool) {
      const level = state.current;
      const radius = FRUITS[level].radius;
      const ready = state.physics.time >= state.nextDropAt;
      let landing = BOARD.floor;
      for (const b of bodies) {
        const dx = Math.abs(state.aim - b.position.x);
        const sum = radius + b.circleRadius;
        if (dx < sum && b.position.y > BOARD.spawn) landing = Math.min(landing, b.position.y - Math.sqrt(sum * sum - dx * dx));
      }
      ctx.save();ctx.setLineDash([4, 7]);ctx.lineWidth = 1.5;ctx.strokeStyle = '#acb78a88';
      ctx.beginPath();ctx.moveTo(state.aim, BOARD.spawn + radius + 8);ctx.lineTo(state.aim, Math.max(BOARD.spawn + radius + 8, landing - 5));ctx.stroke();ctx.restore();
      if (state.aiming) {
        ctx.fillStyle = '#8fa17022';ctx.beginPath();ctx.ellipse(state.aim, Math.min(BOARD.floor - 3, landing + radius), radius * .7, 3, 0, 0, Math.PI * 2);ctx.fill();
      }
      this.fruit(level, state.aim, BOARD.spawn, radius, 0, ready ? 1 : .35);
      ctx.fillStyle = '#a3b085';ctx.beginPath();ctx.moveTo(state.aim - 3, 13);ctx.lineTo(state.aim + 3, 13);ctx.lineTo(state.aim, 17);ctx.closePath();ctx.fill();
    }

    for (const effect of this.effects) {
      if (state.status === 'playing') effect.age += delta;
      const t = effect.age / effect.duration;
      if (t >= 1) continue;
      ctx.save();ctx.globalAlpha = 1 - t;ctx.fillStyle = effect.color;ctx.strokeStyle = effect.color;
      if (effect.type === 'particle') {
        const sec = effect.age / 1000;
        ctx.beginPath();ctx.arc(effect.x + effect.vx * sec, effect.y + effect.vy * sec + 70 * sec * sec, effect.size * (1 - t * .5), 0, Math.PI * 2);ctx.fill();
      } else if (effect.type === 'ring') {
        ctx.lineWidth = 3 * (1 - t);ctx.beginPath();ctx.arc(effect.x, effect.y, effect.radius * (.6 + t * .7), 0, Math.PI * 2);ctx.stroke();
      } else {
        ctx.font = 'bold 21px -apple-system, sans-serif';ctx.textAlign = 'center';ctx.lineWidth = 4;ctx.strokeStyle = '#fff9e9';
        ctx.strokeText(effect.text, effect.x, effect.y - 15 - t * 38);ctx.fillText(effect.text, effect.x, effect.y - 15 - t * 38);
      }
      ctx.restore();
    }
    this.effects = this.effects.filter(e => e.age < e.duration);
  }
}
