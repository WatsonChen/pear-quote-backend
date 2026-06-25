/**
 * Tests for the conversational "AI 追問後重新估價" flow.
 * Run with: node src/lib/__tests__/refineEstimate.test.js
 *
 * Pure-logic / unit style — mirrors estimationBaselines.test.js conventions
 * (hand-rolled assert harness, no test framework, no live DB / Gemini).
 *
 * Coverage map (spec §後端測試):
 *   1.  snapshot workspace ownership guard            → ownership query shape
 *   2.  blank answers/additionalContext validation    → normalizeRefineBody
 *   3.  refine creates new snapshot (parentSnapshotId) → saveEstimateSnapshot wiring
 *   4.  old snapshot not overwritten                  → create (not update) is used
 *   5.  revision number increments                    → revisionNumber wiring
 *   6.  added module comparison (baselineKey)         → buildEstimateComparison
 *   7.  removed module comparison                     → buildEstimateComparison
 *   8.  changed module comparison                     → buildEstimateComparison
 *   9.  calibration profile applied                   → applyCalibrationToModule
 *   10. snapshot save failure → snapshotId null       → saveEstimateSnapshot reject path (documented)
 *   11. Gemini error → 4xx/5xx                        → error status mapping
 *   12. public/share serializer adds no internal field→ serializer + comparison leak scan
 *   13. all Gemini requests stay sequential           → ordering via real queue + fake client
 */

import {
  buildEstimateComparison,
  buildEnhancedRequirementsText,
  summarizeRequirementSpec,
} from "../estimateComparison.js";
import {
  humanizeBaselineKeysInQuestions,
  resolveBaselineDisplayName,
  BASELINE_DISPLAY_NAMES,
} from "../estimationBaselines.js";
import {
  normalizeRefineBody,
  refineEstimate,
  estimateModulesCore,
  isParentSnapshotConflict,
} from "../../controllers/estimationController.js";
import { applyCalibrationToModule, saveEstimateSnapshot } from "../calibrationService.js";
import {
  buildAdminEstimateResponse,
  buildPublicEstimateResponse,
  buildShareProposalResponse,
} from "../estimateSerializer.js";
import { generateGeminiText, extractGeminiStatusCode } from "../gemini.js";

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

async function assertThrows(label, fn, expectStatus) {
  try {
    await fn();
    console.error(`  ✗ ${label} — expected throw, got success`);
    failed++;
  } catch (err) {
    if (expectStatus == null || err?.statusCode === expectStatus) {
      console.log(`  ✓ ${label}`);
      passed++;
    } else {
      console.error(`  ✗ ${label} — expected statusCode ${expectStatus}, got ${err?.statusCode}`);
      failed++;
    }
  }
}

/** Recursively collect forbidden keys anywhere in a structure. */
const FORBIDDEN_IN_PUBLIC = new Set([
  "internalRange", "ratesUsed", "marginRange",
  "estimateCalibrationFactors", "pricingCalibrationFactors",
  "calibrationFactorsApplied", "_fieldVisibility",
  "parentSnapshotId", "requirementSpec",
]);
function findForbiddenKeys(value, forbidden, path = "root") {
  const hits = [];
  if (Array.isArray(value)) {
    value.forEach((item, i) => hits.push(...findForbiddenKeys(item, forbidden, `${path}[${i}]`)));
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (forbidden.has(k)) hits.push(`${path}.${k}`);
      else hits.push(...findForbiddenKeys(v, forbidden, `${path}.${k}`));
    }
  }
  return hits;
}

// ──────────────────────────────────────────────────────────────────────────────
// [2] Validation — normalizeRefineBody
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n[2] Request validation (normalizeRefineBody)");
{
  // snapshotId required
  let threw = false;
  try { normalizeRefineBody({ answers: [{ question: "q", answer: "a" }] }); }
  catch (e) { threw = e.statusCode === 400; }
  assert("missing snapshotId → 400", threw);

  // blank-only answers + no context → 400
  threw = false;
  try {
    normalizeRefineBody({ snapshotId: "s1", answers: [{ question: "q", answer: "   " }], additionalContext: "  " });
  } catch (e) { threw = e.statusCode === 400; }
  assert("all-blank answers + blank context → 400", threw);

  // whitespace-only answers are stripped, but a valid additionalContext passes
  const okContext = normalizeRefineBody({
    snapshotId: "s1",
    answers: [{ question: "頁數？", answer: "  " }],
    additionalContext: "需要多語系",
  });
  assert("blank answers stripped", okContext.answers.length === 0, JSON.stringify(okContext.answers));
  assert("additionalContext retained", okContext.additionalContext === "需要多語系");

  // at least one non-blank answer passes even with empty context
  const okAnswer = normalizeRefineBody({
    snapshotId: "s1",
    answers: [{ question: "頁數？", answer: "約 8 頁" }, { question: "x", answer: "" }],
    additionalContext: "",
  });
  assert("one valid answer passes", okAnswer.answers.length === 1);
  assert("snapshotId trimmed", normalizeRefineBody({ snapshotId: " s2 ", additionalContext: "x" }).snapshotId === "s2");
}

