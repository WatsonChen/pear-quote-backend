/**
 * Tests for calibrationService.js — Outcome status integrity (Stage 3.6).
 * Run with: node src/lib/__tests__/calibrationService.test.js
 *
 * Hand-rolled assert harness (same convention as outcomeLearningService.test.js).
 * No live DB — a fake Prisma client stands in for the injectable `client` param.
 *
 * Scope: only resolveProjectStatusTransition and saveEstimateAdjustment.
 * computeCalibrationSuggestions / applyCalibrationSuggestions / snapshot
 * helpers are untouched by Stage 3.6 and are not re-tested here.
 *
 * Coverage:
 *   1. resolveProjectStatusTransition — full 5x5 status matrix
 *   2. resolveProjectStatusTransition — reason codes are meaningfully distinct
 *   3. saveEstimateAdjustment: no existing row → create, transition guard skipped
 *   4. saveEstimateAdjustment: forward transition → normal update
 *   5. saveEstimateAdjustment: same-status repeat → idempotent update
 *   6. saveEstimateAdjustment: regression → entire write ignored, existing returned unmodified
 *   7. saveEstimateAdjustment: terminal conflict (accepted → rejected) → entire write ignored
 *   8. saveEstimateAdjustment: acceptedPrice omitted → existing value preserved
 *   9. saveEstimateAdjustment: finalQuotedPrice omitted → existing value preserved
 *  10. saveEstimateAdjustment: acceptedPrice explicit null → treated as not provided, preserved
 *  11. saveEstimateAdjustment: finalQuotedPrice explicit null → treated as not provided, preserved
 *  12. saveEstimateAdjustment: actualHoursByRole omitted → existing value preserved
 *  13. saveEstimateAdjustment: scopeChanged omitted → existing value preserved
 *  14. saveEstimateAdjustment: adjustedModules / adjustedHoursByRole omitted → existing values preserved
 *  15. saveEstimateAdjustment: unexpected persistence error propagates, not swallowed
 *  16. saveEstimateAdjustment: cross-workspace guard still throws 404 (pre-existing behavior, unchanged)
 */

import { saveEstimateAdjustment, resolveProjectStatusTransition } from "../calibrationService.js";

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

// ── Fake Prisma client ─────────────────────────────────────────────────────────

const NEVER_CALL = (name) => async () => {
  throw new Error(`${name} should never be called on a regression/terminal-conflict write`);
};

const WORKSPACE_A = "ws-a";
const WORKSPACE_B = "ws-b";
const SNAPSHOT_ID = "snap-1";

/**
 * @param {object|null} snapshot     - { id, workspaceId } or null for "not found"
 * @param {object|null} adjustment   - existing EstimateAdjustment row, or null for "no row yet"
 * @param {object} overrides         - per-method overrides, e.g. { estimateAdjustment: { update: NEVER_CALL(...) } }
 */
function makeFakeClient(snapshot, adjustment, overrides = {}) {
  const adjustmentStore = adjustment ? [{ ...adjustment }] : [];

  const client = {
    estimateSnapshot: {
      findFirst: async ({ where }) =>
        snapshot && snapshot.id === where.id && snapshot.workspaceId === where.workspaceId
          ? { id: snapshot.id }
          : null,
    },
    estimateAdjustment: {
      findUnique: async ({ where }) =>
        adjustmentStore.find((a) => a.snapshotId === where.snapshotId) ?? null,
      update: async ({ where, data }) => {
        const record = adjustmentStore.find((a) => a.snapshotId === where.snapshotId);
        if (!record) throw new Error("Record to update not found");
        Object.assign(record, data);
        return { ...record };
      },
      create: async ({ data }) => {
        const record = { id: `adj-${adjustmentStore.length + 1}`, ...data };
        adjustmentStore.push(record);
        return { ...record };
      },
    },
    _adjustmentStore: adjustmentStore,
  };

  for (const [model, methods] of Object.entries(overrides)) {
    Object.assign(client[model], methods);
  }

  return client;
}

