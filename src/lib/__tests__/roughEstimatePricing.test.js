/**
 * Tests for roughEstimatePricing.js, roughEstimateCache.js and the rough
 * estimate prompt — deterministic pricing of the public demo.
 * Run with: node src/lib/__tests__/roughEstimatePricing.test.js
 *
 * Hand-rolled assert harness; pure functions only (no network, no DB).
 *
 * Coverage:
 *   1. effort string parsing and breakdown normalisation
 *   2. hourly rate resolution (stated vs default, invalid filtered)
 *   3. price from hours: FitLife numbers, rounding, quality bands, TWD
 *   4. stability: jittered model hours -> price stays within a tight band
 *   5. budget is reported, never bent to; currency mismatch ignored
 *   6. applyRoughEstimatePricing: internal fields stripped, disclosures, vague
 *   7. no usable hours -> applied=false (caller falls back, no invented price)
 *   8. cache: normalised key, TTL, clone-on-read
 *   9. prompt: no price requested, budget/rates rules present
 */

import {
  VAGUE_CONFIDENCE_CAP,
  applyRoughEstimatePricing,
  buildBudgetSentence,
  computePriceRange,
  normalizeBreakdownHours,
  parseEffortHours,
  resolveHourlyRate,
} from "../roughEstimatePricing.js";
import {
  clearRoughEstimateCache,
  getCachedRoughEstimate,
  makeRoughEstimateCacheKey,
  setCachedRoughEstimate,
} from "../roughEstimateCache.js";
import { buildRoughEstimatePrompt } from "../../prompts/roughEstimatePrompt.js";

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

const FITLIFE_RATES = [
  { role: "Project Manager", rate: 60 },
  { role: "UI/UX Designer", rate: 55 },
  { role: "Frontend Engineer", rate: 60 },
  { role: "Backend Engineer", rate: 65 },
  { role: "QA", rate: 45 },
];

function breakdownOf(ranges) {
  return ranges.map(([min, max], index) => ({
    label: `Phase ${index + 1}`,
    description: "d",
    effortMinHours: min,
    effortMaxHours: max,
  }));
}

console.log("1. Effort parsing and breakdown normalisation");
{
  assert("18–28h", JSON.stringify(parseEffortHours("18–28h")) === '{"min":18,"max":28}');
  assert("18-28 h (ascii dash)", parseEffortHours("18-28 h")?.max === 28);
  assert("single value", parseEffortHours("20h")?.min === 20);
  assert("garbage -> null", parseEffortHours("lots") === null);

  const items = normalizeBreakdownHours([
    { label: "a", effortMinHours: 70, effortMaxHours: 100, effort: "whatever" },
    { label: "b", effort: "60–85h" },
    { label: "c", effortMinHours: 50, effortMaxHours: 30 },
  ]);
  assert("numbers win, display string rewritten", items[0].effort === "70–100h");
  assert("falls back to effort string", items[1].effortMinHours === 60 && items[1].effortMaxHours === 85);
  assert("min>max is swapped", items[2].effortMinHours === 30 && items[2].effortMaxHours === 50);
  assert("any item without hours -> null (no guessing)", normalizeBreakdownHours([{ label: "x" }, { label: "y", effortMinHours: 5, effortMaxHours: 9 }]) === null);
  assert("empty -> null", normalizeBreakdownHours([]) === null);
}

console.log("2. Hourly rate resolution");
{
  const stated = resolveHourlyRate(FITLIFE_RATES, "USD");
  assert("average of stated rates (57)", stated.rate === 57 && stated.source === "stated");
  assert("default when none stated", resolveHourlyRate([], "USD").source === "default");
  assert("USD default is 55", resolveHourlyRate(undefined, "USD").rate === 55);
  assert("TWD default is 1800", resolveHourlyRate(null, "TWD").rate === 1800);
  const filtered = resolveHourlyRate([{ role: "x", rate: 5 }, { role: "y", rate: "abc" }, { role: "z", rate: 80 }], "USD");
  assert("implausible/invalid rates are ignored", filtered.rate === 80 && filtered.source === "stated");
  assert("all invalid -> default", resolveHourlyRate([{ role: "x", rate: 5 }], "USD").source === "default");
}

