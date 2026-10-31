import { BOARD, FRUITS, clamp } from './fruits.js';

export class FruitPhysics {
  constructor(onMerge, onLose) {
    const { Engine, Bodies, Composite, Events } = window.Matter;
    this.engine = Engine.create({ enableSleeping: true, positionIterations: 8, velocityIterations: 6 });
    this.engine.gravity.y = 1.35;
    this.time = 0;
    this.mergeQueue = [];
    this.onMerge = onMerge;
    this.onLose = onLose;
    this.lost = false;
    this.shakeUntil = 0;
    this.shakeNextPulse = 0;
    const wall = { isStatic: true, friction: .3, restitution: .12, label: 'wall' };
    Composite.add(this.engine.world, [
      Bodies.rectangle(0, 250, 36, 1000, wall),
      Bodies.rectangle(420, 250, 36, 1000, wall),
      Bodies.rectangle(210, BOARD.floor + 24, 450, 48, wall),
    ]);
    const queueMerges = ({ pairs }) => {
      for (const pair of pairs) {
        const a = pair.bodyA, b = pair.bodyB;
        if (a.plugin.fruit && b.plugin.fruit && a.plugin.level === b.plugin.level
          && this.time - a.plugin.born > 90 && this.time - b.plugin.born > 90) this.mergeQueue.push([a, b]);
      }
    };
    Events.on(this.engine, 'collisionStart', queueMerges);
    Events.on(this.engine, 'collisionActive', queueMerges);
  }

  get fruits() { return this.engine.world.bodies.filter(body => body.plugin.fruit); }

  addFruit(level, x, y, options = {}) {
    const { Bodies, Body, Composite } = window.Matter;
    const radius = FRUITS[level].radius;
    const body = Bodies.circle(clamp(x, BOARD.left + radius, BOARD.right - radius), y, radius, {
      restitution: .2, friction: .28, frictionStatic: .5, frictionAir: .008,
      density: .0016, slop: .03, sleepThreshold: 75, label: FRUITS[level].name,
      plugin: { fruit: true, level, born: this.time, dangerMs: 0, ...options },
    }, 32);
    Body.setAngle(body, options.angle || 0);
    Composite.add(this.engine.world, body);
    return body;
  }

  canDrop(level, x) {
    const radius = FRUITS[level].radius;
    return !this.fruits.some(b => Math.hypot(b.position.x - x, b.position.y - BOARD.spawn) < (b.circleRadius + radius) * .92);
  }

  wakeFruits() {
    for (const body of this.fruits) window.Matter.Sleeping.set(body, false);
  }

  removeFruit(body) {
    if (this.lost || !this.fruits.includes(body)) return false;
    window.Matter.Composite.remove(this.engine.world, body);
    this.mergeQueue = this.mergeQueue.filter(pair => !pair.includes(body));
    this.wakeFruits();
    return true;
  }

  removeSmallest() {
    const body = this.fruits.reduce((smallest, fruit) => !smallest
      || fruit.plugin.level < smallest.plugin.level
      || (fruit.plugin.level === smallest.plugin.level && fruit.position.y < smallest.position.y) ? fruit : smallest, null);
    return body && this.removeFruit(body) ? body : null;
  }

  upgradeFruit(body) {
    if (this.lost || !this.fruits.includes(body) || body.plugin.level >= FRUITS.length - 1) return null;
    const { Body } = window.Matter;
    const level = body.plugin.level + 1;
    const { x, y } = body.position;
    this.removeFruit(body);
    const upgraded = this.addFruit(level, x, Math.min(y, BOARD.floor - FRUITS[level].radius), { angle: body.angle });
    Body.setVelocity(upgraded, { x: clamp(body.velocity.x, -3, 3), y: -1.5 });
    return upgraded;
  }

  shake() {
    if (this.lost || !this.fruits.length || this.time < this.shakeUntil) return false;
    const { Body } = window.Matter;
    this.wakeFruits();
    this.shakeUntil = this.time + 1500;
    this.shakeNextPulse = this.time + 450;
    for (const body of this.fruits) {
      Body.setVelocity(body, { x: (Math.random() - .5) * 13, y: -8 - Math.random() * 3 });
      Body.setAngularVelocity(body, (Math.random() - .5) * .24);
      body.plugin.born = this.time;
      body.plugin.dangerMs = 0;
    }
    this.danger = 0;
    return true;
  }

