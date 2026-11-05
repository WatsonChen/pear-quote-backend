/**
 * Small fixed-window rate limiter for the public proposal endpoints.
 *
 * The counters live in this process, so on serverless hosting the limit is per
 * instance: it stops a script hammering one instance, not a distributed flood.
 * Move the counters to a shared store before relying on it as a hard guarantee.
 */
export function createRateLimiter({ windowMs, max, keyPrefix = "" }) {
  const hits = new Map();

  return function rateLimit(req, res, next) {
    const now = Date.now();
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const key = `${keyPrefix}:${ip}:${req.params?.shareToken || ""}`;

    if (hits.size > 5000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }

    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      res.set("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      return res
        .status(429)
        .json({ success: false, message: "Too many requests" });
    }
    return next();
  };
}
