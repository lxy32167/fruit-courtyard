const PREFIX = 'fruit-courtyard-v1:';

export function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}

export function writeStorage(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch { return false; }
}

export function clearSession() {
  try { localStorage.removeItem(PREFIX + 'session'); } catch { /* Private browsing can disallow storage. */ }
}

export function validSession(session) {
  return session?.version === 1 && Number.isSafeInteger(session.score) && session.score >= 0
    && Number.isInteger(session.current) && session.current >= 0 && session.current <= 4
    && Number.isInteger(session.next) && session.next >= 0 && session.next <= 4
    && Number.isInteger(session.highest) && session.highest >= 0 && session.highest < 11
    && (session.toolUses === undefined || (session.toolUses !== null
      && ['bomb', 'tidy', 'upgrade', 'shake'].every(key => session.toolUses[key] === 0 || session.toolUses[key] === 1)))
    && Array.isArray(session.bodies) && session.bodies.length <= 350
    && session.bodies.every(b => Number.isInteger(b.level) && b.level >= 0 && b.level < 11
      && ['x', 'y', 'angle', 'vx', 'vy', 'angularVelocity'].every(k => Number.isFinite(b[k]))
      && b.x >= 0 && b.x <= 420 && b.y > -300 && b.y <= 600);
}
