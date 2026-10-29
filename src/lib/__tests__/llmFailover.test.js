/**
 * Tests for llm.js / anthropic.js — multi-provider failover.
 * Run with: node src/lib/__tests__/llmFailover.test.js
 *
 * Hand-rolled assert harness (same convention as proposalSerializer.test.js).
 * Fake providers and an injected clock: no network, no API keys.
 *
 * Coverage:
 *   1. first provider answers -> second never called
 *   2. billing/auth error (401/402/403) -> next provider answers
 *   3. Anthropic low-balance 400 is treated as billing, not a request error
 *   4. 429 / 5xx / 404 / network error -> failover
 *   5. a non-billing 400 is NOT failed over (rethrown as-is)
 *   6. billing failure starts a cooldown; later calls skip that provider
 *   7. cooldown expires and the provider is tried again
 *   8. all providers cooling down -> still tried (no total lockout)
 *   9. all providers fail -> exhausted error with attempts and status
 *  10. 429 is preferred as the representative status when providers disagree
 *  11. no configured provider -> AiNotConfiguredError
 *  12. AI_PROVIDER_ORDER parsing
 *  13. Gemini-shaped parts convert to Claude content blocks
 */

import {
  AiNotConfiguredError,
  AiProvidersExhaustedError,
  classifyProviderError,
  getAiProviderOrder,
  runAiChain,
} from "../llm.js";
import { isAnthropicBillingError, toAnthropicContent } from "../anthropic.js";

let passed = 0;
let failed = 0;

