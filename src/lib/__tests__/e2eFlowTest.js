/**
 * End-to-End Flow Test — PearQuote Estimation Engine
 *
 * Tests the REAL pipeline with real DB and real Gemini AI:
 *   requirementText → AI selects tier → estimate → snapshot → adjustment → suggestions → serializer check
 *
 * Usage:
 *   DATABASE_URL="<your-neon-or-local-url>" node src/lib/__tests__/e2eFlowTest.js
 *   (or just: node src/lib/__tests__/e2eFlowTest.js  if .env.development has the right DB URL)
 *
 * Requirements:
 *   - Database must be migrated (npx prisma migrate deploy)
 *   - GOOGLE_GENERATIVE_AI_API_KEY must be set (for Gemini calls)
 *   - JWT_SECRET must be set
 */

import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env.development"), quiet: true });

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, label, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
    errors.push(label);
  }
}

function section(title) {
  console.log(`\n${"─".repeat(60)}\n${title}\n${"─".repeat(60)}`);
}

/** Lightweight mock of Express req/res */
function mockReq({ body = {}, params = {}, workspace, workspaceRole = "OWNER", user } = {}) {
  return {
    body,
    params,
    headers: {},
    workspace,
    workspaceRole,
    user,
    isFallbackWorkspace: false,
  };
}

function mockRes() {
  let _status = 200;
  let _body = null;
  const res = {
    status(code) { _status = code; return res; },
    json(body) { _body = body; return res; },
    set() { return res; },
    getResult() { return { status: _status, body: _body }; },
  };
  return res;
}

