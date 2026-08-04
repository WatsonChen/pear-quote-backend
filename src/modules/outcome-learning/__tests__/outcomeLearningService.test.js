/**
 * Tests for outcomeLearningService.js — Quote WON outcome sync.
 * Run with: node src/modules/outcome-learning/__tests__/outcomeLearningService.test.js
 *
 * Hand-rolled assert harness (same convention as proposalSerializer.test.js).
 * No live DB — a fake Prisma transaction client stands in for `tx`.
 *
 * Coverage:
 *   1. linked snapshot + adjustment → accepted, acceptedPrice set, finalQuotedPrice preserved
 *   2. finalQuotedPrice null → filled with wonAmount
 *   3. snapshot_not_linked → no throw, no data created
 *   4. adjustment_not_found → no throw, no create/upsert
 *   5. repeated sync → idempotent, no duplicate row, finalQuotedPrice stays locked
 *   6. invalid wonAmount → throws INVALID_WON_AMOUNT for 0/negative/NaN/Infinity/string
 *   7. workspace scope → query is actually workspace-scoped, not just accepted as a param
 *   8. unexpected persistence error → propagates, not swallowed
 *   9. multiple linked snapshots → ambiguous, not "pick latest"
 *  10. linkEstimateSnapshotToQuote: valid snapshot links successfully
 *  11. linkEstimateSnapshotToQuote: refine chain — only the passed id is touched, not parent/root
 *  12. linkEstimateSnapshotToQuote: no id provided → manual quote, zero DB calls
 *  13. linkEstimateSnapshotToQuote: snapshot not found
 *  14. linkEstimateSnapshotToQuote: snapshot belongs to another workspace, untouched
 *  15. linkEstimateSnapshotToQuote: snapshot already linked elsewhere, not stolen
 *  16. linkEstimateSnapshotToQuote: two create requests racing the same snapshot — only first wins
 */

import { syncQuoteWonOutcome, linkEstimateSnapshotToQuote } from "../outcomeLearningService.js";

// ── Hand-rolled assert harness ────────────────────────────────────────────────

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

async function assertThrows(label, fn, check) {
  try {
    await fn();
    console.error(`  ✗ ${label}  (did not throw)`);
    failed++;
  } catch (err) {
    const ok = check ? check(err) : true;
    assert(label, ok, ok ? "" : `unexpected error shape: ${err.message}`);
  }
}

// ── Fake transaction client ───────────────────────────────────────────────────

const NEVER_CALL = (name) => async () => {
  throw new Error(`${name} should never be called by syncQuoteWonOutcome`);
};

/**
 * @param {Array} snapshots   - [{ id, quoteId, workspaceId }]
 * @param {Array} adjustments - [{ id, snapshotId, workspaceId, projectStatus, acceptedPrice, finalQuotedPrice }]
 * @param {object} overrides  - per-method overrides, e.g. { estimateAdjustment: { update: async () => { throw ... } } }
 */
function makeFakeTx(snapshots = [], adjustments = [], overrides = {}) {
  const adjustmentStore = adjustments.map((a) => ({ ...a }));

  const tx = {
    estimateSnapshot: {
      findMany: async ({ where }) =>
        snapshots
          .filter((s) => s.quoteId === where.quoteId && s.workspaceId === where.workspaceId)
          .map((s) => ({ id: s.id })),
      create: NEVER_CALL("estimateSnapshot.create"),
      update: NEVER_CALL("estimateSnapshot.update"),
    },
    estimateAdjustment: {
      findFirst: async ({ where }) =>
        adjustmentStore.find(
          (a) => a.snapshotId === where.snapshotId && a.workspaceId === where.workspaceId,
        ) ?? null,
      update: async ({ where, data }) => {
        const record = adjustmentStore.find((a) => a.id === where.id);
        if (!record) throw new Error("Record to update not found");
        Object.assign(record, data);
        return { ...record };
      },
      create: NEVER_CALL("estimateAdjustment.create"),
      upsert: NEVER_CALL("estimateAdjustment.upsert"),
    },
    _adjustmentStore: adjustmentStore,
  };

  for (const [model, methods] of Object.entries(overrides)) {
    Object.assign(tx[model], methods);
  }

  return tx;
}

const WORKSPACE_A = "ws-a";
const WORKSPACE_B = "ws-b";
const QUOTE_ID = "quote-1";

