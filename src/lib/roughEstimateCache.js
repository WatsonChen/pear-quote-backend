import { createHash } from "node:crypto";

const CACHE_TTL_MS = readPositiveIntEnv("ROUGH_ESTIMATE_CACHE_TTL_MS", 30 * 60 * 1000);
const CACHE_MAX_ENTRIES = 200;

// Per serverless instance: identical briefs on the same warm instance return
// the identical result (and cost nothing); a cold instance simply recomputes.
const cache = new Map();

function readPositiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function makeRoughEstimateCacheKey({ description, useChinese }) {
  const normalized = description.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256")
    .update(`${useChinese ? "zh" : "en"}\n${normalized}`)
    .digest("hex");
}

export function getCachedRoughEstimate(key, now = Date.now()) {
  if (CACHE_TTL_MS === 0) return null;

  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    cache.delete(key);
    return null;
  }

  return structuredClone(entry.value);
}

export function setCachedRoughEstimate(key, value, now = Date.now()) {
  if (CACHE_TTL_MS === 0) return;

  if (cache.size >= CACHE_MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { value: structuredClone(value), expiresAt: now + CACHE_TTL_MS });
}

export function clearRoughEstimateCache() {
  cache.clear();
}