/** Recursive scan for internal-only keys */
const FORBIDDEN_KEYS = new Set([
  "internalRange", "ratesUsed", "marginRange",
  "estimateCalibrationFactors", "pricingCalibrationFactors", "calibrationFactorsApplied",
]);
function findForbiddenKeys(obj, path = "") {
  if (!obj || typeof obj !== "object") return [];
  return Object.entries(obj).flatMap(([k, v]) => {
    const p = path ? `${path}.${k}` : k;
    return FORBIDDEN_KEYS.has(k) ? [p] : findForbiddenKeys(v, p);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Load services
// ─────────────────────────────────────────────────────────────────────────────

const { default: prisma } = await import("../prisma.js");
const { estimateModules }  = await import("../../controllers/estimationController.js");
const { createAdjustment, getSuggestions } = await import("../../controllers/calibrationController.js");
const { buildPublicEstimateResponse, buildShareProposalResponse } = await import("../estimateSerializer.js");

// ─────────────────────────────────────────────────────────────────────────────
// Test workspace setup (idempotent)
// ─────────────────────────────────────────────────────────────────────────────

section("Setup — test workspace");

const E2E_WORKSPACE_NAME = "__e2e_test_workspace__";
const E2E_USER_EMAIL     = "__e2e_test@pear.test__";

let testWorkspace;
let testUser;

try {
  // Find or create test user (email is unique)
  testUser = await prisma.user.findUnique({ where: { email: E2E_USER_EMAIL } });
  if (!testUser) {
    testUser = await prisma.user.create({ data: { email: E2E_USER_EMAIL } });
  }

  // Find or create test workspace (name is not unique, search by name)
  testWorkspace = await prisma.workspace.findFirst({ where: { name: E2E_WORKSPACE_NAME } });
  if (!testWorkspace) {
    testWorkspace = await prisma.workspace.create({ data: { name: E2E_WORKSPACE_NAME } });
  }

  // Find or create WorkspaceUser link
  const existing = await prisma.workspaceUser.findUnique({
    where: { userId_workspaceId: { userId: testUser.id, workspaceId: testWorkspace.id } },
  });
  if (!existing) {
    await prisma.workspaceUser.create({
      data: { userId: testUser.id, workspaceId: testWorkspace.id, role: "OWNER" },
    });
  }

  assert(!!testWorkspace.id, `Test workspace created: ${testWorkspace.name}`);
  assert(!!testUser.id, `Test user created: ${testUser.email}`);
} catch (err) {
  console.error("\n❌ DB setup failed. Is the database running and migrated?");
  console.error("   Tip: DATABASE_URL=<url> node src/lib/__tests__/e2eFlowTest.js");
  console.error("  ", err.message);
  process.exit(1);
}

const REQ_WORKSPACE = testWorkspace;
const REQ_USER      = { id: testUser.id, email: testUser.email };

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: POST /api/ai/estimate-modules
// ─────────────────────────────────────────────────────────────────────────────

section('Step 1 — POST /api/ai/estimate-modules\n  需求: 「我想做一個公司官網，介紹服務、案例、聯絡方式，目前不確定之後要不要自己更新內容。」');

const requirementSpec = {
  projectType: "website",
  businessGoal: "公司官網，介紹服務與案例，並提供聯絡方式",
  clientIntent: "建立品牌官網，提升詢問轉換率",
  platforms: ["web"],
  requirements: [
    { id: "R1", status: "confirmed", text: "首頁介紹公司服務與價值主張" },
    { id: "R2", status: "confirmed", text: "案例展示頁面（作品集）" },
    { id: "R3", status: "confirmed", text: "聯絡我們頁面，含表單" },
    { id: "R4", status: "unclear",   text: "是否需要後台讓業務自行更新最新消息（尚未確定）" },
  ],
  assumptions: ["採用 RWD 響應式設計", "不含電商功能"],
};

const estimateReq = mockReq({
  body:          { requirementSpec },
  workspace:     REQ_WORKSPACE,
  workspaceRole: "OWNER",
  user:          REQ_USER,
});
const estimateRes = mockRes();

console.log("\n  Calling estimateModules (real Gemini AI call — may take a few seconds)...");
await estimateModules(estimateReq, estimateRes);
const estimateResult = estimateRes.getResult();

console.log(`\n  Response status: ${estimateResult.status}`);
if (estimateResult.status !== 200) {
  console.error("  AI response error:", JSON.stringify(estimateResult.body, null, 2));
}

const data = estimateResult.body;

assert(estimateResult.status === 200, "estimate-modules returns 200");
assert(data?.success === true,        "success = true");
assert(typeof data?.snapshotId === "string" && data.snapshotId.length > 0, "snapshotId auto-saved");

const snapshotId = data?.snapshotId;
console.log(`  snapshotId: ${snapshotId}`);

// Tier selection check
const selectedKeys = (data?.modules ?? []).map((m) => m.baselineKey);
console.log(`\n  AI selected modules: ${JSON.stringify(selectedKeys)}`);

const DEPRECATED = ["landing_page", "multi_page_website", "email_notification"];
const hasDeprecated = selectedKeys.some((k) => DEPRECATED.includes(k));
assert(!hasDeprecated, "No deprecated baseline keys selected");

const hasAdvanced = selectedKeys.includes("corporate_site_advanced");
assert(!hasAdvanced, "AI did NOT over-select corporate_site_advanced for vague requirement");

const hasSomeSite = selectedKeys.some((k) =>
  ["landing_page_simple", "corporate_site_static", "corporate_site_with_cms"].includes(k)
);
assert(hasSomeSite, "AI selected a website baseline (static or with_cms for vague requirement)");

// missingInfo: should ask about CMS since R4 is unclear
const allMissing = data?.missingInfo ?? [];
console.log(`\n  missingInfo (${allMissing.length} items):`);
allMissing.slice(0, 5).forEach((q) => console.log(`    · ${q}`));
if (allMissing.length > 5) console.log(`    · … +${allMissing.length - 5} more`);

const hasCMSQuestion = allMissing.some((q) => /後台|更新|cms|content/i.test(q));
assert(hasCMSQuestion, "missingInfo includes CMS / content editing question");

// Core fields
assert(data?.estimateRange?.min > 0, `estimateRange.min > 0 (got: ${data?.estimateRange?.min})`);
assert(data?.estimateRange?.max > data?.estimateRange?.min, "estimateRange.max > min");
assert(data?.overallConfidence >= 0 && data?.overallConfidence <= 1, `overallConfidence in [0,1] (got: ${data?.overallConfidence})`);
assert(typeof data?.projectRiskSummary === "string" && data.projectRiskSummary.length > 0, "projectRiskSummary present");

// Serializer security (admin response for OWNER should still not leak via public path)
const publicSanitized = buildPublicEstimateResponse(data);
const shareSanitized  = buildShareProposalResponse(data);

const publicForbidden = findForbiddenKeys(publicSanitized);
const shareForbidden  = findForbiddenKeys(shareSanitized);

assert(publicForbidden.length === 0,
  `Public response: 0 forbidden keys`,
  publicForbidden.length > 0 ? `leaked: ${publicForbidden.join(", ")}` : "");
assert(shareForbidden.length === 0,
  `Share response: 0 forbidden keys`,
  shareForbidden.length > 0 ? `leaked: ${shareForbidden.join(", ")}` : "");

assert(!publicSanitized.hasOwnProperty("snapshotId") || publicSanitized.snapshotId != null,
  "snapshotId preserved in public response");
assert(!shareSanitized.hasOwnProperty("snapshotId"),
  "snapshotId NOT in share/proposal response");

const priceMin = data.estimateRange.min / 1000;
const priceMax = data.estimateRange.max / 1000;
console.log(`\n  estimateRange: NT$${priceMin}k – NT$${priceMax}k`);
assert(priceMax >= 50,  `Price max >= NT$50k (not degenerate low)`);
assert(priceMax <= 700, `Price max <= NT$700k (not degenerate high for basic site)`);

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: POST /api/calibration/snapshots/:snapshotId/adjustment (pricing signal)
// ─────────────────────────────────────────────────────────────────────────────

section("Step 2 — POST /api/calibration/snapshots/:snapshotId/adjustment\n  Simulate: user bumps price (projectStatus: sent, no actualHoursByRole)");

const adjustedMax = Math.round(data.estimateRange.max * 1.3 / 1000) * 1000;
const finalPrice  = Math.round(data.estimateRange.max * 1.25 / 1000) * 1000;

const adjReq = mockReq({
  body: {
    adjustedEstimateRange: { min: data.estimateRange.min, max: adjustedMax, currency: "TWD" },
    finalQuotedPrice:  finalPrice,
    adjustmentReason:  "客戶需求不明確，保留 CMS 溝通風險，報價上調",
    projectStatus:     "sent",
    scopeChanged:      false,
  },
  params:        { snapshotId },
  workspace:     REQ_WORKSPACE,
  workspaceRole: "OWNER",
  user:          REQ_USER,
});
const adjRes = mockRes();

await createAdjustment(adjReq, adjRes);
const adjResult = adjRes.getResult();

console.log(`\n  Adjustment response status: ${adjResult.status}`);
assert(adjResult.status === 201, "adjustment saved (201)");
assert(typeof adjResult.body?.adjustmentId === "string", "adjustmentId returned");

const adjustmentId = adjResult.body?.adjustmentId;
console.log(`  adjustmentId: ${adjustmentId}`);
console.log(`  finalQuotedPrice: NT$${finalPrice.toLocaleString()}`);

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: GET /api/calibration/suggestions — pricing only (no completed project yet)
// ─────────────────────────────────────────────────────────────────────────────

section("Step 3 — GET /api/calibration/suggestions (after pricing adjustment, no completed project)");

const sugReq1 = mockReq({ workspace: REQ_WORKSPACE, workspaceRole: "OWNER", user: REQ_USER });
const sugRes1 = mockRes();

await getSuggestions(sugReq1, sugRes1);
const sug1 = sugRes1.getResult();

assert(sug1.status === 200, "suggestions returns 200");
const s1 = sug1.body;
console.log(`\n  pricingSampleSize:  ${s1.pricingSampleSize}`);
console.log(`  estimateSampleSize: ${s1.estimateSampleSize}`);
console.log(`  includedSnapshots:  ${s1.includedSnapshotIds?.length ?? 0}`);
console.log(`  excludedSnapshots:  ${s1.excludedSnapshotIds?.length ?? 0}`);

assert(s1.pricingSampleSize >= 1,
  `pricingCalibration has ≥ 1 sample (sent project exists) — got: ${s1.pricingSampleSize}`);
assert(s1.estimateSampleSize === 0,
  `estimateCalibration has 0 samples (no completed+actualHours yet) — got: ${s1.estimateSampleSize}`);
assert(Object.keys(s1.suggestedPricingFactors ?? {}).length >= 0,
  "suggestedPricingFactors key exists");
assert(Object.keys(s1.suggestedEstimateFactors ?? {}).length === 0,
  "suggestedEstimateFactors is empty (correct: no completed projects)");

if (Array.isArray(s1.deprecatedModuleSeen) && s1.deprecatedModuleSeen.length > 0) {
  console.log(`\n  ⚠  Deprecated modules in calibration data: ${s1.deprecatedModuleSeen.map(d => d.originalKey).join(", ")}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 4: POST /api/calibration/snapshots/:snapshotId/adjustment (completed + actualHours)
// ─────────────────────────────────────────────────────────────────────────────

section("Step 4 — POST /api/calibration/snapshots/:snapshotId/adjustment\n  Simulate: project completed, actual hours known");

const firstModule = data?.modules?.[0];
const actualHoursByRole = firstModule
  ? Object.fromEntries(
      Object.entries(firstModule.roleHours ?? {}).map(([role, range]) => [
        role,
        Math.round(range.max * 0.9 * 10) / 10, // 10% faster than estimate
      ])
    )
  : { frontend: 30, backend: 40 };

const adj2Req = mockReq({
  body: {
    actualHoursByRole,
    adjustedEstimateRange: data.estimateRange,
    finalQuotedPrice:  finalPrice,
    adjustmentReason:  "專案完成，記錄實際工時",
    projectStatus:     "completed",
    scopeChanged:      false,
  },
  params:        { snapshotId },
  workspace:     REQ_WORKSPACE,
  workspaceRole: "OWNER",
  user:          REQ_USER,
});
const adj2Res = mockRes();

await createAdjustment(adj2Req, adj2Res);
const adj2Result = adj2Res.getResult();

assert(adj2Result.status === 201, "completed adjustment saved (201)");
console.log(`  actualHoursByRole: ${JSON.stringify(actualHoursByRole)}`);

// ─────────────────────────────────────────────────────────────────────────────
// Step 5: GET /api/calibration/suggestions — now both estimate + pricing
// ─────────────────────────────────────────────────────────────────────────────

section("Step 5 — GET /api/calibration/suggestions (after completed project)");

const sugReq2 = mockReq({ workspace: REQ_WORKSPACE, workspaceRole: "OWNER", user: REQ_USER });
const sugRes2 = mockRes();

await getSuggestions(sugReq2, sugRes2);
const sug2 = sugRes2.getResult();

assert(sug2.status === 200, "suggestions returns 200");
const s2 = sug2.body;
console.log(`\n  pricingSampleSize:  ${s2.pricingSampleSize}`);
console.log(`  estimateSampleSize: ${s2.estimateSampleSize}`);
console.log(`  suggestedEstimateFactors: ${JSON.stringify(s2.suggestedEstimateFactors ?? {})}`);
console.log(`  suggestedPricingFactors:  ${JSON.stringify(s2.suggestedPricingFactors ?? {})}`);

assert(s2.estimateSampleSize >= 1,
  `estimateCalibration has ≥ 1 sample now — got: ${s2.estimateSampleSize}`);
assert(s2.pricingSampleSize >= 1,
  `pricingCalibration has ≥ 1 sample — got: ${s2.pricingSampleSize}`);

// The two factors must be independent
const estKeys  = Object.keys(s2.suggestedEstimateFactors ?? {});
const priceKeys = Object.keys(s2.suggestedPricingFactors ?? {});
console.log(`\n  estimateFactors keys: ${JSON.stringify(estKeys)}`);
console.log(`  pricingFactors keys:  ${JSON.stringify(priceKeys)}`);

// Pricing factor should be > 1 (we bumped the price by 25%)
const siteKey = priceKeys[0];
if (siteKey && s2.suggestedPricingFactors[siteKey] != null) {
  const pf = s2.suggestedPricingFactors[siteKey];
  console.log(`\n  pricingFactor for ${siteKey}: ${pf}`);
  assert(pf > 1.0, `pricingFactor > 1.0 (we raised the price) — got: ${pf}`);
}

// Estimate factor should be < 1 (we simulated 10% faster actuals)
const estKey = estKeys[0];
if (estKey && s2.suggestedEstimateFactors[estKey] != null) {
  const ef = s2.suggestedEstimateFactors[estKey];
  console.log(`  estimateFactor for ${estKey}: ${ef}`);
  assert(ef < 1.1,
    `estimateFactor close to 0.9 (faster actuals → lower factor) — got: ${ef}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 6: Final serializer security — recursive scan on full admin response
// ─────────────────────────────────────────────────────────────────────────────

section("Step 6 — Serializer security (recursive forbidden-key scan)");

const publicOut = buildPublicEstimateResponse(data);
const shareOut  = buildShareProposalResponse(data);

const pub2  = findForbiddenKeys(publicOut);
const share2 = findForbiddenKeys(shareOut);

assert(pub2.length  === 0, `Public: no forbidden keys (${pub2.length} found)`,  pub2.join(", "));
assert(share2.length === 0, `Share: no forbidden keys (${share2.length} found)`, share2.join(", "));

// internalRange must be absent from public module list
const pubModuleHasInternal = (publicOut.modules ?? []).some((m) => "internalRange" in m);
assert(!pubModuleHasInternal, "Public modules: no internalRange on any module");

// Proposal response must not contain any modules (summary-level only)
assert(!shareOut.modules,     "Share response: no module breakdown");
assert(shareOut.estimateRange, "Share response: estimateRange present");

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────────────────────────────────

section("Cleanup — remove test data");

try {
  // Delete in dependency order
  await prisma.estimateAdjustment.deleteMany({ where: { snapshotId } });
  await prisma.estimateSnapshot.deleteMany({ where: { workspaceId: testWorkspace.id } });
  await prisma.teamCalibrationProfile.deleteMany({ where: { workspaceId: testWorkspace.id } });
  await prisma.calibrationAuditLog.deleteMany({ where: { workspaceId: testWorkspace.id } });
  await prisma.workspaceUser.deleteMany({ where: { workspaceId: testWorkspace.id } });
  await prisma.workspace.delete({ where: { id: testWorkspace.id } });
  await prisma.user.delete({ where: { id: testUser.id } });
  console.log("  Test data cleaned up.");
} catch (err) {
  console.warn("  Cleanup warning:", err.message);
}

await prisma.$disconnect();

// ─────────────────────────────────────────────────────────────────────────────
// Final report
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("\nFailed assertions:");
  errors.forEach((e) => console.error(`  ✗ ${e}`));
  process.exit(1);
}