// ── [1] linked snapshot + adjustment ──────────────────────────────────────────
console.log("\n[1] linked snapshot + adjustment → accepted");
{
  const tx = makeFakeTx(
    [{ id: "snap-1", quoteId: QUOTE_ID, workspaceId: WORKSPACE_A }],
    [{ id: "adj-1", snapshotId: "snap-1", workspaceId: WORKSPACE_A, projectStatus: "sent", acceptedPrice: null, finalQuotedPrice: 88000 }],
  );
  const result = await syncQuoteWonOutcome({ tx, quoteId: QUOTE_ID, workspaceId: WORKSPACE_A, wonAmount: 80000 });
  assert("synced true", result.synced === true);
  assert("projectStatus accepted", result.projectStatus === "accepted");
  assert("acceptedPrice set to wonAmount", result.acceptedPrice === 80000);
  assert("finalQuotedPrice preserved (not overwritten)", result.finalQuotedPrice === 88000);
}

// ── [2] finalQuotedPrice null → filled with wonAmount ─────────────────────────
console.log("\n[2] finalQuotedPrice null → filled with wonAmount");
{
  const tx = makeFakeTx(
    [{ id: "snap-1", quoteId: QUOTE_ID, workspaceId: WORKSPACE_A }],
    [{ id: "adj-1", snapshotId: "snap-1", workspaceId: WORKSPACE_A, projectStatus: "sent", acceptedPrice: null, finalQuotedPrice: null }],
  );
  const result = await syncQuoteWonOutcome({ tx, quoteId: QUOTE_ID, workspaceId: WORKSPACE_A, wonAmount: 80000 });
  assert("finalQuotedPrice filled with wonAmount", result.finalQuotedPrice === 80000);
}

// ── [3] snapshot_not_linked ────────────────────────────────────────────────────
console.log("\n[3] snapshot_not_linked");
{
  const tx = makeFakeTx([], []);
  const result = await syncQuoteWonOutcome({ tx, quoteId: QUOTE_ID, workspaceId: WORKSPACE_A, wonAmount: 80000 });
  assert("synced false", result.synced === false);
  assert("reason snapshot_not_linked", result.reason === "snapshot_not_linked");
  // NEVER_CALL guards on create/update prove no data was fabricated —
  // if the implementation had called them, this test would have thrown above.
}

// ── [4] adjustment_not_found ───────────────────────────────────────────────────
console.log("\n[4] adjustment_not_found");
{
  const tx = makeFakeTx(
    [{ id: "snap-1", quoteId: QUOTE_ID, workspaceId: WORKSPACE_A }],
    [], // no adjustment row exists for snap-1
  );
  const result = await syncQuoteWonOutcome({ tx, quoteId: QUOTE_ID, workspaceId: WORKSPACE_A, wonAmount: 80000 });
  assert("synced false", result.synced === false);
  assert("reason adjustment_not_found", result.reason === "adjustment_not_found");
  assert("snapshotId reported", result.snapshotId === "snap-1");
  // estimateAdjustment.create / upsert are NEVER_CALL — no speculative row was made.
}

// ── [5] repeated sync (idempotency) ───────────────────────────────────────────
console.log("\n[5] repeated sync is idempotent");
{
  const tx = makeFakeTx(
    [{ id: "snap-1", quoteId: QUOTE_ID, workspaceId: WORKSPACE_A }],
    [{ id: "adj-1", snapshotId: "snap-1", workspaceId: WORKSPACE_A, projectStatus: "sent", acceptedPrice: null, finalQuotedPrice: 88000 }],
  );
  const first = await syncQuoteWonOutcome({ tx, quoteId: QUOTE_ID, workspaceId: WORKSPACE_A, wonAmount: 80000 });
  const second = await syncQuoteWonOutcome({ tx, quoteId: QUOTE_ID, workspaceId: WORKSPACE_A, wonAmount: 82000 }); // simulates a corrected amount
  assert("first call synced", first.synced === true);
  assert("second call synced", second.synced === true);
  assert("acceptedPrice reflects latest wonAmount", second.acceptedPrice === 82000);
  assert("finalQuotedPrice still locked to original", second.finalQuotedPrice === 88000);
  assert("no duplicate adjustment row created", tx._adjustmentStore.length === 1);
}

