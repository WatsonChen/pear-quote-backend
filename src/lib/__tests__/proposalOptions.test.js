/**
 * Tests for proposalOptions.js. Run with: node src/lib/__tests__/proposalOptions.test.js
 */
import assert from "node:assert/strict";
import {
  normalizeProposalOptions,
  priceProposalOption,
  withOptionPrices,
  isKnownOptionId,
} from "../proposalOptions.js";
import { serializePublicProposal } from "../proposalSerializer.js";

const items = [
  { description: "Core app", amount: 600 },
  { description: "Admin panel", amount: 300 },
  { description: "Analytics", amount: 100 },
];

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

test("drops bad indexes, empty and duplicate options, keeps one recommended", () => {
  const options = normalizeProposalOptions(
    [
      { name: "Essentials", itemIndexes: [0, 9, -1, "x"], recommended: true },
      { name: "Same again", itemIndexes: [0] },
      { name: "", itemIndexes: [1] },
      { name: "Full", itemIndexes: [0, 1, 2], recommended: true },
    ],
    items,
  );
  assert.equal(options.length, 2);
  assert.deepEqual(options[0].itemIndexes, [0]);
  assert.deepEqual(options[0].itemDescriptions, ["Core app"]);
  assert.equal(options.filter((o) => o.recommended).length, 1);
  assert.equal(options[0].recommended, true);
});

test("a single usable option is not an option", () => {
  assert.deepEqual(normalizeProposalOptions([{ name: "Only", itemIndexes: [0, 1, 2] }], items), []);
  assert.deepEqual(normalizeProposalOptions("nope", items), []);
  assert.deepEqual(normalizeProposalOptions([{ name: "a", itemIndexes: [0] }, { name: "b", itemIndexes: [1] }], [items[0]]), []);
});

test("full package costs exactly the quote total, partial packages scale", () => {
  const options = normalizeProposalOptions(
    [{ name: "Essentials", itemIndexes: [0] }, { name: "Full", itemIndexes: [0, 1, 2] }],
    items,
  );
  assert.equal(priceProposalOption(options[1], items, 1050), 1050);
  assert.equal(priceProposalOption(options[0], items, 1050), 630);
});

test("pricing follows items when the database returns them in another order", () => {
  const options = normalizeProposalOptions(
    [{ name: "Essentials", itemIndexes: [0] }, { name: "Full", itemIndexes: [0, 1, 2] }],
    items,
  );
  const shuffled = [items[2], items[0], items[1]];
  assert.equal(priceProposalOption(options[0], shuffled, 1000), 600);
});

test("an edited item hides the options instead of mispricing them", () => {
  const options = normalizeProposalOptions(
    [{ name: "Essentials", itemIndexes: [0] }, { name: "Full", itemIndexes: [0, 1, 2] }],
    items,
  );
  const edited = [{ ...items[0], description: "Core app v2" }, items[1], items[2]];
  assert.deepEqual(withOptionPrices(options, edited, 1000), []);
});

test("unknown option ids are rejected", () => {
  assert.equal(isKnownOptionId([{ id: "opt-1" }], "opt-2"), false);
  assert.equal(isKnownOptionId([{ id: "opt-1" }], "opt-1"), true);
});

test("public proposal carries priced options and no stored price", () => {
  const options = normalizeProposalOptions(
    [{ name: "Essentials", itemIndexes: [0] }, { name: "Full", itemIndexes: [0, 1, 2] }],
    items,
  );
  const result = serializePublicProposal({
    shareToken: "t",
    totalAmount: 1000,
    items: items.map((i) => ({ ...i, hourlyRate: 99 })),
    proposalContent: { options },
    workspace: {},
  });
  assert.equal(result.proposalContent.options[0].total, 600);
  assert.equal(result.proposalContent.options[1].total, 1000);
  assert.equal(JSON.stringify(result).includes("hourlyRate"), false);
});

console.log(`${passed} passed`);
