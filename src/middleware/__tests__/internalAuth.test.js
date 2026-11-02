/**
 * Tests for internalAuth.js — shared-secret gate for POST /api/social-login.
 * Run with: node src/middleware/__tests__/internalAuth.test.js
 * No DB, no HTTP server.
 */

import { requireInternalAuth, INTERNAL_AUTH_HEADER } from "../internalAuth.js";

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function run({ secret, nodeEnv, headers = {} }) {
  const prevSecret = process.env.INTERNAL_AUTH_SECRET;
  const prevEnv = process.env.NODE_ENV;
  if (secret === undefined) delete process.env.INTERNAL_AUTH_SECRET;
  else process.env.INTERNAL_AUTH_SECRET = secret;
  process.env.NODE_ENV = nodeEnv;

  const result = { status: null, body: null, nextCalled: false };
  const res = {
    status(code) {
      result.status = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };

  const silence = { error: console.error, warn: console.warn };
  console.error = () => {};
  console.warn = () => {};
  try {
    requireInternalAuth({ headers }, res, () => {
      result.nextCalled = true;
    });
  } finally {
    console.error = silence.error;
    console.warn = silence.warn;
    if (prevSecret === undefined) delete process.env.INTERNAL_AUTH_SECRET;
    else process.env.INTERNAL_AUTH_SECRET = prevSecret;
    process.env.NODE_ENV = prevEnv;
  }
  return result;
}

console.log("\n[1] secret configured");
{
  const ok = run({ secret: "s3cret-value", nodeEnv: "production", headers: { [INTERNAL_AUTH_HEADER]: "s3cret-value" } });
  assert("correct secret passes", ok.nextCalled && ok.status === null);

  const missing = run({ secret: "s3cret-value", nodeEnv: "production" });
  assert("missing header -> 401", missing.status === 401 && !missing.nextCalled);

  const wrong = run({ secret: "s3cret-value", nodeEnv: "production", headers: { [INTERNAL_AUTH_HEADER]: "nope" } });
  assert("wrong secret -> 401", wrong.status === 401 && !wrong.nextCalled);

  const prefix = run({ secret: "s3cret-value", nodeEnv: "production", headers: { [INTERNAL_AUTH_HEADER]: "s3cret" } });
  assert("prefix of the secret -> 401", prefix.status === 401 && !prefix.nextCalled);

  const empty = run({ secret: "s3cret-value", nodeEnv: "production", headers: { [INTERNAL_AUTH_HEADER]: "" } });
  assert("empty header -> 401", empty.status === 401 && !empty.nextCalled);

  const arr = run({ secret: "s3cret-value", nodeEnv: "production", headers: { [INTERNAL_AUTH_HEADER]: ["s3cret-value", "x"] } });
  assert("first value of a repeated header is used", arr.nextCalled);

  const other = run({ secret: "s3cret-value", nodeEnv: "production", headers: { authorization: "Bearer s3cret-value" } });
  assert("secret in another header does not count", other.status === 401);

  const body = JSON.stringify(wrong.body);
  assert("401 body does not echo the secret", !body.includes("s3cret-value"));
}

console.log("\n[2] secret not configured");
{
  const prod = run({ secret: undefined, nodeEnv: "production" });
  assert("production fails closed -> 503", prod.status === 503 && !prod.nextCalled);

  const prodEmpty = run({ secret: "", nodeEnv: "production" });
  assert("empty secret in production fails closed -> 503", prodEmpty.status === 503 && !prodEmpty.nextCalled);

  const dev = run({ secret: undefined, nodeEnv: "development" });
  assert("development allows (local convenience)", dev.nextCalled);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