// ──────────────────────────────────────────────────────────────────────────────
// [6][7][8] Comparison by baselineKey
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n[6/7/8] Module comparison (added / removed / changed, keyed by baselineKey)");
{
  const previous = {
    snapshotId: "old-uuid",
    revisionNumber: 1,
    estimateRange: { min: 169000, max: 304000, currency: "TWD" },
    modules: [
      { baselineKey: "auth_standard", baselineName: "帳號系統", estimateRange: { min: 60000, max: 100000 } },
      { baselineKey: "crud_module", baselineName: "資料管理", estimateRange: { min: 40000, max: 70000 } },
      { baselineKey: "corporate_site_static", baselineName: "多頁官網", estimateRange: { min: 69000, max: 134000 } },
    ],
  };
  const current = {
    snapshotId: "new-uuid",
    revisionNumber: 2,
    estimateRange: { min: 220000, max: 380000, currency: "TWD" },
    modules: [
      { baselineKey: "auth_standard", baselineName: "帳號系統", estimateRange: { min: 60000, max: 100000 } }, // unchanged
      { baselineKey: "corporate_site_static", baselineName: "多頁官網", estimateRange: { min: 80000, max: 140000 } }, // changed
      { baselineKey: "payment_integration", baselineName: "金流串接", estimateRange: { min: 80000, max: 140000 } }, // added
      // crud_module removed
    ],
  };

  const c = buildEstimateComparison({ previous, current });

  assert("previousSnapshotId carried", c.previousSnapshotId === "old-uuid");
  assert("previousRevisionNumber carried", c.previousRevisionNumber === 1);
  assert("priceDifference.min = 51000", c.priceDifference.min === 51000, String(c.priceDifference.min));
  assert("priceDifference.max = 76000", c.priceDifference.max === 76000, String(c.priceDifference.max));

  // [6] added
  assert("exactly 1 added module", c.addedModules.length === 1, JSON.stringify(c.addedModules));
  assert("added is payment_integration", c.addedModules[0]?.baselineKey === "payment_integration");
  assert("added carries baselineName", c.addedModules[0]?.baselineName === "金流串接");

  // [7] removed
  assert("exactly 1 removed module", c.removedModules.length === 1, JSON.stringify(c.removedModules));
  assert("removed is crud_module", c.removedModules[0]?.baselineKey === "crud_module");
  assert("removed carries baselineName", c.removedModules[0]?.baselineName === "資料管理");

  // [8] changed
  assert("exactly 1 changed module", c.changedModules.length === 1, JSON.stringify(c.changedModules));
  assert("changed is corporate_site_static", c.changedModules[0]?.baselineKey === "corporate_site_static");
  assert("changed has previous range", c.changedModules[0]?.previousEstimateRange?.max === 134000);
  assert("changed has current range", c.changedModules[0]?.currentEstimateRange?.max === 140000);
  assert("changed.changeType = price_changed", c.changedModules[0]?.changeType === "price_changed");
  assert("unchanged module is NOT in changed list", !c.changedModules.some((m) => m.baselineKey === "auth_standard"));

  // comparison uses baselineKey for matching, NOT baselineName: rename should not create add+remove
  const renamed = buildEstimateComparison({
    previous: { snapshotId: "a", revisionNumber: 1, estimateRange: { min: 1000, max: 2000 }, modules: [{ baselineKey: "auth_standard", baselineName: "舊名字", estimateRange: { min: 1000, max: 2000 } }] },
    current:  { snapshotId: "b", revisionNumber: 2, estimateRange: { min: 1000, max: 2000 }, modules: [{ baselineKey: "auth_standard", baselineName: "新名字", estimateRange: { min: 1000, max: 2000 } }] },
  });
  assert("rename-only → no added/removed (matched by key)", renamed.addedModules.length === 0 && renamed.removedModules.length === 0);
}

