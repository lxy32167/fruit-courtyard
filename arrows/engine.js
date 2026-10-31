// The first vertex is the arrow head. Half-cell occupancy also detects diagonal crossings.
export function createBoard(level) {
  const occupied = new Map();
  const key = (x, y) => `${x},${y}`;
  const arrows = level.a.map((indices, id) => {
    const points = indices.map(i => ({ x: i % level.w, y: level.h - 1 - Math.floor(i / level.w) }));
    let length = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) * 2;
      length += Math.hypot(b.x - a.x, b.y - a.y);
      for (let s = 0; s <= steps; s++) {
        const k = key(a.x * 2 + (b.x - a.x) * 2 * s / steps, a.y * 2 + (b.y - a.y) * 2 * s / steps);
        if (!occupied.has(k)) occupied.set(k, new Set());
        occupied.get(k).add(id);
      }
    }
    const dx = Math.sign(points[0].x - points[1].x), dy = Math.sign(points[0].y - points[1].y);
    return { id, points, dx, dy, length, blockers: [], hits: [] };
  });
  for (const arrow of arrows) {
    const head = arrow.points[0], blockers = new Set();
    let x = head.x * 2 + arrow.dx, y = head.y * 2 + arrow.dy, step = 1;
    while (x >= 0 && y >= 0 && x <= (level.w - 1) * 2 && y <= (level.h - 1) * 2) {
      for (const id of occupied.get(key(x, y)) || []) {
        if (id !== arrow.id && !blockers.has(id)) {
          blockers.add(id);
          arrow.hits.push({ id, distance: step / 2 * Math.hypot(arrow.dx, arrow.dy) });
        }
      }
      x += arrow.dx; y += arrow.dy; step++;
    }
    arrow.blockers = [...blockers];
  }
  return { ...level, arrows };
}

export function freeArrows(board, removed) {
  return board.arrows.filter(a => !removed.has(a.id) && a.blockers.every(id => removed.has(id)));
}

export function firstBlocker(arrow, removed) {
  return arrow.hits.find(hit => !removed.has(hit.id));
}

export function pointSegmentDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

// Extend the head and trim the tail by the same distance: the line follows its own bends.
export function movingPath(arrow, distance) {
  if (!distance) return arrow.points;
  const norm = Math.hypot(arrow.dx, arrow.dy), head = arrow.points[0];
  const points = [{ x: head.x + arrow.dx / norm * distance, y: head.y + arrow.dy / norm * distance }, ...arrow.points];
  const result = [points[0]];
  let remaining = arrow.length;
  for (let i = 1; i < points.length && remaining > 0; i++) {
    const a = points[i - 1], b = points[i], length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length <= remaining) { result.push(b); remaining -= length; }
    else { result.push({ x: a.x + (b.x - a.x) * remaining / length, y: a.y + (b.y - a.y) * remaining / length }); break; }
  }
  return result;
}
