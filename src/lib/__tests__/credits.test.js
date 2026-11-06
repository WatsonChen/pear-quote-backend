/**
 * Tests for credits.js — spending must never overdraw, even with requests in parallel.
 * Run with: node src/lib/__tests__/credits.test.js
 */
import assert from "node:assert/strict";
import { InsufficientCreditsError, chargeCredits, handleInsufficientCredits } from "../credits.js";

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
};

/** A fake workspace table whose updateMany is atomic like the database's. */
function fakeClient(balance) {
  const state = { balance };
  return {
    state,
    workspace: {
      updateMany: async ({ where, data }) => {
        if (state.balance >= where.creditBalance.gte) {
          state.balance -= data.creditBalance.decrement;
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
  };
}

await test("charges the cost when the balance covers it", async () => {
  const client = fakeClient(15);
  await chargeCredits(client, "w", 10);
  assert.equal(client.state.balance, 5);
});

await test("refuses and changes nothing when the balance is short", async () => {
  const client = fakeClient(9);
  await assert.rejects(() => chargeCredits(client, "w", 10), InsufficientCreditsError);
  assert.equal(client.state.balance, 9);
});

await test("two requests that both passed the early check cannot both be paid", async () => {
  const client = fakeClient(10);
  const results = await Promise.allSettled([chargeCredits(client, "w", 10), chargeCredits(client, "w", 10)]);
  assert.deepEqual(results.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(client.state.balance, 0);
});

await test("answers a failed charge with the standard 403, and ignores other errors", async () => {
  let sent;
  const res = { status: (code) => ({ json: (body) => (sent = { code, body }) }) };
  assert.equal(handleInsufficientCredits(res, new InsufficientCreditsError()), true);
  assert.equal(sent.code, 403);
  assert.equal(sent.body.errorCode, "INSUFFICIENT_CREDITS");
  assert.equal(handleInsufficientCredits(res, new Error("boom")), false);
});

console.log(`\n${passed} passed`);
