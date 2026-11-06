/**
 * Tests for catalogLocalize.js — English output for catalog-derived text.
 * Run with: node src/lib/__tests__/catalogLocalize.test.js
 * No network: the translator is injected.
 */
import assert from "node:assert/strict";
import {
  buildEnglishQuestions,
  buildRiskSummary,
  collectChineseTexts,
  localizeModules,
  translateCatalogTexts,
} from "../catalogLocalize.js";

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
};

const fake = async (texts) => Object.fromEntries(texts.map((t) => [t, `EN:${t.length}`]));

await test("collects only Chinese lines, once each", () => {
  assert.deepEqual(collectChineseTexts([["頁面數量", "API"], "頁面數量", null, 3]), ["頁面數量"]);
});

await test("translates modules and leaves prices and keys alone", async () => {
  const modules = [{ baselineKey: "cms", baselineName: "後台", assumptions: ["單一語系"], exclusions: [], missingInfo: ["頁面數量"], estimateRange: { min: 1, max: 2 } }];
  const [m] = await localizeModules(modules, fake);
  assert.equal(m.baselineKey, "cms");
  assert.deepEqual(m.estimateRange, { min: 1, max: 2 });
  assert.match(m.baselineName, /^EN:/);
  assert.match(m.assumptions[0], /^EN:/);
});

await test("keeps the original line when translation fails", async () => {
  const map = await translateCatalogTexts(["完全不同的一句話"], async () => {
    throw new Error("provider down");
  });
  assert.equal(map.size, 0);
  const [m] = await localizeModules([{ assumptions: ["另一句沒翻成的話"], exclusions: [], missingInfo: [] }], async () => {
    throw new Error("provider down");
  });
  assert.equal(m.assumptions[0], "另一句沒翻成的話");
});

await test("rejects a 'translation' that is still Chinese", async () => {
  const map = await translateCatalogTexts(["再一句話"], async (t) => ({ [t[0]]: "還是中文" }));
  assert.equal(map.size, 0);
});

await test("frames English missing info as questions", () => {
  assert.deepEqual(buildEnglishQuestions(["Do you need multi-language?", "Number of pages", "Is there a design file"]), [
    "Do you need multi-language?",
    "Please provide: Number of pages",
    "Is there a design file?",
  ]);
});

await test("risk summary only overrides English", () => {
  assert.equal(buildRiskSummary(["a"], "zh-TW"), null);
  assert.match(buildRiskSummary(["a", "b"], "en"), /2 points to note/);
});

console.log(`\n${passed} passed`);