function assert(label, condition, extra = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${extra ? `  (${extra})` : ""}`);
    failed++;
  }
}

const silentLog = { info() {}, warn() {} };

function httpError(status, message = `HTTP ${status}`) {
  return Object.assign(new Error(message), { status });
}

function fakeProvider(name, behaviour) {
  const provider = {
    name,
    calls: 0,
    isConfigured: () => true,
    async generate() {
      provider.calls += 1;
      return behaviour();
    },
  };
  return provider;
}

function run(providers, extra = {}) {
  return runAiChain({
    providers,
    parts: [{ text: "hi" }],
    options: { purpose: "roughEstimate" },
    log: silentLog,
    cooldowns: new Map(),
    ...extra,
  });
}

async function rejects(promise) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

console.log("1. First provider answers");
{
  const a = fakeProvider("anthropic", () => "from-claude");
  const b = fakeProvider("gemini", () => "from-gemini");
  const text = await run([a, b]);
  assert("returns first provider's text", text === "from-claude");
  assert("second provider not called", b.calls === 0);
}

console.log("2. Billing/auth errors fail over");
for (const status of [401, 402, 403]) {
  const a = fakeProvider("anthropic", () => {
    throw httpError(status);
  });
  const b = fakeProvider("gemini", () => "from-gemini");
  const text = await run([a, b]);
  assert(`${status} -> next provider answers`, text === "from-gemini");
}

console.log("3. Anthropic low-balance 400 is billing");
{
  const lowBalance = httpError(
    400,
    "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing",
  );
  assert("isAnthropicBillingError", isAnthropicBillingError(lowBalance));
  const classification = classifyProviderError(lowBalance);
  assert("classified as billing_or_auth", classification.reason === "billing_or_auth");
  assert("normalised to status 402", classification.status === 402);

  const a = fakeProvider("anthropic", () => {
    throw lowBalance;
  });
  const b = fakeProvider("gemini", () => "from-gemini");
  assert("fails over to Gemini", (await run([a, b])) === "from-gemini");
}

console.log("3b. Gemini invalid key (400 API_KEY_INVALID) is auth");
{
  const invalid = httpError(400, "[400 ] API key not valid. Please pass a valid API key.");
  assert("classified as billing_or_auth", classifyProviderError(invalid).reason === "billing_or_auth");
}

console.log("4. Rate limit / overload / retired model / network fail over");
{
  const cases = [
    ["429", httpError(429)],
    ["503", httpError(503)],
    ["529 overloaded", httpError(529)],
    ["404 model", httpError(404)],
    [
      "connection error",
      Object.assign(new Error("Connection error."), { name: "APIConnectionError" }),
    ],
    ["ECONNRESET", Object.assign(new Error("boom"), { code: "ECONNRESET" })],
    [
      "refusal",
      Object.assign(new Error("refused"), { errorCode: "AI_PROVIDER_REFUSAL" }),
    ],
  ];
  for (const [label, error] of cases) {
    const a = fakeProvider("anthropic", () => {
      throw error;
    });
    const b = fakeProvider("gemini", () => "from-gemini");
    assert(`${label} -> failover`, (await run([a, b])) === "from-gemini");
  }
}

console.log("5. Non-billing 400 is not failed over");
{
  const bad = httpError(400, "messages: text content blocks must be non-empty");
  const a = fakeProvider("anthropic", () => {
    throw bad;
  });
  const b = fakeProvider("gemini", () => "from-gemini");
  const error = await rejects(run([a, b]));
  assert("original error rethrown", error === bad);
  assert("second provider not called", b.calls === 0);

  const programmingError = new TypeError("x is not a function");
  const c = fakeProvider("anthropic", () => {
    throw programmingError;
  });
  const d = fakeProvider("gemini", () => "from-gemini");
  assert("plain TypeError is not hidden by failover", (await rejects(run([c, d]))) === programmingError);
}

console.log("6. Billing failure starts a cooldown");
{
  let clock = 1_000_000;
  const cooldowns = new Map();
  const a = fakeProvider("anthropic", () => {
    throw httpError(402);
  });
  const b = fakeProvider("gemini", () => "from-gemini");

  await run([a, b], { cooldowns, now: () => clock });
  assert("first call tried Claude", a.calls === 1);

  await run([a, b], { cooldowns, now: () => clock + 1_000 });
  assert("second call skipped Claude", a.calls === 1);
  assert("Gemini served both", b.calls === 2);

  console.log("7. Cooldown expires");
  await run([a, b], { cooldowns, now: () => clock + 11 * 60 * 1000 });
  assert("Claude tried again after the cooldown", a.calls === 2);
}

console.log("8. All providers cooling down are still tried");
{
  let clock = 5_000_000;
  const cooldowns = new Map([
    ["anthropic", clock + 60_000],
    ["gemini", clock + 60_000],
  ]);
  const a = fakeProvider("anthropic", () => "from-claude");
  const b = fakeProvider("gemini", () => "from-gemini");
  const text = await run([a, b], { cooldowns, now: () => clock });
  assert("no lockout", text === "from-claude");
}

console.log("9. All providers fail");
{
  const a = fakeProvider("anthropic", () => {
    throw httpError(402);
  });
  const b = fakeProvider("gemini", () => {
    throw httpError(402);
  });
  const error = await rejects(run([a, b]));
  assert("AiProvidersExhaustedError", error instanceof AiProvidersExhaustedError);
  assert("two attempts recorded", error?.attempts?.length === 2);
  assert("status 402 exposed for callers", error?.status === 402 && error?.statusCode === 402);
  assert(
    "message names every provider",
    /anthropic=billing_or_auth/.test(error?.message) && /gemini=billing_or_auth/.test(error?.message),
  );
}

console.log("10. 429 preferred as representative status");
{
  const a = fakeProvider("anthropic", () => {
    throw httpError(429);
  });
  const b = fakeProvider("gemini", () => {
    throw httpError(402);
  });
  const error = await rejects(run([a, b]));
  assert("status is 429", error?.status === 429);
}

console.log("11. Nothing configured");
{
  const a = { ...fakeProvider("anthropic", () => "x"), isConfigured: () => false };
  const error = await rejects(run([a]));
  assert("AiNotConfiguredError", error instanceof AiNotConfiguredError);
  assert("status 500", error?.status === 500);
}

console.log("12. AI_PROVIDER_ORDER parsing");
{
  const original = process.env.AI_PROVIDER_ORDER;
  delete process.env.AI_PROVIDER_ORDER;
  assert("default is anthropic,gemini", getAiProviderOrder().join() === "anthropic,gemini");
  process.env.AI_PROVIDER_ORDER = " Gemini , anthropic ,gemini";
  assert("custom order, deduped, case-insensitive", getAiProviderOrder().join() === "gemini,anthropic");
  process.env.AI_PROVIDER_ORDER = "openai,foo";
  assert("unknown names ignored -> default", getAiProviderOrder().join() === "anthropic,gemini");
  if (original === undefined) delete process.env.AI_PROVIDER_ORDER;
  else process.env.AI_PROVIDER_ORDER = original;
}

console.log("13. Parts -> Claude content blocks");
{
  const blocks = toAnthropicContent([
    { text: "describe" },
    { inlineData: { data: "AAAA", mimeType: "image/png" } },
    { inlineData: { data: "BBBB" } },
  ]);
  assert("text block", blocks[0].type === "text" && blocks[0].text === "describe");
  assert(
    "image block keeps media type",
    blocks[1].type === "image" && blocks[1].source.media_type === "image/png" && blocks[1].source.data === "AAAA",
  );
  assert("image defaults to jpeg", blocks[2].source.media_type === "image/jpeg");
  const fromString = toAnthropicContent("plain prompt");
  assert("string prompt becomes one text block", fromString.length === 1 && fromString[0].text === "plain prompt");
}

console.log(`\n${"─".repeat(60)}`);
console.log(`llmFailover: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