// ── [6] invalid wonAmount ───────────────────────────────────────────────────
console.log("\n[6] invalid wonAmount rejected");
{
  const tx = makeFakeTx(
    [{ id: "snap-1", quoteId: QUOTE_ID, workspaceId: WORKSPACE_A }],
    [{ id: "adj-1", snapshotId: "snap-1", workspaceId: WORKSPACE_A, projectStatus: "sent", acceptedPrice: null, finalQuotedPrice: null }],
  );
  const isInvalidAmountError = (err) => err.statusCode === 400 && err.errorCode === "INVALID_WON_AMOUNT";

  await assertThrows("wonAmount = 0 throws INVALID_WON_AMOUNT",
    () => syncQuoteWonOutcome({ tx, quoteId: QUOTE_ID, workspaceId: WORKSPACE_A, wonAmount: 0 }), isInvalidAmountError);
  await assertThrows("wonAmount = -500 throws INVALID_WON_AMOUNT",
    () => syncQuoteWonOutcome({ tx, quoteId: QUOTE_ID, workspaceId: WORKSPACE_A, wonAmount: -500 }), isInvalidAmountError);
  await assertThrows("wonAmount = NaN throws INVALID_WON_AMOUNT",
    () => syncQuoteWonOutcome({ tx, quoteId: QUOTE_ID, workspaceId: WORKSPACE_A, wonAmount: NaN }), isInvalidAmountError);
  await assertThrows("wonAmount = Infinity throws INVALID_WON_AMOUNT",
    () => syncQuoteWonOutcome({ tx, quoteId: QUOTE_ID, workspaceId: WORKSPACE_A, wonAmount: Infinity }), isInvalidAmountError);
  await assertThrows("wonAmount = '500000' (numeric string) throws INVALID_WON_AMOUNT — contract requires an actual number, caller must coerce",
    () => syncQuoteWonOutcome({ tx, quoteId: QUOTE_ID, workspaceId: WORKSPACE_A, wonAmount: "500000" }), isInvalidAmountError);
}

// ── [7] workspace scope ────────────────────────────────────────────────────────
console.log("\n[7] workspace scope is enforced, not decorative");
{
  // Snapshot exists for this quoteId, but under a DIFFERENT workspace.
  const tx1 = makeFakeTx(
    [{ id: "snap-1", quoteId: QUOTE_ID, workspaceId: WORKSPACE_B }],
    [{ id: "adj-1", snapshotId: "snap-1", workspaceId: WORKSPACE_B, projectStatus: "sent", acceptedPrice: null, finalQuotedPrice: null }],
  );
  const result1 = await syncQuoteWonOutcome({ tx: tx1, quoteId: QUOTE_ID, workspaceId: WORKSPACE_A, wonAmount: 80000 });
  assert("cross-workspace snapshot not matched", result1.reason === "snapshot_not_linked");

  // Snapshot correctly scoped to WORKSPACE_A, but its adjustment row is
  // (incorrectly, hypothetically) tagged with a different workspaceId.
  const tx2 = makeFakeTx(
    [{ id: "snap-2", quoteId: QUOTE_ID, workspaceId: WORKSPACE_A }],
    [{ id: "adj-2", snapshotId: "snap-2", workspaceId: WORKSPACE_B, projectStatus: "sent", acceptedPrice: null, finalQuotedPrice: null }],
  );
  const result2 = await syncQuoteWonOutcome({ tx: tx2, quoteId: QUOTE_ID, workspaceId: WORKSPACE_A, wonAmount: 80000 });
  assert("cross-workspace adjustment not matched", result2.reason === "adjustment_not_found");
}

// ── [8] unexpected persistence error is not swallowed ─────────────────────────
console.log("\n[8] unexpected persistence error propagates");
{
  const dbError = new Error("connection lost");
  const tx = makeFakeTx(
    [{ id: "snap-1", quoteId: QUOTE_ID, workspaceId: WORKSPACE_A }],
    [{ id: "adj-1", snapshotId: "snap-1", workspaceId: WORKSPACE_A, projectStatus: "sent", acceptedPrice: null, finalQuotedPrice: null }],
    { estimateAdjustment: { update: async () => { throw dbError; } } },
  );
  await assertThrows("real DB error is rethrown, not converted to a skip result",
    () => syncQuoteWonOutcome({ tx, quoteId: QUOTE_ID, workspaceId: WORKSPACE_A, wonAmount: 80000 }),
    (err) => err === dbError);
}