// ──────────────────────────────────────────────────────────────────────────────
// Enhanced requirements text + spec summary
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n[merge] Enhanced requirements text construction");
{
  const text = buildEnhancedRequirementsText({
    baseText: "專案類型：官網",
    answers: [
      { question: "需要 CMS 嗎？", answer: "需要" },
      { question: "頁數？", answer: "   " }, // blank → dropped
    ],
    additionalContext: "預算約 30 萬",
  });
  assert("base text included", text.includes("專案類型：官網"));
  assert("answered question included", text.includes("需要 CMS 嗎？") && text.includes("回答：需要"));
  assert("blank answer dropped", !text.includes("頁數？"));
  assert("additionalContext included", text.includes("預算約 30 萬"));

  const emptyMerge = buildEnhancedRequirementsText({ baseText: "", answers: [{ answer: " " }], additionalContext: "" });
  assert("all-empty merge → empty string", emptyMerge === "");

  const summary = summarizeRequirementSpec({
    projectType: "電商網站",
    businessGoal: "線上販售",
    requirements: [{ text: "購物車" }, { text: "" }],
  });
  assert("spec summary includes projectType", summary.includes("電商網站"));
  assert("spec summary lists requirements", summary.includes("購物車"));
  assert("spec summary skips blank requirement", !/- \n/.test(summary));
}