console.log("3. Price from hours");
{
  const fitlife = normalizeBreakdownHours(breakdownOf([[70, 100], [60, 85], [110, 150], [40, 60], [40, 55]]));
  const price = computePriceRange({ breakdown: fitlife, quality: "clear", currency: "USD", rate: 57 });
  assert("total hours 320–450", price.minHours === 320 && price.maxHours === 450);
  assert("mid 385h bucketed to 400h", price.midHours === 400);
  assert("min = 400*57*0.85 rounded to 500", price.min === 19500, String(price.min));
  assert("max = 400*57*1.2 rounded to 500", price.max === 27500, String(price.max));
  assert("range ordered", price.max > price.min);

  const vague = computePriceRange({ breakdown: fitlife, quality: "vague", currency: "USD", rate: 57 });
  assert("vague brief widens the band", vague.max / vague.min > price.max / price.min);

  const twd = computePriceRange({ breakdown: fitlife, quality: "clear", currency: "TWD", rate: 1800 });
  assert("TWD rounds to 5000", twd.min % 5000 === 0 && twd.max % 5000 === 0);
}

console.log("4. Stability under model jitter");
{
  // Three plausible runs of the same brief: the model's hour counts move ~±8%.
  const runs = [
    [[70, 100], [60, 85], [110, 150], [40, 60], [40, 55]],
    [[65, 95], [55, 80], [100, 140], [38, 56], [36, 50]],
    [[74, 106], [64, 90], [118, 160], [42, 64], [43, 58]],
  ].map((ranges) =>
    computePriceRange({
      breakdown: normalizeBreakdownHours(breakdownOf(ranges)),
      quality: "clear",
      currency: "USD",
      rate: 57,
    }),
  );
  const mins = runs.map((r) => r.min);
  const maxs = runs.map((r) => r.max);
  const spread = (values) => Math.max(...values) / Math.min(...values);
  assert("low end within 15% across runs", spread(mins) <= 1.15, mins.join(","));
  assert("high end within 15% across runs", spread(maxs) <= 1.15, maxs.join(","));
}

console.log("5. Budget is reported, never bent to");
{
  const base = { budget: 20000, budgetCurrency: "USD", currency: "USD", useChinese: false };
  assert("min above budget -> 'above'", /above your stated budget/.test(buildBudgetSentence({ ...base, min: 22000, max: 30000 })));
  assert("max above budget -> 'may exceed'", /may exceed/.test(buildBudgetSentence({ ...base, min: 15000, max: 24000 })));
  assert("within budget -> no sentence", buildBudgetSentence({ ...base, min: 10000, max: 18000 }) === null);
  assert("no budget -> null", buildBudgetSentence({ ...base, budget: null, min: 1, max: 2 }) === null);
  assert("currency mismatch -> ignored", buildBudgetSentence({ ...base, budgetCurrency: "TWD", min: 22000, max: 30000 }) === null);
  assert("Chinese sentence", /預算/.test(buildBudgetSentence({ ...base, useChinese: true, min: 22000, max: 30000 })));
}