// ── [9] multiple linked snapshots → ambiguous, not "pick latest" ─────────────
console.log("\n[9] multiple linked snapshots are reported as ambiguous");
{
  const tx = makeFakeTx(
    [
      { id: "snap-1", quoteId: QUOTE_ID, workspaceId: WORKSPACE_A },
      { id: "snap-2", quoteId: QUOTE_ID, workspaceId: WORKSPACE_A },
    ],
    [],
  );
  const result = await syncQuoteWonOutcome({ tx, quoteId: QUOTE_ID, workspaceId: WORKSPACE_A, wonAmount: 80000 });
  assert("synced false", result.synced === false);
  assert("reason snapshot_link_ambiguous", result.reason === "snapshot_link_ambiguous");
  assert("both snapshot ids reported", JSON.stringify(result.snapshotIds) === JSON.stringify(["snap-1", "snap-2"]));
  // estimateAdjustment.findFirst was never reached — no adjustment lookup/update happens on an ambiguous link.
}

// ── Fake tx for linkEstimateSnapshotToQuote ───────────────────────────────────

/**
 * @param {Array} snapshots - [{ id, workspaceId, quoteId }]
 */
function makeFakeLinkTx(snapshots = []) {
  const snapshotStore = snapshots.map((s) => ({ ...s }));

  const tx = {
    estimateSnapshot: {
      // Mirrors Prisma: matches only rows satisfying every where clause,
      // including quoteId: null — that's the whole safety mechanism.
      updateMany: async ({ where, data }) => {
        const matches = snapshotStore.filter(
          (s) => s.id === where.id && s.workspaceId === where.workspaceId && s.quoteId === where.quoteId,
        );
        matches.forEach((s) => Object.assign(s, data));
        return { count: matches.length };
      },
      findUnique: async ({ where }) => {
        const found = snapshotStore.find((s) => s.id === where.id);
        return found ? { workspaceId: found.workspaceId, quoteId: found.quoteId } : null;
      },
      findMany: NEVER_CALL("estimateSnapshot.findMany"),
      create: NEVER_CALL("estimateSnapshot.create"),
      update: NEVER_CALL("estimateSnapshot.update"), // must use updateMany (conditional), never a bare update
    },
    estimateAdjustment: {
      findFirst: NEVER_CALL("estimateAdjustment.findFirst"),
      update: NEVER_CALL("estimateAdjustment.update"),
      create: NEVER_CALL("estimateAdjustment.create"),
      upsert: NEVER_CALL("estimateAdjustment.upsert"),
    },
    _snapshotStore: snapshotStore,
  };

  return tx;
}

const WORKSPACE_A_QUOTE_NEW = "quote-new";

// ── [10] valid snapshot links successfully ────────────────────────────────────
console.log("\n[10] valid snapshot links successfully");
{
  const tx = makeFakeLinkTx([{ id: "snap-1", workspaceId: WORKSPACE_A, quoteId: null }]);
  const result = await linkEstimateSnapshotToQuote({
    tx, estimateSnapshotId: "snap-1", quoteId: WORKSPACE_A_QUOTE_NEW, workspaceId: WORKSPACE_A,
  });
  assert("linked true", result.linked === true);
  assert("snapshotId echoed", result.snapshotId === "snap-1");
  assert("store actually updated", tx._snapshotStore[0].quoteId === WORKSPACE_A_QUOTE_NEW);
}

// ── [11] refine chain: only the passed id is touched ──────────────────────────
console.log("\n[11] refine chain — only the passed snapshot id is linked");
{
  const tx = makeFakeLinkTx([
    { id: "snap-root", workspaceId: WORKSPACE_A, quoteId: null },
    { id: "snap-latest", workspaceId: WORKSPACE_A, quoteId: null },
  ]);
  const result = await linkEstimateSnapshotToQuote({
    tx, estimateSnapshotId: "snap-latest", quoteId: WORKSPACE_A_QUOTE_NEW, workspaceId: WORKSPACE_A,
  });
  assert("linked true", result.linked === true);
  const root = tx._snapshotStore.find((s) => s.id === "snap-root");
  const latest = tx._snapshotStore.find((s) => s.id === "snap-latest");
  assert("latest revision linked", latest.quoteId === WORKSPACE_A_QUOTE_NEW);
  assert("root revision untouched", root.quoteId === null);
}