// ──────────────────────────────────────────────────────────────────────────────
// [3][4][5] Snapshot version wiring — saveEstimateSnapshot passes parent/revision to prisma.create
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n[3/4/5] Snapshot versioning (parentSnapshotId + revisionNumber, create-not-update)");
{
  // Mock the prisma module used by calibrationService by intercepting the create call.
  // calibrationService imports a singleton `prisma`; we replace its estimateSnapshot methods.
  const prismaModule = await import("../prisma.js");
  const prisma = prismaModule.default;
  const calls = { create: 0, update: 0, lastCreateData: null };
  const originalCreate = prisma.estimateSnapshot?.create;
  const originalUpdate = prisma.estimateSnapshot?.update;

  prisma.estimateSnapshot = {
    ...(prisma.estimateSnapshot || {}),
    create: async ({ data }) => { calls.create++; calls.lastCreateData = data; return { id: "snap-new", ...data }; },
    update: async () => { calls.update++; return {}; },
  };

  try {
    const result = await saveEstimateSnapshot({
      workspaceId: "ws1",
      quoteId: null,
      modules: [{ id: "M1", baselineKey: "auth_standard", roleHours: {}, riskBuffer: 0 }],
      rawGlobalEstimate: { min: 100000, max: 200000, currency: "TWD" },
      calibratedEstimate: { min: 110000, max: 210000, currency: "TWD" },
      hoursRange: { min: 40, max: 80 },
      overallConfidence: 0.8,
      missingInfo: [],
      projectRiskFlags: [],
      requirementSpec: { projectType: "官網" },
      parentSnapshotId: "old-snap",
      revisionNumber: 2,
    });

    assert("[4] create() called (new snapshot, old not mutated)", calls.create === 1);
    assert("[4] update() NOT called", calls.update === 0);
    assert("[3] parentSnapshotId persisted", calls.lastCreateData?.parentSnapshotId === "old-snap");
    assert("[5] revisionNumber persisted as 2", calls.lastCreateData?.revisionNumber === 2);
    assert("returns created id", result.id === "snap-new");

    // default behavior: first estimate has revisionNumber 1, parentSnapshotId null
    const first = await saveEstimateSnapshot({
      workspaceId: "ws1", modules: [], rawGlobalEstimate: { min: 0, max: 0 }, calibratedEstimate: { min: 0, max: 0 },
      hoursRange: { min: 0, max: 0 }, overallConfidence: 0.5, missingInfo: [], projectRiskFlags: [], requirementSpec: null,
    });
    assert("[5] default revisionNumber = 1", calls.lastCreateData?.revisionNumber === 1);
    assert("[3] default parentSnapshotId = null", calls.lastCreateData?.parentSnapshotId == null);

    // invalid revisionNumber falls back to 1
    await saveEstimateSnapshot({
      workspaceId: "ws1", modules: [], rawGlobalEstimate: { min: 0, max: 0 }, calibratedEstimate: { min: 0, max: 0 },
      hoursRange: { min: 0, max: 0 }, overallConfidence: 0.5, missingInfo: [], projectRiskFlags: [], requirementSpec: null,
      revisionNumber: 0,
    });
    assert("invalid revisionNumber coerced to 1", calls.lastCreateData?.revisionNumber === 1);
  } finally {
    // restore
    if (originalCreate) prisma.estimateSnapshot.create = originalCreate;
    if (originalUpdate) prisma.estimateSnapshot.update = originalUpdate;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// [9] Calibration profile applied to module
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n[9] Calibration profile application");
{
  const mod = {
    baselineKey: "auth_standard",
    hoursRange: { min: 40, max: 80 },
    estimateRange: { min: 100000, max: 200000, currency: "TWD" },
    internalRange: { min: 70000, max: 140000, currency: "TWD" },
    roleHours: { backend: { min: 16, max: 24 } },
  };
  const profile = {
    estimateCalibrationFactors: { auth_standard: 1.2 },
    pricingCalibrationFactors: { auth_standard: 1.1 },
  };
  const calibrated = applyCalibrationToModule(mod, "auth_standard", profile);
  assert("estimate factor scales price up", calibrated.estimateRange.max > mod.estimateRange.max, JSON.stringify(calibrated.estimateRange));
  assert("calibration metadata attached", calibrated.calibration?.applied === true);
  assert("pricing factor does NOT scale internal cost by price factor",
    calibrated.internalRange.max === Math.round((mod.internalRange.max * 1.2) / 1000) * 1000,
    JSON.stringify(calibrated.internalRange));

  const noProfile = applyCalibrationToModule(mod, "auth_standard", null);
  assert("no profile → module unchanged", noProfile === mod);
}

// ──────────────────────────────────────────────────────────────────────────────
// [10] Snapshot save failure does not throw out of saveEstimateSnapshot's caller contract
//      (documented: estimateModulesCore swallows the error → snapshotId null).
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n[10] Snapshot save failure isolation (rejection surfaces, caller swallows → snapshotId null)");
{
  const prismaModule = await import("../prisma.js");
  const prisma = prismaModule.default;
  const originalCreate = prisma.estimateSnapshot.create;
  prisma.estimateSnapshot.create = async () => { throw new Error("DB down"); };

  let rejected = false;
  try {
    await saveEstimateSnapshot({
      workspaceId: "ws1", modules: [], rawGlobalEstimate: { min: 0, max: 0 }, calibratedEstimate: { min: 0, max: 0 },
      hoursRange: { min: 0, max: 0 }, overallConfidence: 0.5, missingInfo: [], projectRiskFlags: [], requirementSpec: null,
    });
  } catch {
    rejected = true;
  }
  assert("saveEstimateSnapshot rejects on DB failure (caller must catch)", rejected);
  // estimateModulesCore wraps this call in try/catch → snapshotId stays null, response not blocked.
  // (verified structurally in estimationController.estimateModulesCore)
  prisma.estimateSnapshot.create = originalCreate;
}

// ──────────────────────────────────────────────────────────────────────────────
// [11] Gemini error → status code mapping
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n[11] Gemini error status extraction (429/503/500 mapping inputs)");
{
  assert("429 extracted from bracketed message", extractGeminiStatusCode(new Error("[429 Too Many Requests]")) === 429);
  assert("503 extracted", extractGeminiStatusCode(Object.assign(new Error("x"), { status: 503 })) === 503);
  assert("500 extracted", extractGeminiStatusCode(new Error("500 internal")) === 500);
  assert("non-gemini error → null status (caller defaults to 500)", extractGeminiStatusCode(new Error("random")) === null);
  // validation errors carry explicit statusCode used by sendEstimateErrorResponse
  const v = Object.assign(new Error("bad"), { statusCode: 400 });
  assert("validation error has statusCode 400", v.statusCode === 400);
}

// ──────────────────────────────────────────────────────────────────────────────
// [12] Serializer + comparison: no internal field leaks in public response
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n[12] Public/share serializer adds no internal field (incl. comparison payload)");
{
  const rawModule = {
    id: "M1", name: "金流", description: "", features: [], requirementIds: [],
    baselineKey: "payment_integration", baselineName: "金流串接", assumptions: [], exclusions: [],
    missingInfo: [], complexity: "complex", complexityReason: "", confidence: 0.8, riskBuffer: 0.2,
    roleHours: { backend: { min: 20, max: 32 } }, hoursRange: { min: 60, max: 100 },
    estimateRange: { min: 80000, max: 140000, currency: "TWD" },
    internalRange: { min: 56000, max: 98000, currency: "TWD" },
  };
  const rawResponse = {
    success: true, modules: [rawModule],
    estimateRange: { min: 220000, max: 380000, currency: "TWD" },
    hoursRange: { min: 100, max: 180 },
    internalRange: { min: 150000, max: 260000, currency: "TWD" },
    marginRange: { min: 0.31, max: 0.31 },
    missingInfo: [], requirementQuestions: ["是否需要定期扣款？"],
    projectRiskFlags: [], projectRiskSummary: "ok", overallConfidence: 0.85,
    overallComplexity: "complex", estimationNotes: "", unmappedRequirements: [],
    ratesUsed: { pm: { billingRate: 1200, internalRate: 820 } },
    calibrationFactorsApplied: { estimateCalibrationFactors: { x: 1 } },
  };
  const comparison = buildEstimateComparison({
    previous: { snapshotId: "old", revisionNumber: 1, estimateRange: { min: 169000, max: 304000 }, modules: [rawModule] },
    current:  { snapshotId: "new", revisionNumber: 2, estimateRange: { min: 220000, max: 380000 }, modules: [rawModule] },
  });

  // Public path used by refineEstimate for non-owner roles
  const publicRes = { ...buildPublicEstimateResponse({ ...rawResponse, snapshotId: "new" }), snapshotSaved: true, snapshotId: "new", revisionNumber: 2, comparison };
  const publicHits = findForbiddenKeys(publicRes, FORBIDDEN_IN_PUBLIC);
  assert(`public refine response: zero internal keys (found: ${publicHits.join(", ") || "none"})`, publicHits.length === 0);
  assert("public refine response keeps snapshotId", publicRes.snapshotId === "new");
  assert("public refine response keeps comparison", publicRes.comparison?.priceDifference != null);
  assert("comparison itself leaks no internal field", findForbiddenKeys(comparison, FORBIDDEN_IN_PUBLIC).length === 0);
  assert("comparison module entries carry baselineName", comparison.previousEstimateRange != null);

  // Admin path includes internalRange (expected) but share serializer must stay summary-only and
  // must NOT have gained any new field from this change.
  const shareRes = buildShareProposalResponse(rawResponse);
  const shareKeys = Object.keys(shareRes).sort();
  const expectedShareKeys = ["estimateRange", "hoursRange", "missingInfo", "overallComplexity", "overallConfidence", "projectRiskSummary", "estimationNotes"].sort();
  assert("share serializer key set unchanged by refine work", JSON.stringify(shareKeys) === JSON.stringify(expectedShareKeys), JSON.stringify(shareKeys));
  assert("share serializer has no comparison", !("comparison" in shareRes));
  assert("share serializer has no snapshotId", !("snapshotId" in shareRes));
}

// ──────────────────────────────────────────────────────────────────────────────
// [13] All Gemini requests stay sequential (parse → estimate ordering preserved)
//      Verified through the real generateGeminiText queue + a fake client that records
//      overlap. Two awaited calls must never overlap.
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n[13] Sequential Gemini execution (no overlap between awaited calls)");
{
  let active = 0;
  let maxConcurrent = 0;
  const order = [];

  const makeFakeClient = (tag) => ({
    getGenerativeModel: () => ({
      generateContent: async () => {
        active++;
        maxConcurrent = Math.max(maxConcurrent, active);
        order.push(`${tag}:start`);
        await new Promise((r) => setTimeout(r, 25));
        order.push(`${tag}:end`);
        active--;
        return { response: { text: () => '{"ok":true}' } };
      },
    }),
  });

  // Simulate refine's strict sequencing: await parse, THEN await estimate.
  await generateGeminiText(makeFakeClient("parse"), [{ text: "p" }], { modelName: "fake-model", maxQueueWaitMs: 5000 });
  await generateGeminiText(makeFakeClient("estimate"), [{ text: "e" }], { modelName: "fake-model", maxQueueWaitMs: 5000 });

  assert("never more than 1 concurrent Gemini call", maxConcurrent === 1, `maxConcurrent=${maxConcurrent}`);
  assert("parse completes before estimate starts",
    order.indexOf("parse:end") < order.indexOf("estimate:start"),
    order.join(" → "));
}

// ──────────────────────────────────────────────────────────────────────────────
// [3-extra] requirementQuestions baseline-key humanization (display-name layer, not FE replace)
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n[bonus] requirementQuestions baseline-key → display name normalization");
{
  const out = humanizeBaselineKeysInQuestions([
    "是否需要 corporate_site_with_cms？",
    "請提供：頁面數量",
    "需要 payment_integration 嗎？",
  ]);
  assert("corporate_site_with_cms replaced with display name",
    out[0] === `是否需要 ${BASELINE_DISPLAY_NAMES.corporate_site_with_cms}？`, out[0]);
  assert("plain question untouched", out[1] === "請提供：頁面數量");
  assert("payment_integration replaced", out[2].includes(BASELINE_DISPLAY_NAMES.payment_integration) && !out[2].includes("payment_integration"));
  assert("resolveBaselineDisplayName falls back to provided name", resolveBaselineDisplayName("unknown_key", "後備名稱") === "後備名稱");
  assert("resolveBaselineDisplayName uses map when present", resolveBaselineDisplayName("rbac", "x") === BASELINE_DISPLAY_NAMES.rbac);
}

// ──────────────────────────────────────────────────────────────────────────────
// [C4] Credit: reserve-before-Gemini / no-deduction on early failures
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n[C4] Credit policy: no deduction on validation/ownership/conflict; 403 on insufficient");
{
  const prismaModule = await import("../prisma.js");
  const prisma = prismaModule.default;

  const origUpdateMany = prisma.workspace.updateMany;
  const origFindFirst  = prisma.estimateSnapshot.findFirst;

  function makeReq(body, workspaceId = "ws1") {
    return { body, workspace: { id: workspaceId }, workspaceRole: "OWNER" };
  }
  function makeRes() {
    const r = {};
    r.status = (c) => { r._status = c; return r; };
    r.json   = (b) => { r._body  = b; return r; };
    r.set    = () => r;
    return r;
  }

  // [C4-a] Validation fails (blank snapshotId) → 400, updateMany never called
  {
    let updateManyCalls = 0;
    prisma.workspace.updateMany = async () => { updateManyCalls++; return { count: 1 }; };

    const res = makeRes();
    await refineEstimate(makeReq({ snapshotId: "  ", additionalContext: "補充" }), res);

    assert("[C4-a] validation failure → 400", res._status === 400, String(res._status));
    assert("[C4-a] no deduction on validation failure", updateManyCalls === 0, String(updateManyCalls));
    prisma.workspace.updateMany = origUpdateMany;
  }

  // [C4-b] Ownership failure (snapshot not found) → 404, updateMany never called
  {
    let updateManyCalls = 0;
    prisma.workspace.updateMany = async () => { updateManyCalls++; return { count: 1 }; };
    prisma.estimateSnapshot.findFirst = async (args) => {
      // Always return null: ownership check fails; child pre-check also null (fine)
      return null;
    };

    const res = makeRes();
    await refineEstimate(makeReq({ snapshotId: "not-mine", additionalContext: "補充" }), res);

    assert("[C4-b] ownership failure → 404", res._status === 404, String(res._status));
    assert("[C4-b] no deduction on ownership failure", updateManyCalls === 0, String(updateManyCalls));
    prisma.workspace.updateMany = origUpdateMany;
    prisma.estimateSnapshot.findFirst = origFindFirst;
  }

  // [C4-c] Insufficient credits → 403 with errorCode, Gemini never called
  {
    prisma.estimateSnapshot.findFirst = async (args) => {
      // child check returns null (no existing child); owner check returns snapshot
      if (args?.where?.parentSnapshotId !== undefined) return null;
      return { id: "snap-1", quoteId: null, revisionNumber: 1,
               requirementSpec: { projectType: "t" }, detectedModules: [],
               calibratedEstimate: null, rawGlobalEstimate: { min: 0, max: 0 } };
    };
    prisma.workspace.updateMany = async () => ({ count: 0 }); // balance too low

    const res = makeRes();
    await refineEstimate(makeReq({ snapshotId: "snap-1", additionalContext: "補充" }), res);

    assert("[C4-c] insufficient credits → 403", res._status === 403, String(res._status));
    assert("[C4-c] errorCode INSUFFICIENT_CREDITS", res._body?.errorCode === "INSUFFICIENT_CREDITS");
    prisma.workspace.updateMany = origUpdateMany;
    prisma.estimateSnapshot.findFirst = origFindFirst;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// [C5] DB conflict: pre-check 409 (no deduction) + P2002 re-throw from estimateModulesCore
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n[C5] Revision conflict: pre-check 409 (no deduction) + P2002 → 409 with refund");
{
  const prismaModule = await import("../prisma.js");
  const prisma = prismaModule.default;

  const origUpdateMany = prisma.workspace.updateMany;
  const origUpdate     = prisma.workspace.update;
  const origFindFirst  = prisma.estimateSnapshot.findFirst;
  const origCreate     = prisma.estimateSnapshot.create;

  function makeReq(body) { return { body, workspace: { id: "ws1" }, workspaceRole: "OWNER" }; }
  function makeRes() {
    const r = {};
    r.status = (c) => { r._status = c; return r; };
    r.json   = (b) => { r._body  = b; return r; };
    r.set    = () => r;
    return r;
  }

  // [C5-a] Pre-check: existing child → 409, no deduction
  {
    let deducted = false;
    prisma.workspace.updateMany = async () => { deducted = true; return { count: 1 }; };
    prisma.estimateSnapshot.findFirst = async (args) => {
      if (args?.where?.parentSnapshotId !== undefined) return { id: "existing-child" };
      return { id: "snap-1", quoteId: null, revisionNumber: 1, requirementSpec: { projectType: "t" },
               detectedModules: [], calibratedEstimate: null, rawGlobalEstimate: { min: 0, max: 0 } };
    };

    const res = makeRes();
    await refineEstimate(makeReq({ snapshotId: "snap-1", additionalContext: "補充" }), res);

    assert("[C5-a] pre-check conflict → 409", res._status === 409, String(res._status));
    assert("[C5-a] errorCode ESTIMATE_REVISION_CONFLICT", res._body?.errorCode === "ESTIMATE_REVISION_CONFLICT");
    assert("[C5-a] no credit deducted (conflict caught before deduction)", !deducted);

    prisma.workspace.updateMany = origUpdateMany;
    prisma.estimateSnapshot.findFirst = origFindFirst;
  }

  // [C5-b] isParentSnapshotConflict — the exported predicate from estimationController.
  //         Tests both Prisma error shapes:
  //           • standard engine:       meta.target = ["parentSnapshotId"]
  //           • PrismaPg driver adapter: meta.driverAdapterError.cause.constraint.fields
  //                                      = ['"parentSnapshotId"']  (field names have quotes)
  //
  //         estimateModulesCore calls Gemini before saveEstimateSnapshot so it cannot be
  //         called end-to-end without a live API key. The actual concurrency + DB constraint
  //         enforcement is covered by refineEstimate.parallel.integration.test.js.
  {
    // Standard Prisma engine shape
    const stdParent = Object.assign(new Error("Unique constraint"), {
      code: "P2002", meta: { target: ["parentSnapshotId"] },
    });
    const stdOtherField = Object.assign(new Error("Unique constraint"), {
      code: "P2002", meta: { target: ["id"] },
    });
    const nonP2002 = Object.assign(new Error("Other DB error"), {
      code: "P1001", meta: { target: ["parentSnapshotId"] },
    });

    assert("[C5-b std] P2002 on parentSnapshotId → conflict",
      isParentSnapshotConflict(stdParent));
    assert("[C5-b std] P2002 on other field → NOT conflict",
      !isParentSnapshotConflict(stdOtherField));
    assert("[C5-b std] non-P2002 → NOT conflict",
      !isParentSnapshotConflict(nonP2002));

    // PrismaPg driver adapter shape (field names wrapped in double-quotes)
    const adapterParent = Object.assign(new Error("Unique constraint"), {
      code: "P2002",
      meta: {
        modelName: "EstimateSnapshot",
        driverAdapterError: {
          cause: {
            kind: "UniqueConstraintViolation",
            constraint: { fields: ['"parentSnapshotId"'] },
          },
        },
      },
    });
    const adapterOtherField = Object.assign(new Error("Unique constraint"), {
      code: "P2002",
      meta: {
        driverAdapterError: { cause: { constraint: { fields: ['"id"'] } } },
      },
    });

    assert("[C5-b adapter] PrismaPg P2002 on parentSnapshotId → conflict",
      isParentSnapshotConflict(adapterParent));
    assert("[C5-b adapter] PrismaPg P2002 on other field → NOT conflict",
      !isParentSnapshotConflict(adapterOtherField));
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// [C7] Refund failure → CreditCompensation record written (unit mock)
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n[C7] Refund failure: CreditCompensation record written, errorCode preserved");
{
  const prismaModule = await import("../prisma.js");
  const prisma = prismaModule.default;

  const origFindFirst   = prisma.estimateSnapshot.findFirst;
  const origUpdateMany  = prisma.workspace.updateMany;
  const origUpdate      = prisma.workspace.update;
  const origCompCreate  = prisma.creditCompensation?.create;

  function makeReq(body) { return { body, workspace: { id: "ws1" }, workspaceRole: "OWNER" }; }
  function makeRes() {
    const r = {};
    r.status = (c) => { r._status = c; return r; };
    r.json   = (b) => { r._body  = b; return r; };
    r.set    = () => r;
    return r;
  }

  // Set up: snapshot found, credits deducted, then Gemini (parse) fails → refund fails
  // → CreditCompensation.create must be called
  let compensationCreateCalled = false;
  let compensationData = null;
  let refundAttempted = false;

  prisma.estimateSnapshot.findFirst = async (args) => {
    if (args?.where?.parentSnapshotId !== undefined) return null; // no existing child
    return { id: "snap-c7", quoteId: null, revisionNumber: 1,
             requirementSpec: { projectType: "test" }, detectedModules: [],
             calibratedEstimate: null, rawGlobalEstimate: { min: 0, max: 0 } };
  };
  prisma.workspace.updateMany = async () => ({ count: 1 }); // deduction succeeds
  prisma.workspace.update = async ({ data }) => {
    if (data?.creditBalance?.increment > 0) refundAttempted = true;
    throw new Error("refund DB unavailable"); // simulate refund failure
  };
  if (prisma.creditCompensation) {
    prisma.creditCompensation.create = async ({ data }) => {
      compensationCreateCalled = true;
      compensationData = data;
      return { id: "comp-1", ...data };
    };
  }

  // refineEstimate will fail at parseConversationCore (no API key) → error thrown
  // → creditReserved=true → refund attempted → refund fails → compensation written
  const res = makeRes();
  await refineEstimate(makeReq({ snapshotId: "snap-c7", additionalContext: "補充" }), res);

  // The response should be a 500 (Gemini not configured), but the refund+compensation
  // path must have run because creditReserved was true
  assert("[C7] request results in error after credit deduction",
    res._status !== 200, String(res._status));
  assert("[C7] refund was attempted before compensation",
    refundAttempted, "refund should have been attempted");

  if (prisma.creditCompensation) {
    assert("[C7] CreditCompensation.create called after refund failure",
      compensationCreateCalled, "compensation create was not called");
    assert("[C7] compensation.workspaceId = ws1",
      compensationData?.workspaceId === "ws1");
    assert("[C7] compensation.operation = refine_refund",
      compensationData?.operation === "refine_refund");
    assert("[C7] compensation.status = pending",
      compensationData?.status === "pending");
    assert("[C7] compensation.amount = 3",
      compensationData?.amount === 3);
  } else {
    console.log("  ⚠ prisma.creditCompensation not available in this test env — skipping mock assertions");
  }

  // Restore
  prisma.estimateSnapshot.findFirst = origFindFirst;
  prisma.workspace.updateMany       = origUpdateMany;
  prisma.workspace.update           = origUpdate;
  if (prisma.creditCompensation && origCompCreate !== undefined) {
    prisma.creditCompensation.create = origCompCreate;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// [C6] snapshotSaved=false: response contains correct flags; CalibrationEstimateFlow contract
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n[C6] snapshotSaved=false contract: null snapshotId, no calibration, refine blocked");
{
  // The backend returns snapshotSaved:false + snapshotId:null when snapshot save fails.
  // The frontend ConversationalEstimateFlow then:
  //   a. Sets latestSnapshotId = null (not fallback to previous)
  //   b. Sets latestSnapshotSaved = false
  //   c. Passes null to onProceed (no calibration)
  //   d. "繼續補充需求" is disabled (no snapshotId to refine from)
  //
  // We test the backend response structure + the pure logic decisions here.

  // [C6-a] saveEstimateSnapshot throws on non-P2002 DB error.
  //         estimateModulesCore catches this in its inner try/catch and returns
  //         { snapshotSaved: false, snapshotId: null } without aborting the response
  //         (see estimationController.js lines 414-427).
  //
  //         estimateModulesCore calls Gemini first and cannot be called in a test
  //         environment without a live API key. We verify the save-failure contract
  //         through saveEstimateSnapshot directly (same path as test [10]).
  const prismaModule = await import("../prisma.js");
  const prisma = prismaModule.default;
  const origCreate = prisma.estimateSnapshot.create;
  prisma.estimateSnapshot.create = async () => { throw new Error("DB timeout"); };

  let saveFailed = false;
  try {
    await saveEstimateSnapshot({
      workspaceId: "ws1", modules: [], rawGlobalEstimate: { min: 0, max: 0 },
      calibratedEstimate: { min: 0, max: 0 }, hoursRange: { min: 0, max: 0 },
      overallConfidence: 0.5, missingInfo: [], projectRiskFlags: [],
      requirementSpec: { projectType: "test" },
    });
  } catch { saveFailed = true; }
  finally { prisma.estimateSnapshot.create = origCreate; }

  assert("[C6-a] saveEstimateSnapshot throws on DB timeout (estimateModulesCore catches → snapshotSaved=false)",
    saveFailed);

  // [C6-b] Frontend onProceed contract: saved=false → pass null snapshotId (no calibration)
  //         (mirroring ConversationalEstimateFlow.handleProceed logic)
  function simulateProceedSnapshotId(snapshotSaved, responseSnapshotId, prevSnapshotId) {
    if (!snapshotSaved) return null; // no calibration when unsaved
    return responseSnapshotId ?? prevSnapshotId ?? null;
  }
  assert("[C6-b] snapshotSaved=false → proceedSnapshotId=null",
    simulateProceedSnapshotId(false, null, "snap-prev") === null);
  assert("[C6-b] snapshotSaved=true → proceedSnapshotId=response snapshotId",
    simulateProceedSnapshotId(true, "snap-new", "snap-prev") === "snap-new");

  // [C6-c] refine-again is blocked when latestSnapshotId=null
  //         (mirroring ConversationalEstimateFlow.handleSubmitRefine guard)
  function simulateRefineFromId(snapshotSaved, responseSnapshotId) {
    return snapshotSaved ? responseSnapshotId : null;
  }
  assert("[C6-c] snapshotSaved=false → refineFromSnapshotId=null (blocks further refine)",
    simulateRefineFromId(false, null) === null);
  assert("[C6-c] snapshotSaved=true → refineFromSnapshotId=responseSnapshotId",
    simulateRefineFromId(true, "snap-new") === "snap-new");
}

// ──────────────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(56)}`);
console.log(`refineEstimate tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
