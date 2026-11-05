/**
 * Run with: node --env-file=.env.development src/lib/__tests__/proposalContext.test.js
 */
import assert from "node:assert/strict";
import { buildProviderProfile, buildRequirementContext } from "../proposalContext.js";
import { buildProposalPrompt } from "../../prompts/proposalPrompt.js";
import { normalizeProposalDraft } from "../../controllers/aiController.js";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

test("no profile means no provider, even with a company name", () => {
  assert.equal(buildProviderProfile(null), null);
  assert.equal(buildProviderProfile({ companyName: "Acme Studio" }), null);
  assert.equal(buildProviderProfile({ proposalAbout: "   ", proposalProof: "\n \n" }), null);
});

test("the default company name is not treated as a real one", () => {
  const profile = buildProviderProfile({ companyName: "My Company", proposalAbout: "We build apps." });
  assert.equal(profile.name, null);
  assert.equal(profile.about, "We build apps.");
});

test("proof lines are trimmed, limited and capped in length", () => {
  const lines = Array.from({ length: 12 }, (_, i) => `  Project ${i}  `).join("\n");
  const profile = buildProviderProfile({ proposalProof: lines });
  assert.equal(profile.proof.length, 8);
  assert.equal(profile.proof[0], "Project 0");
  assert.equal(buildProviderProfile({ proposalAbout: "x".repeat(900) }).about.length, 600);
});

test("requirement context keeps useful keys only and is bounded", () => {
  assert.equal(buildRequirementContext(null), null);
  assert.equal(buildRequirementContext({ rawInputType: "chat" }), null);
  const text = buildRequirementContext({ businessGoal: "retention", rawInputType: "chat", requirements: ["x".repeat(5000)] });
  assert.ok(text.includes("retention"));
  assert.ok(!text.includes("rawInputType"));
  assert.ok(text.length <= 3500);
});

const quote = { customerName: "A", projectName: "P", totalAmount: 100 };
const items = [{ description: "One", amount: 50 }, { description: "Two", amount: 50 }];

test("the prompt forbids company claims when no profile exists", () => {
  const prompt = buildProposalPrompt({ quote, items, locale: "en" });
  assert.ok(prompt.includes("No provider profile is configured"));
  assert.ok(!prompt.includes("PROVIDER (written by the user"));
});

test("the prompt carries the profile and request analysis when present", () => {
  const prompt = buildProposalPrompt({
    quote,
    items,
    locale: "en",
    provider: { name: "Acme", about: "Mobile specialists", proof: ["Shipped 12 apps"] },
    requirementContext: '{"businessGoal":"retention"}',
  });
  assert.ok(prompt.includes("Mobile specialists"));
  assert.ok(prompt.includes("CLIENT REQUEST ANALYSIS"));
  assert.ok(!prompt.includes("No provider profile is configured"));
});

test("an About us slide appears only when a profile exists, with the user's own words", () => {
  const provider = { name: "Acme", about: "Mobile specialists", proof: ["Shipped 12 apps"] };
  const withAbout = normalizeProposalDraft({ provider }, "", items, "en").slides.find((s) => s.type === "about-us");
  assert.deepEqual(withAbout.bullets, ["Mobile specialists", "Shipped 12 apps"]);
  assert.equal(normalizeProposalDraft({}, "", items, "en").slides.some((s) => s.type === "about-us"), false);
});

console.log(`${passed} passed`);
process.exit(0);
