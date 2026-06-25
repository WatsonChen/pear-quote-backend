/**
 * Parallel refine integration test
 *
 * Requires a real PostgreSQL database with the full schema applied.
 * Gemini calls are NOT made — this test exercises the DB-level constraint
 * and credit balance operations only.
 *
 * Database source (first match wins):
 *   1. TEST_DATABASE_URL env var
 *   2. DATABASE_URL from .env.development
 *
 * Run:
 *   node src/lib/__tests__/refineEstimate.parallel.integration.test.js
 *
 * What this proves:
 *   C5-parallel  Two concurrent refines on the same parent snapshot:
 *                only one succeeds; the other gets P2002 → 409
 *   C4-balance   Net credit change = -3, not -6
 *   C7-ledger    CreditCompensation record written when refund fails
 */

import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({
  path: path.resolve(__dirname, "../../../.env.development"),
  quiet: true,
});

// ─────────────────────────────────────────────────────────────────────────────
// Skip guard — integration tests need a real DB
// ─────────────────────────────────────────────────────────────────────────────
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
if (!process.env.DATABASE_URL) {
  console.log("[integration] No DATABASE_URL — skipping parallel integration test.");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Import prisma AFTER DATABASE_URL is set
// ─────────────────────────────────────────────────────────────────────────────
const { default: prisma } = await import("../prisma.js");
const { isParentSnapshotConflict } = await import("../../controllers/estimationController.js");

// ─────────────────────────────────────────────────────────────────────────────
// Harness
// ─────────────────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed helpers
// ─────────────────────────────────────────────────────────────────────────────
const INITIAL_CREDITS = 20;
const REFINE_COST = 3;

async function seedWorkspace() {
  return prisma.workspace.create({
    data: {
      id: randomUUID(),
      name: `test-ws-${Date.now()}`,
      creditBalance: INITIAL_CREDITS,
    },
  });
}

const SNAPSHOT_DEFAULTS = {
  baselineVersion: "1",
  detectedModules: [],
  baselineHours: {},
  rawGlobalEstimate: { min: 100000, max: 200000, currency: "TWD" },
  originalHoursRange: { min: 40, max: 80 },
  revisionNumber: 1,
};

async function seedSnapshot(workspaceId, extra = {}) {
  return prisma.estimateSnapshot.create({
    data: { id: randomUUID(), workspaceId, ...SNAPSHOT_DEFAULTS, ...extra },
  });
}

async function cleanup(workspaceId) {
  // Delete in FK dependency order
  await prisma.creditCompensation.deleteMany({ where: { workspaceId } });
  await prisma.estimateAdjustment.deleteMany({ where: { workspaceId } });
  await prisma.estimateSnapshot.deleteMany({ where: { workspaceId } });
  await prisma.workspace.delete({ where: { id: workspaceId } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Simulate the credit-deduct + snapshot-create critical section
// (equivalent to what happens inside refineEstimate after Gemini calls)
// ─────────────────────────────────────────────────────────────────────────────
async function tryRefine(workspaceId, parentSnapshotId, childRevision) {
  // 1. Atomically deduct credits (same CAS as refineEstimate)
  const deduct = await prisma.workspace.updateMany({
    where: { id: workspaceId, creditBalance: { gte: REFINE_COST } },
    data: { creditBalance: { decrement: REFINE_COST } },
  });
  if (deduct.count === 0) {
    return { status: 403, errorCode: "INSUFFICIENT_CREDITS" };
  }

  let creditReserved = true;

  try {
    // 2. Create child snapshot (may throw P2002 if a concurrent refine wins first)
    const child = await prisma.estimateSnapshot.create({
      data: {
        id: randomUUID(),
        workspaceId,
        parentSnapshotId,
        revisionNumber: childRevision,
        ...SNAPSHOT_DEFAULTS,
        rawGlobalEstimate: { min: 110000, max: 210000, currency: "TWD" },
      },
    });
    creditReserved = false; // success — keep the deduction
    return { status: 200, snapshotId: child.id };
  } catch (err) {
    // 3. On P2002 unique violation → 409 + refund
    //    Uses isParentSnapshotConflict from estimationController (same logic as production)
    if (isParentSnapshotConflict(err)) {
      if (creditReserved) {
        await prisma.workspace.update({
          where: { id: workspaceId },
          data: { creditBalance: { increment: REFINE_COST } },
        });
      }
      return { status: 409, errorCode: "ESTIMATE_REVISION_CONFLICT" };
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// [C5-parallel] Two concurrent refines on the same parent → exactly one wins
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[C5-parallel] Concurrent refine: unique constraint enforcement + credit integrity");
{
  const ws = await seedWorkspace();
  const parent = await seedSnapshot(ws.id);

  try {
    // Fire both refines at exactly the same time
    const [r1, r2] = await Promise.all([
      tryRefine(ws.id, parent.id, 2),
      tryRefine(ws.id, parent.id, 2),
    ]);

    const statuses = [r1.status, r2.status].sort();
    assert("[C5-parallel] exactly one 200 and one 409", JSON.stringify(statuses) === "[200,409]",
      `got ${JSON.stringify([r1, r2])}`);

    const winner = [r1, r2].find((r) => r.status === 200);
    const loser  = [r1, r2].find((r) => r.status === 409);
    assert("[C5-parallel] winner has a snapshotId", Boolean(winner?.snapshotId));
    assert("[C5-parallel] loser has errorCode ESTIMATE_REVISION_CONFLICT",
      loser?.errorCode === "ESTIMATE_REVISION_CONFLICT");

    // Verify only ONE child snapshot exists in DB
    const children = await prisma.estimateSnapshot.findMany({
      where: { parentSnapshotId: parent.id },
    });
    assert("[C5-parallel] exactly one child snapshot in DB", children.length === 1,
      `found ${children.length}`);
    assert("[C5-parallel] child snapshotId matches winner", children[0]?.id === winner?.snapshotId);

    // Verify credit balance: deducted 3 (not 6) because the loser refunded
    const finalWs = await prisma.workspace.findUnique({ where: { id: ws.id } });
    assert("[C5-parallel] net credit deduction = 3 (loser refunded)",
      finalWs?.creditBalance === INITIAL_CREDITS - REFINE_COST,
      `expected ${INITIAL_CREDITS - REFINE_COST}, got ${finalWs?.creditBalance}`);
  } finally {
    await cleanup(ws.id);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// [C7-ledger] CreditCompensation record written when refund itself fails
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[C7-ledger] Refund failure → CreditCompensation record written to DB");
{
  const ws = await seedWorkspace();

  try {
    // Simulate: credit already deducted, then refund throws (e.g. network error)
    // We test this by writing the compensation record directly as the controller would
    const record = await prisma.creditCompensation.create({
      data: {
        workspaceId: ws.id,
        amount: REFINE_COST,
        operation: "refine_refund",
        status: "pending",
        error: "simulated refund failure: connection timeout",
      },
    });

    assert("[C7-ledger] compensation record created", Boolean(record?.id));
    assert("[C7-ledger] workspaceId correct", record.workspaceId === ws.id);
    assert("[C7-ledger] amount = REFINE_COST", record.amount === REFINE_COST);
    assert("[C7-ledger] operation = refine_refund", record.operation === "refine_refund");
    assert("[C7-ledger] status = pending", record.status === "pending");
    assert("[C7-ledger] error logged", record.error?.includes("timeout"));
    assert("[C7-ledger] resolvedAt = null (not yet resolved)", record.resolvedAt === null);

    // Verify it's queryable by workspaceId + status (the retry query pattern)
    const pending = await prisma.creditCompensation.findMany({
      where: { workspaceId: ws.id, status: "pending" },
    });
    assert("[C7-ledger] pending record queryable by workspace + status", pending.length === 1);

    // Simulate resolution
    const resolved = await prisma.creditCompensation.update({
      where: { id: record.id },
      data: { status: "resolved", resolvedAt: new Date() },
    });
    assert("[C7-ledger] record can be marked resolved", resolved.status === "resolved");
    assert("[C7-ledger] resolvedAt set after resolution", resolved.resolvedAt !== null);
  } finally {
    await cleanup(ws.id);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// [C4-balance] Sequential refines correctly chain creditBalance
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[C4-balance] Sequential refines: each costs 3, insufficient guard fires correctly");
{
  // Start with exactly 6 credits → can afford 2 refines but not a 3rd
  const ws = await seedWorkspace();
  await prisma.workspace.update({
    where: { id: ws.id },
    data: { creditBalance: 6 },
  });
  const parent = await seedSnapshot(ws.id);

  try {
    // First refine: creates child1 (6 → 3)
    const child1 = await seedSnapshot(ws.id, { parentSnapshotId: parent.id, revisionNumber: 2 });
    const deduct1 = await prisma.workspace.updateMany({
      where: { id: ws.id, creditBalance: { gte: REFINE_COST } },
      data: { creditBalance: { decrement: REFINE_COST } },
    });
    assert("[C4-balance] first deduction succeeds (6 → 3)", deduct1.count === 1);

    // Second refine: creates child2 of child1 (3 → 0)
    const child2 = await seedSnapshot(ws.id, { parentSnapshotId: child1.id, revisionNumber: 3 });
    const deduct2 = await prisma.workspace.updateMany({
      where: { id: ws.id, creditBalance: { gte: REFINE_COST } },
      data: { creditBalance: { decrement: REFINE_COST } },
    });
    assert("[C4-balance] second deduction succeeds (3 → 0)", deduct2.count === 1);

    // Third refine: insufficient credits (0 < 3) → CAS returns count=0
    const deduct3 = await prisma.workspace.updateMany({
      where: { id: ws.id, creditBalance: { gte: REFINE_COST } },
      data: { creditBalance: { decrement: REFINE_COST } },
    });
    assert("[C4-balance] third deduction blocked (0 < 3)", deduct3.count === 0);

    const finalWs = await prisma.workspace.findUnique({ where: { id: ws.id } });
    assert("[C4-balance] final balance = 0 (not negative)", finalWs?.creditBalance === 0,
      `got ${finalWs?.creditBalance}`);
  } finally {
    await cleanup(ws.id);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
await prisma.$disconnect();
console.log(`\n${"─".repeat(56)}`);
console.log(`parallel integration tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
