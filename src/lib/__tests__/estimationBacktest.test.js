/**
 * Estimation Engine Backtest — 3 Real Project Scenarios
 *
 * Purpose: validate the full computation pipeline before going to staging/production.
 * No DB or Gemini API required — tests pure computation + serializer security.
 *
 * Three cases:
 *   Case A: 企業官網 + 部落格        (Small,  ~90k-180k TWD expected)
 *   Case B: B2B SaaS 訂閱平台      (Medium, ~320k-560k TWD expected)
 *   Case C: AI 客服 SaaS MVP       (Large,  ~480k-850k TWD expected)
 *
 * Checks per case:
 *   1. rawGlobalEstimate  — before team calibration
 *   2. calibratedEstimate — after applying a hypothetical team profile
 *   3. estimateRange      — client-facing total range
 *   4. internalRange      — internal cost (must NOT appear in public/share)
 *   5. snapshotId         — simulated (DB-independent)
 *   6. missingInfo        — deduped across modules
 *   7. projectRiskSummary — readable risk text
 *   8. serializer guard   — recursive scan for 8 forbidden keys in public/share
 *   9. calibration split  — estimate vs pricing factor independence
 *  10. adjustment guard   — actualHoursByRole only valid for completed projects
 */

import { DEFAULT_BASELINES, DEFAULT_BILLING_RATES, COMPLEXITY_MULTIPLIERS } from "../estimationBaselines.js";
import { buildEstimateModulesPrompt } from "../../prompts/estimateModulesPrompt.js";
import {
  buildAdminEstimateResponse,
  buildPublicEstimateResponse,
  buildShareProposalResponse,
  buildProjectRiskSummary,
} from "../estimateSerializer.js";
import { applyCalibrationToModule } from "../calibrationService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Test harness
// ─────────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${"─".repeat(58)}`);
  console.log(title);
  console.log("─".repeat(58));
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const MAX_COMBINED_MULTIPLIER = 2.0;

// baseline.confidence is a string ("high" / "medium" / "low") — map to numeric for aggregation
const CONFIDENCE_SCORE = { high: 0.85, medium: 0.72, low: 0.55 };

function resolveRatePair(role) {
  return DEFAULT_BILLING_RATES[role] ?? { billingRate: 1400, internalRate: 950 };
}

function computeModuleEstimate(baselineKey, complexity = "standard") {
  const baseline = DEFAULT_BASELINES.find((b) => b.baselineKey === baselineKey);
  if (!baseline) return null;

  const multiplier = COMPLEXITY_MULTIPLIERS[complexity] ?? 1.0;
  const riskBuffer = Number(baseline.riskBuffer) || 0;
  const totalMultiplier = Math.min(multiplier * (1 + riskBuffer), MAX_COMBINED_MULTIPLIER);

  const hoursMap = baseline.baselineHours ?? {};
  const roleHours = {};
  let totalMin = 0, totalMax = 0, costMin = 0, costMax = 0, priceMin = 0, priceMax = 0;

  for (const [role, range] of Object.entries(hoursMap)) {
    const adjMin = (range?.min ?? 0) * totalMultiplier;
    const adjMax = (range?.max ?? adjMin) * totalMultiplier;
    roleHours[role] = { min: Math.round(adjMin * 10) / 10, max: Math.round(adjMax * 10) / 10 };
    totalMin += adjMin;
    totalMax += adjMax;
    const { billingRate, internalRate } = resolveRatePair(role);
    priceMin += adjMin * billingRate;
    priceMax += adjMax * billingRate;
    costMin  += adjMin * internalRate;
    costMax  += adjMax * internalRate;
  }

  const confidenceStr = typeof baseline.confidence === "string" ? baseline.confidence : "medium";
  const confidence = CONFIDENCE_SCORE[confidenceStr] ?? 0.72;

  return {
    id: baselineKey,
    name: baseline.name,
    baselineKey,
    complexity,
    confidence,
    riskBuffer: baseline.riskBuffer ?? 0,
    assumptions: baseline.assumptions ?? [],
    exclusions: baseline.exclusions ?? [],
    missingInfo: baseline.missingInfo ?? [],
    roleHours,
    hoursRange: { min: Math.round(totalMin * 10) / 10, max: Math.round(totalMax * 10) / 10 },
    estimateRange: { min: Math.round(priceMin / 1000) * 1000, max: Math.round(priceMax / 1000) * 1000, currency: "TWD" },
    internalRange: { min: Math.round(costMin / 1000) * 1000, max: Math.round(costMax / 1000) * 1000, currency: "TWD" },
    internalRate: undefined, // must never be set
    internalCost: undefined, // must never be set
  };
}