// ── [1] resolveProjectStatusTransition — full matrix ──────────────────────────
console.log("\n[1] resolveProjectStatusTransition — full 5x5 matrix");
{
  const STATUSES = ["draft", "sent", "accepted", "completed", "rejected"];
  const EXPECTED = {
    "draft>draft": "allow", "draft>sent": "allow", "draft>accepted": "allow", "draft>completed": "allow", "draft>rejected": "allow",
    "sent>draft": "ignore", "sent>sent": "allow", "sent>accepted": "allow", "sent>completed": "allow", "sent>rejected": "allow",
    "accepted>draft": "ignore", "accepted>sent": "ignore", "accepted>accepted": "allow", "accepted>completed": "allow", "accepted>rejected": "ignore",
    "completed>draft": "ignore", "completed>sent": "ignore", "completed>accepted": "ignore", "completed>completed": "allow", "completed>rejected": "ignore",
    "rejected>draft": "ignore", "rejected>sent": "ignore", "rejected>accepted": "ignore", "rejected>completed": "ignore", "rejected>rejected": "allow",
  };

  for (const current of STATUSES) {
    for (const requested of STATUSES) {
      const key = `${current}>${requested}`;
      const expected = EXPECTED[key];
      const result = resolveProjectStatusTransition(current, requested);
      const got = result.allowed ? "allow" : "ignore";
      assert(`${key} → ${expected}`, got === expected, `got allowed=${result.allowed} reason=${result.reason}`);
    }
  }
}

// ── [2] resolveProjectStatusTransition — reason codes ──────────────────────────
console.log("\n[2] resolveProjectStatusTransition — reason codes are meaningfully distinct");
{
  assert("same status → same_status", resolveProjectStatusTransition("accepted", "accepted").reason === "same_status");
  assert("forward → forward", resolveProjectStatusTransition("sent", "accepted").reason === "forward");
  assert("skip-rank forward (sent→completed) → forward", resolveProjectStatusTransition("sent", "completed").reason === "forward");
  assert("backward → regression", resolveProjectStatusTransition("accepted", "sent").reason === "regression");
  assert("accepted → rejected → terminal_conflict", resolveProjectStatusTransition("accepted", "rejected").reason === "terminal_conflict");
  assert("completed → rejected → terminal_conflict", resolveProjectStatusTransition("completed", "rejected").reason === "terminal_conflict");
  assert("rejected → sent → terminal_conflict", resolveProjectStatusTransition("rejected", "sent").reason === "terminal_conflict");
  assert("draft → rejected → forward (not terminal_conflict)", resolveProjectStatusTransition("draft", "rejected").reason === "forward");
}

// ── [3] no existing row → create, transition guard skipped ───────────────────
console.log("\n[3] no existing adjustment → create path, no transition check");
{
  const client = makeFakeClient({ id: SNAPSHOT_ID, workspaceId: WORKSPACE_A }, null);
  const result = await saveEstimateAdjustment({
    client, snapshotId: SNAPSHOT_ID, workspaceId: WORKSPACE_A,
    projectStatus: "sent", finalQuotedPrice: 50000,
  });
  assert("row created", client._adjustmentStore.length === 1);
  assert("projectStatus set", result.projectStatus === "sent");
  assert("finalQuotedPrice set", result.finalQuotedPrice === 50000);
  assert("omitted acceptedPrice defaults to null on create", result.acceptedPrice === null);
}

// ── [4] forward transition → normal update ────────────────────────────────────
console.log("\n[4] forward transition (sent → accepted) → normal update");
{
  const client = makeFakeClient(
    { id: SNAPSHOT_ID, workspaceId: WORKSPACE_A },
    { snapshotId: SNAPSHOT_ID, workspaceId: WORKSPACE_A, projectStatus: "sent", finalQuotedPrice: 50000, acceptedPrice: null },
  );
  const result = await saveEstimateAdjustment({
    client, snapshotId: SNAPSHOT_ID, workspaceId: WORKSPACE_A,
    projectStatus: "accepted", acceptedPrice: 48000,
  });
  assert("projectStatus advanced", result.projectStatus === "accepted");
  assert("acceptedPrice written", result.acceptedPrice === 48000);
}

// ── [5] same-status repeat → idempotent update ────────────────────────────────
console.log("\n[5] same-status repeat (sent → sent) → idempotent, still updates other fields");
{
  const client = makeFakeClient(
    { id: SNAPSHOT_ID, workspaceId: WORKSPACE_A },
    { snapshotId: SNAPSHOT_ID, workspaceId: WORKSPACE_A, projectStatus: "sent", finalQuotedPrice: 50000 },
  );
  const result = await saveEstimateAdjustment({
    client, snapshotId: SNAPSHOT_ID, workspaceId: WORKSPACE_A,
    projectStatus: "sent", finalQuotedPrice: 52000,
  });
  assert("projectStatus stays sent", result.projectStatus === "sent");
  assert("finalQuotedPrice reflects latest edit", result.finalQuotedPrice === 52000);
}