console.log("6. applyRoughEstimatePricing");
{
  const parsed = {
    currency: "USD",
    briefQuality: "clear",
    missingInfo: [],
    statedHourlyRates: FITLIFE_RATES,
    statedBudget: { amount: 20000, currency: "USD" },
    priceRange: "$1 - $2",
    timeline: "9 – 12 weeks",
    confidenceScore: 80,
    breakdown: breakdownOf([[70, 100], [60, 85], [110, 150], [40, 60], [40, 55]]),
    assumptions: ["a", "b", "c"],
    note: "Preliminary.",
  };
  const { result, applied, quality } = applyRoughEstimatePricing(parsed, { useChinese: false });
  assert("applied", applied && quality === "clear");
  assert("model's own priceRange discarded", result.priceRange === "$19,500 - $27,500", result.priceRange);
  assert("internal fields stripped", !("statedHourlyRates" in result) && !("statedBudget" in result) && !("missingInfo" in result) && !("briefQuality" in result) && !("currency" in result));
  assert("timeline untouched (calendar time kept apart from hours)", result.timeline === "9 – 12 weeks");
  assert("effort strings regenerated", result.breakdown[2].effort === "110–150h");
  assert("note states the rates used", /stated hourly rates \(average \$57\/hr\)/.test(result.note));
  assert("note reports the budget gap", /budget of \$20,000/.test(result.note));
  assert("original note kept", result.note.startsWith("Preliminary."));
  assert("assumptions untouched when clear", result.assumptions.join() === "a,b,c");

  const noRates = applyRoughEstimatePricing({ ...parsed, statedHourlyRates: [], statedBudget: null }, { useChinese: false });
  assert("default-rate disclosure: rates not applied", /not provided, so none were applied/.test(noRates.result.note));

  const vague = applyRoughEstimatePricing(
    { ...parsed, briefQuality: "vague", missingInfo: ["What kind of site?", "How many pages?"], statedHourlyRates: [], statedBudget: null },
    { useChinese: false },
  );
  assert("vague brief: first assumption asks for missing info", /Please confirm: What kind of site\?; How many pages\?/.test(vague.result.assumptions[0]));
  assert("assumptions capped at 3", vague.result.assumptions.length === 3);
  assert("vague quality returned for confidence cap", vague.quality === "vague" && VAGUE_CONFIDENCE_CAP === 62);

  const zh = applyRoughEstimatePricing({ ...parsed, currency: "TWD", statedHourlyRates: [], statedBudget: null }, { useChinese: true });
  assert("TWD formatting", /^NT\$/.test(zh.result.priceRange));
}

console.log("7. No usable hours");
{
  const parsed = { priceRange: "$5,000 - $9,000", breakdown: [{ label: "x", description: "y" }] };
  const out = applyRoughEstimatePricing(parsed, { useChinese: false });
  assert("applied=false", out.applied === false);
  assert("result untouched", out.result === parsed);
}

console.log("8. Cache");
{
  clearRoughEstimateCache();
  const a = makeRoughEstimateCacheKey({ description: "Need  a Website\n", useChinese: false });
  const b = makeRoughEstimateCacheKey({ description: "need a website", useChinese: false });
  const c = makeRoughEstimateCacheKey({ description: "need a website", useChinese: true });
  assert("case/whitespace normalised", a === b);
  assert("locale is part of the key", a !== c);

  const value = { priceRange: "$1 - $2", nested: { x: 1 } };
  setCachedRoughEstimate(a, value, 1000);
  const hit = getCachedRoughEstimate(a, 2000);
  assert("hit within TTL", hit?.priceRange === "$1 - $2");
  hit.nested.x = 99;
  assert("returns a clone (mutation does not leak)", getCachedRoughEstimate(a, 2000).nested.x === 1);
  assert("expires after TTL", getCachedRoughEstimate(a, 1000 + 31 * 60 * 1000) === null);
  assert("miss for unknown key", getCachedRoughEstimate("nope") === null);
}

console.log("9. Prompt");
{
  const prompt = buildRoughEstimatePrompt({ description: "Need a website", useChinese: false, hasImages: false });
  assert("does not ask the model for a price", !/"priceRange"/.test(prompt) && /Do NOT output a price/.test(prompt));
  assert("asks for stated rates only", /ONLY hourly rates the brief explicitly states/.test(prompt));
  assert("forbids fitting to the budget", /NEVER adjust hours, scope, or assumptions to fit the budget/.test(prompt));
  assert("covers vague briefs", /"vague"/.test(prompt) && /Need a website/.test(prompt));
  assert("risk priorities listed", /missing content or assets/.test(prompt) && /key-person or handover/.test(prompt));
  assert("hours kept apart from calendar time", /Hours are effort, not calendar time/.test(prompt));
  assert("English output rule", /in English/.test(prompt));
  const zh = buildRoughEstimatePrompt({ description: "x", useChinese: true, hasImages: true });
  assert("Chinese output rule", /Traditional Chinese/.test(zh));
  assert("image summary requested with images", /imageSummary": "string/.test(zh));
}

console.log(`\n${"─".repeat(60)}`);
console.log(`roughEstimatePricing: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
