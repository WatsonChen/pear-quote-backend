// Smoke test for the AI provider chain with real keys.
// Usage: ANTHROPIC_API_KEY=... [GOOGLE_GENERATIVE_AI_API_KEY=...] node scripts/ai-smoke.js [anthropic|gemini]
// Pass a provider name to test only that provider (sets AI_PROVIDER_ORDER).
import { generateAiJsonText, getAiProviderOrder } from "../src/lib/llm.js";
import { normalizeJsonResponse } from "../src/lib/gemini.js";

if (process.argv[2]) {
  process.env.AI_PROVIDER_ORDER = process.argv[2];
}

console.log("provider order:", getAiProviderOrder().join(" -> "));

const startedAt = Date.now();
const text = await generateAiJsonText(
  [
    {
      text: 'Return ONLY a JSON object: {"ok": true, "summary": "one short sentence about website quotes"}',
    },
  ],
  { purpose: "roughEstimate" },
);

const parsed = JSON.parse(normalizeJsonResponse(text));
console.log(`ok in ${Date.now() - startedAt}ms:`, parsed);
process.exit(0);
