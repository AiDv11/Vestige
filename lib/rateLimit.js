// ===========================================================================
// RATE LIMITING
// Once this is on a public URL, the Groq key is effectively exposed to
// anyone who finds the site. This caps how much any one visitor can spend.
//
// In-memory on purpose: one small server, one process. A multi-instance
// deploy would need Redis, but that's a problem this app doesn't have.
// ===========================================================================

/**
 * @param {object} options
 * @param {number} options.windowMs  size of the rolling window
 * @param {number} options.max       requests allowed per key per window
 * @param {string} options.message   what the client is told when blocked
 */
export function rateLimit({ windowMs, max, message }) {
  /** @type {Map<string, number[]>} key → timestamps of recent hits */
  const hits = new Map();

  // Drop stale entries so the map can't grow without bound.
  const sweep = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, times] of hits) {
      const live = times.filter((t) => t > cutoff);
      if (live.length === 0) hits.delete(key);
      else hits.set(key, live);
    }
  }, windowMs);

  sweep.unref?.(); // don't hold the process open just for the sweeper

  return function limiter(req, res, next) {
    const key = req.sessionId || req.ip;
    const now = Date.now();
    const cutoff = now - windowMs;

    const times = (hits.get(key) ?? []).filter((t) => t > cutoff);

    if (times.length >= max) {
      const retryAfter = Math.ceil((times[0] + windowMs - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ error: message });
    }

    times.push(now);
    hits.set(key, times);
    next();
  };
}