// ── [6] regression → entire write ignored ──────────────────────────────────────
console.log("\n[6] regression (accepted → sent) → entire write ignored");
{
  const existing = {
    snapshotId: SNAPSHOT_ID, workspaceId: WORKSPACE_A, projectStatus: "accepted",
    finalQuotedPrice: 220000, acceptedPrice: 220000, adjustedEstimateRange: { min: 220000, max: 220000, currency: "TWD" },
    adjustedModules: [{ baselineKey: "auth" }], adjustedHoursByRole: { pm: 10 },
    adjustmentReason: "original reason", scopeChanged: false, actualHoursByRole: null,
  };
  const client = makeFakeClient(
    { id: SNAPSHOT_ID, workspaceId: WORKSPACE_A },
    existing,
    { estimateAdjustment: { update: NEVER_CALL("estimateAdjustment.update"), create: NEVER_CALL("estimateAdjustment.create") } },
  );
  const result = await saveEstimateAdjustment({
    client, snapshotId: SNAPSHOT_ID, workspaceId: WORKSPACE_A,
    projectStatus: "sent",
    finalQuotedPrice: 1, acceptedPrice: null, adjustedEstimateRange: { min: 1, max: 1, currency: "TWD" },
    adjustedModules: [{ baselineKey: "stale" }], adjustedHoursByRole: { pm: 999 },
    adjustmentReason: "stale replay", scopeChanged: true, actualHoursByRole: { pm: 999 },
  });
  // NEVER_CALL on update/create proves the write never reached Prisma — if
  // saveEstimateAdjustment had called either, this test would have thrown above.
  assert("projectStatus unchanged", result.projectStatus === "accepted");
  assert("finalQuotedPrice unchanged", result.finalQuotedPrice === 220000);
  assert("acceptedPrice unchanged", result.acceptedPrice === 220000);
  assert("adjustedEstimateRange unchanged", result.adjustedEstimateRange.max === 220000);
  assert("adjustedModules unchanged", result.adjustedModules[0].baselineKey === "auth");
  assert("adjustedHoursByRole unchanged", result.adjustedHoursByRole.pm === 10);
  assert("adjustmentReason unchanged", result.adjustmentReason === "original reason");
  assert("scopeChanged unchanged", result.scopeChanged === false);
}

// ── [7] terminal conflict (accepted → rejected) → entire write ignored ────────
console.log("\n[7] terminal conflict (accepted → rejected) → entire write ignored");
{
  const existing = { snapshotId: SNAPSHOT_ID, workspaceId: WORKSPACE_A, projectStatus: "accepted", acceptedPrice: 100000 };
  const client = makeFakeClient(
    { id: SNAPSHOT_ID, workspaceId: WORKSPACE_A },
    existing,
    { estimateAdjustment: { update: NEVER_CALL("estimateAdjustment.update") } },
  );
  const result = await saveEstimateAdjustment({
    client, snapshotId: SNAPSHOT_ID, workspaceId: WORKSPACE_A, projectStatus: "rejected",
  });
  assert("projectStatus stays accepted", result.projectStatus === "accepted");
  assert("acceptedPrice unchanged", result.acceptedPrice === 100000);
}

// ── [8] acceptedPrice omitted → preserved ──────────────────────────────────────
console.log("\n[8] acceptedPrice omitted from request → existing value preserved");
{
  const client = makeFakeClient(
    { id: SNAPSHOT_ID, workspaceId: WORKSPACE_A },
    { snapshotId: SNAPSHOT_ID, workspaceId: WORKSPACE_A, projectStatus: "accepted", acceptedPrice: 220000 },
  );
  // Same-status repeat, acceptedPrice not included in this call at all.
  const result = await saveEstimateAdjustment({
    client, snapshotId: SNAPSHOT_ID, workspaceId: WORKSPACE_A, projectStatus: "accepted",
  });
  assert("acceptedPrice preserved", result.acceptedPrice === 220000);
}

// ── [9] finalQuotedPrice omitted → preserved ───────────────────────────────────
console.log("\n[9] finalQuotedPrice omitted from request → existing value preserved");
{
  const client = makeFakeClient(
    { id: SNAPSHOT_ID, workspaceId: WORKSPACE_A },
    { snapshotId: SNAPSHOT_ID, workspaceId: WORKSPACE_A, projectStatus: "sent", finalQuotedPrice: 88000 },
  );
  const result = await saveEstimateAdjustment({
    client, snapshotId: SNAPSHOT_ID, workspaceId: WORKSPACE_A, projectStatus: "sent",
  });
  assert("finalQuotedPrice preserved", result.finalQuotedPrice === 88000);
}

// ── [10] acceptedPrice explicit null → treated as not provided ────────────────
console.log("\n[10] acceptedPrice: null (explicit) → treated as not provided, preserved");
{
  const client = makeFakeClient(
    { id: SNAPSHOT_ID, workspaceId: WORKSPACE_A },
    { snapshotId: SNAPSHOT_ID, workspaceId: WORKSPACE_A, projectStatus: "accepted", acceptedPrice: 220000 },
  );
  const result = await saveEstimateAdjustment({
    client, snapshotId: SNAPSHOT_ID, workspaceId: WORKSPACE_A, projectStatus: "accepted", acceptedPrice: null,
  });
  assert("acceptedPrice NOT cleared by explicit null", result.acceptedPrice === 220000);
}