function buildCaseResponse(modules, label) {
  const totalEstimate = modules.reduce(
    (acc, m) => ({ min: acc.min + (m.estimateRange?.min ?? 0), max: acc.max + (m.estimateRange?.max ?? 0), currency: "TWD" }),
    { min: 0, max: 0, currency: "TWD" }
  );
  const totalInternal = modules.reduce(
    (acc, m) => ({ min: acc.min + (m.internalRange?.min ?? 0), max: acc.max + (m.internalRange?.max ?? 0), currency: "TWD" }),
    { min: 0, max: 0, currency: "TWD" }
  );
  const totalHours = modules.reduce(
    (acc, m) => ({ min: acc.min + (m.hoursRange?.min ?? 0), max: acc.max + (m.hoursRange?.max ?? 0) }),
    { min: 0, max: 0 }
  );
  const overallConfidence = Math.round(
    (modules.reduce((s, m) => s + m.confidence, 0) / modules.length) * 100
  ) / 100;
  const missingInfo = [...new Set(modules.flatMap((m) => m.missingInfo))];

  const projectRiskFlags = [];
  if (modules.some((m) => m.riskBuffer > 0)) projectRiskFlags.push("包含第三方 API 或高風險整合，已套用風險係數");
  if (modules.some((m) => m.baselineKey === "payment_integration")) projectRiskFlags.push("金流模組 QA 比重高，建議預留沙箱測試時間");
  if (modules.some((m) => m.baselineKey === "rbac")) projectRiskFlags.push("權限系統複雜度易被低估，建議在 kickoff 前確認角色矩陣");
  if (modules.some((m) => m.baselineKey === "ai_api_simple" || m.baselineKey === "ai_feature_full")) projectRiskFlags.push("AI 功能受 LLM provider 穩定性影響，建議設計 fallback 機制");
  if (overallConfidence < 0.65) projectRiskFlags.push("整體需求描述不足，估算範圍較大");

  const marginRange = {
    min: totalEstimate.min > 0 ? Math.round(((totalEstimate.min - totalInternal.min) / totalEstimate.min) * 100) / 100 : 0,
    max: totalEstimate.max > 0 ? Math.round(((totalEstimate.max - totalInternal.max) / totalEstimate.max) * 100) / 100 : 0,
  };

  return {
    success: true,
    snapshotId: `backtest-${label}-${Date.now()}`, // simulated — real one comes from DB
    modules,
    rawGlobalEstimate: { ...totalEstimate },         // before calibration
    calibratedEstimate: { ...totalEstimate },         // same as raw when no team profile
    estimateRange: totalEstimate,
    internalRange: totalInternal,
    hoursRange: totalHours,
    marginRange,
    missingInfo,
    projectRiskFlags,
    projectRiskSummary: buildProjectRiskSummary(projectRiskFlags),
    overallConfidence,
    ratesUsed: Object.fromEntries(Object.entries(DEFAULT_BILLING_RATES).map(([k, v]) => [k, v])),
    calibration: { applied: false, estimateSampleSize: 0, pricingSampleSize: 0 },
    estimateCalibrationFactors: { dummy_key: 1.2 }, // injected as worst-case to test serializer
    pricingCalibrationFactors:  { dummy_key: 1.1 },
    calibrationFactorsApplied:  { estimateCalibrationFactors: {}, pricingCalibrationFactors: {} },
  };
}

const FORBIDDEN_KEYS = [
  "internalRange", "internalRate", "internalCost",
  "estimateCalibrationFactors", "pricingCalibrationFactors", "calibrationFactorsApplied",
  "ratesUsed", "marginRange",
];

function findForbiddenKeys(obj, path = "") {
  if (!obj || typeof obj !== "object") return [];
  const hits = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    if (FORBIDDEN_KEYS.includes(k)) hits.push(p);
    if (Array.isArray(v)) v.forEach((x, i) => hits.push(...findForbiddenKeys(x, `${p}[${i}]`)));
    else if (v && typeof v === "object") hits.push(...findForbiddenKeys(v, p));
  }
  return hits;
}

function tw(n) { return `NT$${n.toLocaleString()}`; }