  step(delta) {
    if (this.lost) return;
    const { Engine, Body, Composite } = window.Matter;
    this.time += delta;
    const shaking = this.time < this.shakeUntil;
    this.engine.gravity.x = shaking ? Math.sin((this.shakeUntil - this.time) / 1500 * Math.PI * 8) * 2 : 0;
    if (shaking && this.time >= this.shakeNextPulse) {
      const direction = Math.sin((this.shakeUntil - this.time) / 1500 * Math.PI * 8) >= 0 ? 1 : -1;
      this.wakeFruits();
      for (const body of this.fruits) {
        Body.setVelocity(body, {
          x: clamp(body.velocity.x + direction * (3 + Math.random() * 2), -10, 10),
          y: Math.min(body.velocity.y, -4.5 - Math.random() * 2),
        });
        body.plugin.dangerMs = 0;
      }
      this.shakeNextPulse += 450;
    }
    Engine.update(this.engine, delta);
    const removed = new Set();
    for (const [a, b] of this.mergeQueue) {
      if (removed.has(a.id) || removed.has(b.id)) continue;
      removed.add(a.id); removed.add(b.id);
      const level = a.plugin.level;
      const x = (a.position.x + b.position.x) / 2;
      const y = (a.position.y + b.position.y) / 2;
      Composite.remove(this.engine.world, [a, b]);
      const nextLevel = level + 1;
      if (nextLevel < FRUITS.length) {
        const radius = FRUITS[nextLevel].radius;
        const merged = this.addFruit(nextLevel, x, Math.min(BOARD.floor - radius, y));
        Body.setVelocity(merged, { x: clamp((a.velocity.x + b.velocity.x) * .3, -3, 3), y: -1.5 });
        Body.setAngularVelocity(merged, (a.angularVelocity + b.angularVelocity) * .25);
      }
      this.onMerge(nextLevel, x, y);
    }
    this.mergeQueue.length = 0;
    let danger = 0;
    for (const body of this.fruits) {
      if (body.speed > 16) Body.setSpeed(body, 16);
      const tooHigh = body.position.y - body.circleRadius < BOARD.danger;
      const settled = body.speed < 2.3 || body.isSleeping;
      if (tooHigh && this.time > this.shakeUntil + 1000 && this.time - body.plugin.born > 1800 && settled) body.plugin.dangerMs += delta;
      else body.plugin.dangerMs = Math.max(0, body.plugin.dangerMs - delta * 2);
      danger = Math.max(danger, body.plugin.dangerMs);
      if (body.plugin.dangerMs >= 2200) {
        this.lost = true;
        this.onLose();
        break;
      }
    }
    this.danger = danger / 2200;
  }

  snapshot() {
    return this.fruits.map(b => ({
      level: b.plugin.level, x: b.position.x, y: b.position.y, angle: b.angle,
      vx: b.velocity.x, vy: b.velocity.y, angularVelocity: b.angularVelocity,
      age: this.time - b.plugin.born, dangerMs: b.plugin.dangerMs,
    }));
  }

  restore(bodies) {
    const { Body } = window.Matter;
    for (const saved of bodies) {
      const b = this.addFruit(saved.level, saved.x, saved.y, {
        angle: saved.angle, born: this.time - clamp(saved.age || 0, 0, 60000),
        dangerMs: clamp(saved.dangerMs || 0, 0, 2100),
      });
      Body.setVelocity(b, { x: clamp(saved.vx, -16, 16), y: clamp(saved.vy, -16, 16) });
      Body.setAngularVelocity(b, clamp(saved.angularVelocity, -.3, .3));
    }
  }

  destroy() {
    const { Events, Composite, Engine } = window.Matter;
    Events.off(this.engine);
    Composite.clear(this.engine.world, false);
    Engine.clear(this.engine);
  }
}