// ── [11] finalQuotedPrice explicit null → treated as not provided ─────────────
console.log("\n[11] finalQuotedPrice: null (explicit) → treated as not provided, preserved");
{
  const client = makeFakeClient(
    { id: SNAPSHOT_ID, workspaceId: WORKSPACE_A },
    { snapshotId: SNAPSHOT_ID, workspaceId: WORKSPACE_A, projectStatus: "sent", finalQuotedPrice: 88000 },
  );
  const result = await saveEstimateAdjustment({
    client, snapshotId: SNAPSHOT_ID, workspaceId: WORKSPACE_A, projectStatus: "sent", finalQuotedPrice: null,
  });
  assert("finalQuotedPrice NOT cleared by explicit null", result.finalQuotedPrice === 88000);
}

// ── [12] actualHoursByRole omitted → preserved ─────────────────────────────────
console.log("\n[12] actualHoursByRole omitted → existing value preserved");
{
  const client = makeFakeClient(
    { id: SNAPSHOT_ID, workspaceId: WORKSPACE_A },
    { snapshotId: SNAPSHOT_ID, workspaceId: WORKSPACE_A, projectStatus: "completed", actualHoursByRole: { pm: 40 } },
  );
  const result = await saveEstimateAdjustment({
    client, snapshotId: SNAPSHOT_ID, workspaceId: WORKSPACE_A, projectStatus: "completed",
  });
  assert("actualHoursByRole preserved", result.actualHoursByRole.pm === 40);
}

// ── [13] scopeChanged omitted → preserved ──────────────────────────────────────
console.log("\n[13] scopeChanged omitted → existing value preserved (not reset to false)");
{
  const client = makeFakeClient(
    { id: SNAPSHOT_ID, workspaceId: WORKSPACE_A },
    { snapshotId: SNAPSHOT_ID, workspaceId: WORKSPACE_A, projectStatus: "sent", scopeChanged: true },
  );
  const result = await saveEstimateAdjustment({
    client, snapshotId: SNAPSHOT_ID, workspaceId: WORKSPACE_A, projectStatus: "sent",
  });
  assert("scopeChanged preserved as true", result.scopeChanged === true);
}

// ── [14] adjustedModules / adjustedHoursByRole omitted → preserved ────────────
console.log("\n[14] adjustedModules / adjustedHoursByRole omitted → existing values preserved");
{
  const client = makeFakeClient(
    { id: SNAPSHOT_ID, workspaceId: WORKSPACE_A },
    {
      snapshotId: SNAPSHOT_ID, workspaceId: WORKSPACE_A, projectStatus: "sent",
      adjustedModules: [{ baselineKey: "auth" }], adjustedHoursByRole: { pm: 10 },
    },
  );
  const result = await saveEstimateAdjustment({
    client, snapshotId: SNAPSHOT_ID, workspaceId: WORKSPACE_A, projectStatus: "sent",
  });
  assert("adjustedModules preserved", result.adjustedModules[0].baselineKey === "auth");
  assert("adjustedHoursByRole preserved", result.adjustedHoursByRole.pm === 10);
}

// ── [15] unexpected persistence error propagates ───────────────────────────────
console.log("\n[15] unexpected persistence error propagates, not swallowed");
{
  const dbError = new Error("connection lost");
  const client = makeFakeClient(
    { id: SNAPSHOT_ID, workspaceId: WORKSPACE_A },
    { snapshotId: SNAPSHOT_ID, workspaceId: WORKSPACE_A, projectStatus: "sent" },
    { estimateAdjustment: { update: async () => { throw dbError; } } },
  );
  await assertThrows(
    "real DB error is rethrown, not converted to a skip result",
    () => saveEstimateAdjustment({ client, snapshotId: SNAPSHOT_ID, workspaceId: WORKSPACE_A, projectStatus: "accepted" }),
    (err) => err === dbError,
  );
}

// ── [16] cross-workspace guard still throws 404 ────────────────────────────────
console.log("\n[16] cross-workspace guard unchanged — snapshot in another workspace throws 404");
{
  const client = makeFakeClient({ id: SNAPSHOT_ID, workspaceId: WORKSPACE_B }, null);
  await assertThrows(
    "wrong workspace → 404",
    () => saveEstimateAdjustment({ client, snapshotId: SNAPSHOT_ID, workspaceId: WORKSPACE_A, projectStatus: "sent" }),
    (err) => err.statusCode === 404,
  );
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`calibrationService: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