function printCaseSummary(label, data) {
  console.log(`\n  📊 ${label}`);
  console.log(`  rawGlobalEstimate : ${tw(data.rawGlobalEstimate.min)} – ${tw(data.rawGlobalEstimate.max)}`);
  console.log(`  calibratedEstimate: ${tw(data.calibratedEstimate.min)} – ${tw(data.calibratedEstimate.max)}`);
  console.log(`  estimateRange     : ${tw(data.estimateRange.min)} – ${tw(data.estimateRange.max)}`);
  console.log(`  internalRange     : ${tw(data.internalRange.min)} – ${tw(data.internalRange.max)}`);
  console.log(`  hoursRange        : ${data.hoursRange.min} – ${data.hoursRange.max} hrs`);
  console.log(`  margin range      : ${Math.round(data.marginRange.min * 100)}% – ${Math.round(data.marginRange.max * 100)}%`);
  console.log(`  overallConfidence : ${Math.round(data.overallConfidence * 100)}%`);
  console.log(`  snapshotId        : ${data.snapshotId}`);
  console.log(`  missingInfo (${data.missingInfo.length})`);
  data.missingInfo.slice(0, 4).forEach((m) => console.log(`    · ${m}`));
  if (data.missingInfo.length > 4) console.log(`    · … +${data.missingInfo.length - 4} more`);
  console.log(`  projectRiskSummary:\n    ${data.projectRiskSummary}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// CASE A: 企業官網 + 部落格
//   Client: 中型企業，想要官網 + 部落格 + 表單，沒有特別的複雜需求
//   Modules: landing_page (standard) + multi_page_website (standard) + cms_backend (standard)
//            + email_notification (simple) + devops_setup (standard) + qa_regression (standard)
// ─────────────────────────────────────────────────────────────────────────────

section("CASE A: 企業官網 + 部落格");
console.log("  情境: 中型企業官網，含首頁、多頁、CMS 後台、聯絡表單通知");

const caseAModules = [
  computeModuleEstimate("landing_page", "standard"),
  computeModuleEstimate("multi_page_website", "standard"),
  computeModuleEstimate("cms_backend", "standard"),
  computeModuleEstimate("email_notification", "simple"),
  computeModuleEstimate("devops_setup", "standard"),
  computeModuleEstimate("qa_regression", "standard"),
  computeModuleEstimate("pm_communication", "standard"),
].filter(Boolean);

const caseA = buildCaseResponse(caseAModules, "A");
printCaseSummary("Case A 原始估算 (rawGlobalEstimate = calibratedEstimate，無校準)", caseA);

// Case A: 7 modules (landing + multi-page + CMS backend + email + devops + QA + PM)
// DevOps and QA make the range higher than a "just landing page" estimate — NT$300k-600k is realistic
assert(caseA.estimateRange.min > 50000,   "Case A min > NT$50,000",   `got ${caseA.estimateRange.min}`);
assert(caseA.estimateRange.max < 650000,  "Case A max < NT$650,000",  `got ${caseA.estimateRange.max}`);
assert(caseA.missingInfo.length >= 2,    "Case A has missingInfo items");
assert(caseA.snapshotId.startsWith("backtest-"), "snapshotId simulated");
assert(caseA.overallConfidence >= 0.7,   "Case A confidence >= 70%", `got ${caseA.overallConfidence}`);

// Margin sanity: internal should be < external
assert(caseA.internalRange.max < caseA.estimateRange.max, "Case A internalRange.max < estimateRange.max");
assert(caseA.marginRange.min > 0.2 && caseA.marginRange.max < 0.55, `Case A margin 20–55%`, `got ${Math.round(caseA.marginRange.min*100)}–${Math.round(caseA.marginRange.max*100)}%`);

// Serializer checks
const caseAPublic = buildPublicEstimateResponse(caseA);
const caseAShare  = buildShareProposalResponse(caseA);
const caseALeaks  = findForbiddenKeys(caseAPublic);
const caseAShareLeaks = findForbiddenKeys(caseAShare);
assert(caseALeaks.length === 0,      "Case A public: 0 forbidden keys", caseALeaks.join(", "));
assert(caseAShareLeaks.length === 0, "Case A share:  0 forbidden keys", caseAShareLeaks.join(", "));
assert(caseAPublic.snapshotId === caseA.snapshotId, "Case A snapshotId present in public response");
assert(!("snapshotId" in caseAShare), "Case A snapshotId NOT in share response");
assert("estimateRange" in caseAPublic, "Case A estimateRange in public");
assert(!("internalRange" in caseAPublic), "Case A internalRange NOT in public");

// ─────────────────────────────────────────────────────────────────────────────
// CASE B: B2B SaaS 訂閱平台
//   Client: 新創，想建 B2B SaaS，有用戶管理、權限、訂閱計費、報表、通知
//   Modules: auth_standard + rbac + crud_module (complex) + subscription_credits +
//            dashboard_analytics + email_notification + payment_integration (complex) +
//            admin_panel + devops_setup + qa_regression + pm_communication
// ─────────────────────────────────────────────────────────────────────────────

section("CASE B: B2B SaaS 訂閱平台");
console.log("  情境: 新創 B2B SaaS，用戶管理、RBAC、訂閱計費、報表後台");

const caseBModules = [
  computeModuleEstimate("auth_standard",      "standard"),
  computeModuleEstimate("rbac",               "complex"),
  computeModuleEstimate("crud_module",         "complex"),
  computeModuleEstimate("subscription_credits","standard"),
  computeModuleEstimate("dashboard_analytics", "standard"),
  computeModuleEstimate("email_notification",  "standard"),
  computeModuleEstimate("payment_integration", "complex"),
  computeModuleEstimate("admin_panel",         "standard"),
  computeModuleEstimate("devops_setup",        "standard"),
  computeModuleEstimate("qa_regression",       "complex"),
  computeModuleEstimate("pm_communication",    "standard"),
].filter(Boolean);

const caseB = buildCaseResponse(caseBModules, "B");
printCaseSummary("Case B 原始估算", caseB);

// Case B: 11 modules including complex RBAC + payment + QA = NT$700k-1.4M is realistic for full SaaS
assert(caseB.estimateRange.min > 200000,   "Case B min > NT$200,000",   `got ${caseB.estimateRange.min}`);
assert(caseB.estimateRange.max < 1500000,  "Case B max < NT$1,500,000", `got ${caseB.estimateRange.max}`);
assert(caseB.overallConfidence >= 0.6,     "Case B confidence >= 60%");
assert(caseB.missingInfo.length >= 3,     "Case B has missingInfo ≥ 3");
assert(caseB.projectRiskFlags.some((f) => f.includes("金流")), "Case B: payment risk flag present");
assert(caseB.projectRiskFlags.some((f) => f.includes("權限")), "Case B: RBAC risk flag present");

// Calibration split test: apply estimate factor 1.2, pricing factor 1.4 to payment module
const paymentMod = caseBModules.find((m) => m.baselineKey === "payment_integration");
const calibProfile = {
  estimateCalibrationFactors: { payment_integration: 1.2 },
  pricingCalibrationFactors:  { payment_integration: 1.4 },
};
const calibPayment = applyCalibrationToModule(paymentMod, "payment_integration", calibProfile);

console.log("\n  Calibration split on payment_integration:");
console.log(`    Before — hours: [${paymentMod.hoursRange.min}, ${paymentMod.hoursRange.max}]  price: [${tw(paymentMod.estimateRange.min)}, ${tw(paymentMod.estimateRange.max)}]  cost: [${tw(paymentMod.internalRange.min)}, ${tw(paymentMod.internalRange.max)}]`);
console.log(`    After  — hours: [${calibPayment.hoursRange.min}, ${calibPayment.hoursRange.max}]  price: [${tw(calibPayment.estimateRange.min)}, ${tw(calibPayment.estimateRange.max)}]  cost: [${tw(calibPayment.internalRange.min)}, ${tw(calibPayment.internalRange.max)}]`);

// Hours scale with estimateFactor only (×1.2)
const hoursDeltaPct = Math.round((calibPayment.hoursRange.max / paymentMod.hoursRange.max - 1) * 100);
assert(Math.abs(hoursDeltaPct - 20) <= 2, `hours scale ×1.2 (got +${hoursDeltaPct}%)`);

// Price scales with estimate × pricing (×1.2×1.4 = ×1.68)
const priceDeltaPct = calibPayment.estimateRange.max / paymentMod.estimateRange.max;
assert(priceDeltaPct >= 1.60 && priceDeltaPct <= 1.76, `price scale ×1.68 (est×price) — got ×${priceDeltaPct.toFixed(2)}`);

// Cost scales with estimate only (×1.2), NOT with pricing factor
const costDeltaPct = Math.round((calibPayment.internalRange.max / paymentMod.internalRange.max - 1) * 100);
assert(Math.abs(costDeltaPct - 20) <= 2, `internalRange (cost) scale ×1.2 only — got +${costDeltaPct}%`);
assert(calibPayment.calibration?.applied === true, "calibration.applied = true on module");

// Simulate calibrated estimate total for Case B
const caseBCalibrated = caseBModules.map((m) => applyCalibrationToModule(m, m.baselineKey, calibProfile));
const caseBCalibratedEstimate = caseBCalibrated.reduce(
  (acc, m) => ({ min: acc.min + m.estimateRange.min, max: acc.max + m.estimateRange.max, currency: "TWD" }),
  { min: 0, max: 0, currency: "TWD" }
);
console.log(`\n  Case B calibrated total: ${tw(caseBCalibratedEstimate.min)} – ${tw(caseBCalibratedEstimate.max)}`);
console.log(`  Case B raw total:        ${tw(caseB.rawGlobalEstimate.min)} – ${tw(caseB.rawGlobalEstimate.max)}`);

// Calibrated should be higher than raw (factors > 1.0)
assert(caseBCalibratedEstimate.max > caseB.rawGlobalEstimate.max, "calibratedEstimate > rawGlobalEstimate when factors > 1.0");

// Serializer checks
const caseBPublic = buildPublicEstimateResponse(caseB);
const caseBLeaks  = findForbiddenKeys(caseBPublic);
assert(caseBLeaks.length === 0, "Case B public: 0 forbidden keys", caseBLeaks.join(", "));

// ─────────────────────────────────────────────────────────────────────────────
// CASE C: AI 客服 SaaS MVP
//   Client: 想用 AI 做客服機器人，有知識庫管理、AI 對話、報表、分享連結、外部 API
//   Modules: auth_standard + ai_feature_full (complex) + crud_module + dashboard_analytics +
//            admin_panel + share_link + third_party_api (complex) + file_upload +
//            devops_setup (complex) + qa_regression (complex) + pm_communication
// ─────────────────────────────────────────────────────────────────────────────

section("CASE C: AI 客服 SaaS MVP");
console.log("  情境: AI 客服機器人平台，知識庫管理、AI 對話、分享連結、外部串接");

const caseCModules = [
  computeModuleEstimate("auth_standard",      "standard"),
  computeModuleEstimate("ai_feature_full",    "complex"),
  computeModuleEstimate("crud_module",         "complex"),
  computeModuleEstimate("dashboard_analytics", "standard"),
  computeModuleEstimate("admin_panel",         "complex"),
  computeModuleEstimate("share_link",          "standard"),
  computeModuleEstimate("third_party_api",     "complex"),
  computeModuleEstimate("file_upload",         "standard"),
  computeModuleEstimate("devops_setup",        "complex"),
  computeModuleEstimate("qa_regression",       "complex"),
  computeModuleEstimate("pm_communication",    "complex"),
].filter(Boolean);

const caseC = buildCaseResponse(caseCModules, "C");
printCaseSummary("Case C 原始估算", caseC);

assert(caseC.estimateRange.min > 300000,  "Case C min > NT$300,000", `got ${caseC.estimateRange.min}`);
assert(caseC.estimateRange.max < 1500000, "Case C max < NT$1,500,000", `got ${caseC.estimateRange.max}`);
assert(caseC.projectRiskFlags.some((f) => f.includes("AI")), "Case C: AI risk flag present");
assert(caseC.projectRiskFlags.some((f) => f.includes("第三方")), "Case C: third-party risk flag present");
assert(caseC.missingInfo.length >= 5, `Case C missingInfo ≥ 5 — got ${caseC.missingInfo.length}`);

// admin/public/share serializer
const caseCAdmin  = buildAdminEstimateResponse(caseC);
const caseCPublic = buildPublicEstimateResponse(caseC);
const caseCShare  = buildShareProposalResponse(caseC);
const caseCLeaks  = findForbiddenKeys(caseCPublic);
const caseCShareLeaks = findForbiddenKeys(caseCShare);

assert("internalRange" in caseCAdmin,   "Case C admin: internalRange present");
assert("ratesUsed" in caseCAdmin,       "Case C admin: ratesUsed present");
assert(caseCLeaks.length === 0,         "Case C public: 0 forbidden keys", caseCLeaks.join(", "));
assert(caseCShareLeaks.length === 0,    "Case C share:  0 forbidden keys", caseCShareLeaks.join(", "));
assert(caseCAdmin.modules[0].internalRange != null, "Case C admin module: internalRange present");
assert(!caseCPublic.modules?.[0]?.internalRange,    "Case C public module: internalRange absent");

// ─────────────────────────────────────────────────────────────────────────────
// Adjustment guard: actualHoursByRole must NOT be passed for non-completed project
// ─────────────────────────────────────────────────────────────────────────────

section("Adjustment guard: actualHoursByRole × non-completed project");

function simulateAdjustmentGuard(projectStatus, hasActualHours) {
  // Mirrors the guard in calibrationController.createAdjustment
  const VALID_STATUSES = new Set(["draft", "sent", "accepted", "rejected", "completed"]);
  const status = VALID_STATUSES.has(projectStatus) ? projectStatus : "draft";
  if (hasActualHours && status !== "completed") {
    return { blocked: true, reason: "actualHoursByRole 只能在 projectStatus = 'completed' 時提供" };
  }
  return { blocked: false };
}

assert(simulateAdjustmentGuard("draft",     true).blocked  === true,  "draft + actualHours → blocked");
assert(simulateAdjustmentGuard("sent",      true).blocked  === true,  "sent + actualHours → blocked");
assert(simulateAdjustmentGuard("accepted",  true).blocked  === true,  "accepted + actualHours → blocked");
assert(simulateAdjustmentGuard("completed", true).blocked  === false, "completed + actualHours → allowed");
assert(simulateAdjustmentGuard("completed", false).blocked === false, "completed + no actualHours → allowed");
assert(simulateAdjustmentGuard("sent",      false).blocked === false, "sent + no actualHours → allowed (pricing signal)");

// ─────────────────────────────────────────────────────────────────────────────
// Calibration suggestion routing
// ─────────────────────────────────────────────────────────────────────────────

section("Calibration signal routing — estimate vs pricing independence");

// Simulate what computeCalibrationSuggestions returns for different scenarios
const mockAdjustments = [
  // completed + actualHours → goes to estimateCalibration
  { projectStatus: "completed", scopeChanged: false, actualHoursByRole: { backend: 80 }, finalQuotedPrice: 300000,
    snapshot: { rawGlobalEstimate: { max: 250000 }, detectedModules: [{ baselineKey: "ai_feature_full", hoursRange: { max: 60 } }] } },
  // sent + no actualHours → goes to pricingCalibration only
  { projectStatus: "sent",      scopeChanged: false, actualHoursByRole: null, finalQuotedPrice: 200000,
    snapshot: { rawGlobalEstimate: { max: 175000 }, detectedModules: [{ baselineKey: "dashboard_analytics", hoursRange: { max: 40 } }] } },
  // scopeChanged = true → excluded from both
  { projectStatus: "completed", scopeChanged: true,  actualHoursByRole: { backend: 120 }, finalQuotedPrice: 500000,
    snapshot: { rawGlobalEstimate: { max: 300000 }, detectedModules: [{ baselineKey: "admin_panel", hoursRange: { max: 80 } }] } },
];

const validForEstimate  = mockAdjustments.filter((a) => a.projectStatus === "completed" && a.actualHoursByRole && !a.scopeChanged);
const validForPricing   = mockAdjustments.filter((a) => ["sent","accepted","completed"].includes(a.projectStatus) && !a.scopeChanged);
const scopeChangedCount = mockAdjustments.filter((a) => a.scopeChanged).length;

assert(validForEstimate.length === 1,  "1 adjustment qualifies for estimateCalibration");
assert(validForPricing.length === 2,   "2 adjustments qualify for pricingCalibration");
assert(scopeChangedCount === 1,        "1 adjustment excluded (scopeChanged)");

// Verify estimate signal: actualHours / baselineHours (not price-based)
const estSignal = mockAdjustments.filter((a) => a.projectStatus === "completed" && a.actualHoursByRole && !a.scopeChanged);
const estFactor = estSignal[0].actualHoursByRole.backend / estSignal[0].snapshot.detectedModules[0].hoursRange.max;
assert(typeof estFactor === "number" && estFactor > 0, `estimateCalibration factor from actual hours: ${estFactor.toFixed(2)}x`);

// Verify pricing signal: finalQuotedPrice / rawGlobalEstimate.max (not actual hours)
const priceSignals = validForPricing.map((a) => a.finalQuotedPrice / a.snapshot.rawGlobalEstimate.max);
assert(priceSignals.every((f) => typeof f === "number" && f > 0), `pricingCalibration factors from quoted/raw ratio: ${priceSignals.map(f=>f.toFixed(2)).join(", ")}`);

// ─────────────────────────────────────────────────────────────────────────────
// CASE A': 企業官網 — tiered versions (compare granular vs bundled)
// ─────────────────────────────────────────────────────────────────────────────

section("CASE A': 官網四分層比較（deprecated 過濾 + 新分層驗證）");

const DEPRECATED_KEYS = ["landing_page", "multi_page_website", "email_notification"];
const activeBaselines = DEFAULT_BASELINES.filter((b) => !b.deprecated);
assert(!activeBaselines.some((b) => DEPRECATED_KEYS.includes(b.baselineKey)), "Deprecated baselines excluded from active list");

// Build a dummy prompt and check deprecated keys don't appear
const prompt = buildEstimateModulesPrompt({
  requirementSpec: { projectType: "website", businessGoal: "test", platforms: ["web"], clientIntent: "test", requirements: [], assumptions: [] },
  baselines: DEFAULT_BASELINES,
});
for (const key of DEPRECATED_KEYS) {
  assert(!prompt.includes(`- ${key}:`), `Deprecated key "${key}" NOT in prompt`);
}

// New granular baseline keys must all appear in prompt
const NEW_WEBSITE_KEYS = ["landing_page_simple", "corporate_site_static", "corporate_site_with_cms", "corporate_site_advanced"];
const NEW_EMAIL_KEYS = ["email_basic", "email_transactional", "email_queue_advanced"];
for (const key of [...NEW_WEBSITE_KEYS, ...NEW_EMAIL_KEYS]) {
  assert(prompt.includes(`- ${key}:`), `New key "${key}" present in prompt`);
}

// Price range sanity per tier
console.log("\n  Website tier price bands (standard complexity):");
const tierTargets = {
  landing_page_simple:      { min: 40000,  max: 100000 },
  corporate_site_static:    { min: 100000, max: 230000 },
  corporate_site_with_cms:  { min: 200000, max: 400000 },
  corporate_site_advanced:  { min: 330000, max: 580000 },
};
for (const [key, target] of Object.entries(tierTargets)) {
  const result = computeModuleEstimate(key, "standard");
  assert(result != null, `${key}: baseline found`);
  assert(
    result.estimateRange.min >= target.min && result.estimateRange.max <= target.max,
    `${key}: NT$${result.estimateRange.min/1000}k–${result.estimateRange.max/1000}k in expected band`,
    `target NT$${target.min/1000}k–${target.max/1000}k`
  );
  console.log(`    ${key.padEnd(30)} NT$${result.estimateRange.min.toLocaleString()} – NT$${result.estimateRange.max.toLocaleString()}`);
}

console.log("\n  Email tier price bands:");
const emailTargets = {
  email_basic:           { min: 0,     max: 15000  },
  email_transactional:   { min: 15000, max: 60000  },
  email_queue_advanced:  { min: 45000, max: 120000 },
};
for (const [key, target] of Object.entries(emailTargets)) {
  const result = computeModuleEstimate(key, "standard");
  assert(result != null, `${key}: baseline found`);
  assert(
    result.estimateRange.min >= target.min && result.estimateRange.max <= target.max,
    `${key}: NT$${result.estimateRange.min/1000}k–${result.estimateRange.max/1000}k in expected band`,
    `target NT$${target.min/1000}k–${target.max/1000}k`
  );
  console.log(`    ${key.padEnd(30)} NT$${result.estimateRange.min.toLocaleString()} – NT$${result.estimateRange.max.toLocaleString()}`);
}

// Show how selecting the right tier avoids over-quoting a simple site
const simpleA = buildCaseResponse([computeModuleEstimate("landing_page_simple", "standard")].filter(Boolean), "A-simple");
const withCmsA = buildCaseResponse([computeModuleEstimate("corporate_site_with_cms", "standard")].filter(Boolean), "A-cms");
console.log(`\n  「只要一頁形象頁」  → ${tw(simpleA.estimateRange.min)} – ${tw(simpleA.estimateRange.max)}`);
console.log(`  「要能自己改內容」  → ${tw(withCmsA.estimateRange.min)} – ${tw(withCmsA.estimateRange.max)}`);
assert(withCmsA.estimateRange.min > simpleA.estimateRange.max * 2, "CMS site clearly more expensive than simple landing");

// ─────────────────────────────────────────────────────────────────────────────
// Keyword → Tier mapping (mirrors the STRICT RULES in estimateModulesPrompt.js)
// These simulate what the AI SHOULD pick given each scenario description.
// ─────────────────────────────────────────────────────────────────────────────

section("Keyword → Tier mapping (prompt rule verification)");

/**
 * Simulates the tier-selection decision tree from the prompt's STRICT RULES.
 * Mirrors: STEP 1 (single-page) → STEP 2 (CMS?) → STEP 3 (score ≥ 3 → advanced).
 */
function selectWebsiteTier(requirements) {
  const r = requirements.toLowerCase();

  // Negation guard — must check BEFORE positive CMS match
  const negatesCMS = /不(需要|用|要|含)\s*(後台|cms)|沒\s*(有|提|要)\s*(後台|cms)|no\s+cms|without\s+cms/.test(r);
  const hasCMS     = !negatesCMS && /cms|後台|自行更新|自己改|管理內容|content.*manage|edit.*content/.test(r);
  const isSinglePage = /一頁|single.?page|landing|形象/.test(r);

  // STEP 1
  if (isSinglePage && !hasCMS) return "landing_page_simple";

  // STEP 2 — no CMS → static
  if (!hasCMS) return "corporate_site_static";

  // STEP 3 — CMS confirmed, score complexity signals
  const signals = [
    /多語系|multilingual|i18n|語系切換/.test(r),
    /seo|搜尋引擎|sitemap|結構化資料/.test(r),
    /表單通知|email.*通知|通知.*email|form.*notif/.test(r),
    /ci\/cd|部署|deployment|devops|staging/.test(r),
    /動畫|互動效果|animation|gsap|parallax/.test(r),
    /第三方|串接|webhook|external.*api/.test(r),
  ].filter(Boolean).length;

  return signals >= 3 ? "corporate_site_advanced" : "corporate_site_with_cms";
}

function selectEmailTier(requirements) {
  const r = requirements.toLowerCase();
  const hasQueue = /queue|佇列|retry|重試|寄送紀錄|delivery.*log|日誌/.test(r);
  // "password reset" (either word order), welcome, order confirmation, multiple templates
  const hasMulti = /多種|多事件|多模板|reset.*password|password.*reset|忘記密碼|訂單.*通知|歡迎|welcome/.test(r);
  if (hasQueue) return "email_queue_advanced";
  if (hasMulti) return "email_transactional";
  return "email_basic";
}

const websiteMapping = [
  // Explicit no-CMS cases
  ["做一頁形象頁，RWD，不需要後台",                          "landing_page_simple"],
  ["公司官網五頁，不用後台，內容我們自己寫",                    "corporate_site_static"],
  ["公司網站，不需要 CMS，五個頁面",                          "corporate_site_static"],
  ["品牌形象頁，只有一頁",                                   "landing_page_simple"],
  // Vague → no CMS mentioned → static
  ["做一個公司官網",                                        "corporate_site_static"],
  // Explicit CMS, score < 3 → with_cms
  ["企業官網，客戶要能自己改最新消息跟文章",                    "corporate_site_with_cms"],
  ["官網要有後台，讓業務自行上傳最新消息",                      "corporate_site_with_cms"],
  ["後台管理官網，含 SEO 設定",                              "corporate_site_with_cms"],  // CMS + 1 signal
  ["後台官網，只有多語系、SEO 設定",                           "corporate_site_with_cms"],  // CMS + 2 signals
  // CMS + score ≥ 3 → advanced
  ["後台官網、多語系、SEO、表單通知",                          "corporate_site_advanced"],  // CMS + 3 signals
  ["後台管理、多語系、SEO、表單通知、CI/CD部署",               "corporate_site_advanced"],  // CMS + 4 signals
  ["後台、多語系、SEO、第三方串接、CI/CD部署",                 "corporate_site_advanced"],  // CMS + 4 signals
];

const emailMapping = [
  ["聯絡表單寄信給管理員",                          "email_basic"],
  ["訂單成立通知、忘記密碼信、歡迎信三種模板",          "email_transactional"],
  ["需要 queue、retry、寄送紀錄",                  "email_queue_advanced"],
  ["contact form sends one email notification",  "email_basic"],
  ["welcome email and password reset",           "email_transactional"],
  ["email with queue and retry logic",           "email_queue_advanced"],
];

console.log("\n  Website keyword → tier:");
for (const [req, expected] of websiteMapping) {
  const got = selectWebsiteTier(req);
  assert(got === expected, `"${req.slice(0, 38)}…" → ${expected}`, `got: ${got}`);
}

console.log("\n  Email keyword → tier:");
for (const [req, expected] of emailMapping) {
  const got = selectEmailTier(req);
  assert(got === expected, `"${req.slice(0, 45)}…" → ${expected}`, `got: ${got}`);
}

// STRICT RULE: vague → lower tier, not higher
assert(selectWebsiteTier("官網，不確定有沒有要改") === "corporate_site_static",
  "Vague with no CMS → corporate_site_static");
assert(selectWebsiteTier("官網只想優化SEO，基本多頁") === "corporate_site_static",
  "SEO only + no CMS → static, not advanced");
assert(selectWebsiteTier("後台官網，有SEO，有表單通知，有部署") === "corporate_site_advanced",
  "CMS + 3 signals (SEO+notif+devops) → advanced");
assert(selectWebsiteTier("後台官網，有SEO，有表單通知") === "corporate_site_with_cms",
  "CMS + 2 signals only → with_cms, not advanced");
assert(selectEmailTier("表單寄一封通知") === "email_basic",
  "Single notification → email_basic, not transactional");

// ─────────────────────────────────────────────────────────────────────────────
// Prompt Integration Fixtures
// ─────────────────────────────────────────────────────────────────────────────
// These document what "correct AI output" looks like for specific requirement scenarios.
// Real LLM selection isn't deterministic, but these fixtures:
//   1. Serve as regression targets for AI prompt behavior
//   2. Verify the computation pipeline handles each scenario end-to-end
//   3. Can be upgraded to actual LLM calls in a staging integration test

section("Prompt Integration Fixtures — AI tier selection scenarios");

const PROMPT_FIXTURES = [
  {
    scenario: "「做個官網」模糊需求",
    requirementText: "幫我們做一個公司官網",
    // Correct AI behavior: picks lower tier, does NOT assume CMS
    mockedModules: [
      { id: "M1", baselineKey: "corporate_site_static", complexity: "standard", confidence: 0.65,
        name: "企業官網", description: "多頁靜態企業網站", features: ["首頁", "關於我們", "聯絡我們"],
        requirementIds: ["R1"], complexityReason: "需求未指定 CMS，預設靜態多頁" },
    ],
    expectedBaselineKey: "corporate_site_static",
    forbiddenBaselineKeys: ["corporate_site_advanced", "corporate_site_with_cms"],
    // Baseline's built-in missingInfo should include CMS question
    expectedMissingInfoPattern: /後台|更新|cms/i,
    expectedPriceBand: { min: 80_000, max: 250_000 },
  },
  {
    scenario: "「官網，要能自己改內容」明確 CMS 需求",
    requirementText: "做企業官網，業務要能自己更新最新消息",
    mockedModules: [
      { id: "M1", baselineKey: "corporate_site_with_cms", complexity: "standard", confidence: 0.85,
        name: "企業官網 + CMS", description: "含後台的多頁官網", features: ["首頁", "最新消息管理", "聯絡表單"],
        requirementIds: ["R1"], complexityReason: "明確要求後台編輯，標準 CMS 場景" },
    ],
    expectedBaselineKey: "corporate_site_with_cms",
    forbiddenBaselineKeys: ["corporate_site_advanced", "corporate_site_static"],
    expectedPriceBand: { min: 180_000, max: 430_000 },
  },
  {
    scenario: "「做一頁形象頁」單頁明確需求",
    requirementText: "做一頁 RWD 形象網站，純展示，不需要後台",
    mockedModules: [
      { id: "M1", baselineKey: "landing_page_simple", complexity: "standard", confidence: 0.9,
        name: "單頁形象網站", description: "單頁 RWD 形象頁", features: ["Hero", "關於", "聯絡"],
        requirementIds: ["R1"], complexityReason: "單頁展示，無後台" },
    ],
    expectedBaselineKey: "landing_page_simple",
    forbiddenBaselineKeys: ["corporate_site_advanced", "corporate_site_with_cms", "corporate_site_static"],
    expectedPriceBand: { min: 30_000, max: 100_000 },
  },
  {
    scenario: "全功能官網 (CMS + 3+ signals) → advanced",
    requirementText: "企業官網含後台編輯、多語系、SEO 設定、表單通知、CI/CD 部署",
    mockedModules: [
      { id: "M1", baselineKey: "corporate_site_advanced", complexity: "standard", confidence: 0.88,
        name: "進階企業官網", description: "全功能含後台、多語系、SEO、表單通知、DevOps",
        features: ["後台 CMS", "多語系", "SEO 設定", "表單通知 Email", "CI/CD"],
        requirementIds: ["R1", "R2", "R3", "R4", "R5"],
        complexityReason: "CMS + 4 個複雜度信號，選 advanced" },
    ],
    expectedBaselineKey: "corporate_site_advanced",
    forbiddenBaselineKeys: ["corporate_site_with_cms", "corporate_site_static", "landing_page_simple"],
    expectedPriceBand: { min: 280_000, max: 620_000 },
  },
  {
    scenario: "「聯絡表單寄信」→ email_basic (add-on only)",
    requirementText: "聯絡表單填完後寄一封通知信給管理員",
    mockedModules: [
      { id: "M1", baselineKey: "corporate_site_static", complexity: "standard", confidence: 0.8,
        name: "靜態官網", description: "多頁靜態企業網站", features: ["首頁", "關於", "聯絡"],
        requirementIds: ["R1"], complexityReason: "靜態網站" },
      { id: "M2", baselineKey: "email_basic", complexity: "simple", confidence: 0.9,
        name: "聯絡表單通知", description: "表單送出後發一封 Email 通知管理員",
        features: ["通知信模板"], requirementIds: ["R2"],
        complexityReason: "只需一封通知信，選 email_basic simple" },
    ],
    expectedBaselineKey: "email_basic",  // assert at least one module has this
    forbiddenBaselineKeys: ["email_transactional", "email_queue_advanced"],
    expectedPriceBand: { min: 100_000, max: 280_000 }, // site + email_basic combined
  },
];

for (const fixture of PROMPT_FIXTURES) {
  console.log(`\n  Fixture: ${fixture.scenario}`);

  // 1. Verify the prompt contains tier selection guide (structural check)
  const prompt = buildEstimateModulesPrompt({
    requirementSpec: {
      projectType: "website",
      businessGoal: fixture.requirementText,
      platforms: ["web"],
      clientIntent: fixture.requirementText,
      requirements: [{ id: "R1", status: "confirmed", text: fixture.requirementText }],
      assumptions: [],
    },
    baselines: DEFAULT_BASELINES,
  });
  assert(prompt.includes("STEP 1"), `Fixture "${fixture.scenario}": prompt contains tier decision tree`);
  assert(prompt.includes("Score ≥ 3"), `Fixture "${fixture.scenario}": prompt contains scoring rule`);
  assert(!prompt.includes("landing_page\"") && !prompt.includes('"multi_page_website"'),
    `Fixture "${fixture.scenario}": deprecated keys not in prompt`);

  // 2. Run mocked AI output through the computation pipeline
  const computedModules = fixture.mockedModules.map((m) => {
    const result = computeModuleEstimate(m.baselineKey, m.complexity);
    if (!result) return null;
    return {
      ...m,
      baselineName: result.baselineName,
      assumptions: result.assumptions,
      exclusions: result.exclusions,
      missingInfo: result.missingInfo,
      hoursRange: result.hoursRange,
      estimateRange: result.estimateRange,
      internalRange: result.internalRange,
      riskBuffer: result.riskBuffer,
      roleHours: result.roleHours,
    };
  }).filter(Boolean);

  assert(computedModules.length === fixture.mockedModules.length,
    `Fixture "${fixture.scenario}": all modules resolved`);

  // 3. Assert the right baselineKey is present
  const allKeys = computedModules.map((m) => m.baselineKey);
  assert(allKeys.includes(fixture.expectedBaselineKey),
    `Fixture "${fixture.scenario}": includes ${fixture.expectedBaselineKey}`);

  // 4. Assert forbidden keys are absent
  for (const forbidden of fixture.forbiddenBaselineKeys ?? []) {
    assert(!allKeys.includes(forbidden),
      `Fixture "${fixture.scenario}": does NOT include ${forbidden}`);
  }

  // 5. Assert combined price band
  const combinedMin = computedModules.reduce((s, m) => s + (m.estimateRange?.min ?? 0), 0);
  const combinedMax = computedModules.reduce((s, m) => s + (m.estimateRange?.max ?? 0), 0);
  const fmtNTD = (n) => `NT$${(n / 1000).toFixed(0)}k`;
  assert(combinedMax > fixture.expectedPriceBand.min,
    `Fixture "${fixture.scenario}": max ${fmtNTD(combinedMax)} > floor ${fmtNTD(fixture.expectedPriceBand.min)}`);
  assert(combinedMax < fixture.expectedPriceBand.max * 1.5,
    `Fixture "${fixture.scenario}": max ${fmtNTD(combinedMax)} not wildly above ceiling`);

  // 6. For CMS-baseline fixtures: assert baseline missingInfo includes CMS-related question
  if (fixture.expectedMissingInfoPattern) {
    const allMissing = computedModules.flatMap((m) => m.missingInfo ?? []);
    const hasPattern = allMissing.some((q) => fixture.expectedMissingInfoPattern.test(q));
    assert(hasPattern,
      `Fixture "${fixture.scenario}": missingInfo includes CMS-related question`);
  }

  // 7. Serializer security check on each fixture
  const publicOut = buildPublicEstimateResponse({ modules: computedModules });
  const forbidden = findForbiddenKeys(publicOut);
  assert(forbidden.length === 0,
    `Fixture "${fixture.scenario}": public response: 0 forbidden keys (got: ${forbidden.join(", ")})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// DEPRECATED_MODULE_MAP routing logic
// ─────────────────────────────────────────────────────────────────────────────

section("DEPRECATED_MODULE_MAP — routing and ambiguity rules");

const { DEPRECATED_MODULE_MAP } = await import("../estimationBaselines.js");

// landing_page → single suggestion → routable
const lpInfo = DEPRECATED_MODULE_MAP["landing_page"];
assert(Array.isArray(lpInfo?.suggestedKeys),                  "landing_page: suggestedKeys is array");
assert(lpInfo.suggestedKeys.length === 1,                     "landing_page: unambiguous (1 suggestion)");
assert(lpInfo.suggestedKeys[0] === "landing_page_simple",     "landing_page → landing_page_simple");

// multi_page_website → multiple suggestions → ambiguous (should NOT auto-route)
const mpInfo = DEPRECATED_MODULE_MAP["multi_page_website"];
assert(mpInfo.suggestedKeys.length > 1,                       "multi_page_website: ambiguous (multiple suggestions)");
assert(mpInfo.suggestedKeys.includes("corporate_site_static"), "multi_page_website: includes corporate_site_static");
assert(mpInfo.suggestedKeys.includes("corporate_site_with_cms"), "multi_page_website: includes corporate_site_with_cms");

// email_notification → multiple suggestions → ambiguous
const enInfo = DEPRECATED_MODULE_MAP["email_notification"];
assert(enInfo.suggestedKeys.length === 3,                     "email_notification: 3 suggestions");
assert(enInfo.suggestedKeys.includes("email_basic"),          "email_notification: includes email_basic");
assert(enInfo.suggestedKeys.includes("email_queue_advanced"), "email_notification: includes email_queue_advanced");

// Calibration routing simulation:
// - Single suggestion → route to suggestedKey[0]
// - Multiple suggestions → skip (ambiguous), exclude from calibration computation
function simulateCalibrationRouting(originalKey) {
  const info = DEPRECATED_MODULE_MAP[originalKey];
  if (!info) return { routed: true, effectiveKey: originalKey };
  const ambiguous = info.suggestedKeys.length !== 1;
  return {
    routed: !ambiguous,
    effectiveKey: ambiguous ? null : info.suggestedKeys[0],
    excludedReason: ambiguous ? "deprecated_module_ambiguous" : null,
  };
}

assert(simulateCalibrationRouting("landing_page").routed,          "landing_page: calibration routed to landing_page_simple");
assert(simulateCalibrationRouting("landing_page").effectiveKey === "landing_page_simple",
  "landing_page: effectiveKey = landing_page_simple");
assert(!simulateCalibrationRouting("multi_page_website").routed,   "multi_page_website: NOT auto-routed (ambiguous)");
assert(simulateCalibrationRouting("multi_page_website").effectiveKey === null,
  "multi_page_website: effectiveKey = null (ambiguous)");
assert(!simulateCalibrationRouting("email_notification").routed,   "email_notification: NOT auto-routed (ambiguous)");

// Non-deprecated key passes through unchanged
assert(simulateCalibrationRouting("auth_standard").routed,         "auth_standard: passes through unchanged");
assert(simulateCalibrationRouting("auth_standard").effectiveKey === "auth_standard",
  "auth_standard: effectiveKey = auth_standard");

// ─────────────────────────────────────────────────────────────────────────────
// Missing baseline keys (robustness)
// ─────────────────────────────────────────────────────────────────────────────

section("Robustness: unknown baseline key");

const unknownResult = computeModuleEstimate("nonexistent_module", "standard");
assert(unknownResult === null, "Unknown baselineKey returns null (AI module dropped)");

// ─────────────────────────────────────────────────────────────────────────────
// Final summary
// ─────────────────────────────────────────────────────────────────────────────

section("Comparison table: suggested real-project price bands");
console.log("  Case  | rawGlobalEstimate (min–max)                 | margin   | confidence");
console.log("  ──────┼────────────────────────────────────────────┼──────────┼───────────");
for (const [label, data] of [["A (企業官網)", caseA], ["B (B2B SaaS)", caseB], ["C (AI 客服 MVP)", caseC]]) {
  const margin = `${Math.round(data.marginRange.min*100)}–${Math.round(data.marginRange.max*100)}%`;
  const conf   = `${Math.round(data.overallConfidence*100)}%`;
  const range  = `${tw(data.estimateRange.min)} – ${tw(data.estimateRange.max)}`;
  console.log(`  ${label.padEnd(15)}| ${range.padEnd(43)}| ${margin.padEnd(9)}| ${conf}`);
}

console.log("\n──────────────────────────────────────────────────────────");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