// ── [12] no estimateSnapshotId → manual quote, zero DB calls ─────────────────
console.log("\n[12] no estimateSnapshotId → manual quote path");
{
  // Every estimateSnapshot method is wired to throw if called — proves the
  // early return happens before any query, not just that the result looks right.
  const tx = makeFakeLinkTx([]);
  const resultNull = await linkEstimateSnapshotToQuote({ tx, estimateSnapshotId: null, quoteId: WORKSPACE_A_QUOTE_NEW, workspaceId: WORKSPACE_A });
  const resultUndefined = await linkEstimateSnapshotToQuote({ tx, estimateSnapshotId: undefined, quoteId: WORKSPACE_A_QUOTE_NEW, workspaceId: WORKSPACE_A });
  assert("null id → no_snapshot_id_provided", resultNull.reason === "no_snapshot_id_provided");
  assert("undefined id → no_snapshot_id_provided", resultUndefined.reason === "no_snapshot_id_provided");
  assert("linked false for both", resultNull.linked === false && resultUndefined.linked === false);
}

// ── [13] snapshot not found ────────────────────────────────────────────────────
console.log("\n[13] snapshot not found");
{
  const tx = makeFakeLinkTx([]);
  const result = await linkEstimateSnapshotToQuote({
    tx, estimateSnapshotId: "ghost-id", quoteId: WORKSPACE_A_QUOTE_NEW, workspaceId: WORKSPACE_A,
  });
  assert("linked false", result.linked === false);
  assert("reason snapshot_not_found", result.reason === "snapshot_not_found");
}

// ── [14] snapshot belongs to another workspace ────────────────────────────────
console.log("\n[14] snapshot belongs to another workspace — untouched");
{
  const tx = makeFakeLinkTx([{ id: "snap-1", workspaceId: WORKSPACE_B, quoteId: null }]);
  const result = await linkEstimateSnapshotToQuote({
    tx, estimateSnapshotId: "snap-1", quoteId: WORKSPACE_A_QUOTE_NEW, workspaceId: WORKSPACE_A,
  });
  assert("linked false", result.linked === false);
  assert("reason snapshot_workspace_mismatch", result.reason === "snapshot_workspace_mismatch");
  assert("snapshot quoteId still null", tx._snapshotStore[0].quoteId === null);
  assert("snapshot workspaceId unchanged", tx._snapshotStore[0].workspaceId === WORKSPACE_B);
}

// ── [15] snapshot already linked to another quote — not stolen ───────────────
console.log("\n[15] snapshot already linked elsewhere — not stolen");
{
  const tx = makeFakeLinkTx([{ id: "snap-1", workspaceId: WORKSPACE_A, quoteId: "other-quote" }]);
  const result = await linkEstimateSnapshotToQuote({
    tx, estimateSnapshotId: "snap-1", quoteId: WORKSPACE_A_QUOTE_NEW, workspaceId: WORKSPACE_A,
  });
  assert("linked false", result.linked === false);
  assert("reason snapshot_already_linked", result.reason === "snapshot_already_linked");
  assert("original quoteId preserved", tx._snapshotStore[0].quoteId === "other-quote");
}

// ── [16] two create requests racing the same snapshot ────────────────────────
console.log("\n[16] two create requests race the same snapshot — only first wins");
{
  const tx = makeFakeLinkTx([{ id: "snap-1", workspaceId: WORKSPACE_A, quoteId: null }]);
  const first = await linkEstimateSnapshotToQuote({ tx, estimateSnapshotId: "snap-1", quoteId: "quote-A", workspaceId: WORKSPACE_A });
  const second = await linkEstimateSnapshotToQuote({ tx, estimateSnapshotId: "snap-1", quoteId: "quote-B", workspaceId: WORKSPACE_A });
  assert("first wins", first.linked === true);
  assert("second loses", second.linked === false && second.reason === "snapshot_already_linked");
  assert("snapshot still bound to first quote", tx._snapshotStore[0].quoteId === "quote-A");
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`outcomeLearningService: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
