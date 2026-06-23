/**
 * Manual smoke tests for the estimation baseline + computation logic.
 * Run with: node src/lib/__tests__/estimationBaselines.test.js
 *
 * Verifies:
 *   1. Simple landing page — Backend/DevOps should not dominate
 *   2. Member + payment + admin system — QA/Backend/riskBuffer should be elevated
 *   3. AI SaaS MVP — AI modules, credit/subscription missingInfo should appear
 *   4. Small module cap — Email notification at complex should not balloon unreasonably
 *   5. internalRange isolation — confirm it exists only in estimation response, not leaked
 */

import {
  DEFAULT_BASELINES,
  DEFAULT_BILLING_RATES,
  COMPLEXITY_MULTIPLIERS,
} from "../estimationBaselines.js";
import {
  buildAdminEstimateResponse,
  buildPublicEstimateResponse,
  buildShareProposalResponse,
  buildProjectRiskSummary,
} from "../estimateSerializer.js";

let passed = 0;
let failed = 0;

/** Fields that must NEVER appear outside admin-only responses. */
const FORBIDDEN_IN_PUBLIC = new Set([
  "internalRange", "internalRates", "internalCost",
  "marginTarget", "costRange", "ratesUsed", "marginRange",
]);

/**
 * Recursively walk an object/array and return every forbidden key found.
 * Returns an array of "path → key" strings.
 */
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

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function getBaseline(key) {
  return DEFAULT_BASELINES.find((b) => b.baselineKey === key);
}

/**
 * Simulate computeModuleEstimate without importing the controller.
 * Mirrors the logic in estimationController.js.
 */
function compute(baselineKey, complexity = "standard", workspaceRates = {}) {
  const baseline = getBaseline(baselineKey);
  if (!baseline) throw new Error(`Baseline not found: ${baselineKey}`);

  const MAX_COMBINED_MULTIPLIER = 2.0;
  const multiplier = COMPLEXITY_MULTIPLIERS[complexity] ?? 1.0;
  const riskBuffer = baseline.riskBuffer ?? 0;
  const totalMultiplier = Math.min(multiplier * (1 + riskBuffer), MAX_COMBINED_MULTIPLIER);

  const hoursMap = baseline.baselineHours;
  let totalHoursMin = 0, totalHoursMax = 0;
  let priceMin = 0, priceMax = 0;
  let internalMin = 0, internalMax = 0;

  for (const [role, range] of Object.entries(hoursMap)) {
    const adjMin = (range?.min ?? 0) * totalMultiplier;
    const adjMax = (range?.max ?? range?.min ?? 0) * totalMultiplier;
    totalHoursMin += adjMin;
    totalHoursMax += adjMax;

    const rates = workspaceRates[role] ?? DEFAULT_BILLING_RATES[role] ?? { billingRate: 1400, internalRate: 950 };
    const billingRate = rates.billingRate ?? rates;
    const internalRate = rates.internalRate ?? rates.billingRate ?? 950;
    priceMin += adjMin * billingRate;
    priceMax += adjMax * billingRate;
    internalMin += adjMin * internalRate;
    internalMax += adjMax * internalRate;
  }

  return {
    baseline,
    totalMultiplier,
    hoursRange: {
      min: Math.round(totalHoursMin * 10) / 10,
      max: Math.round(totalHoursMax * 10) / 10,
    },
    estimateRange: {
      min: Math.round(priceMin / 1000) * 1000,
      max: Math.round(priceMax / 1000) * 1000,
    },
    internalRange: {
      min: Math.round(internalMin / 1000) * 1000,
      max: Math.round(internalMax / 1000) * 1000,
    },
    backendHoursMax: (hoursMap.backend?.max ?? 0) * totalMultiplier,
    devopsHoursMax: (hoursMap.devops?.max ?? 0) * totalMultiplier,
    qaHoursMax: (hoursMap.qa?.max ?? 0) * totalMultiplier,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Case 1: Simple landing page
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n[Case 1] Simple landing page (simple complexity)");
{
  const r = compute("landing_page", "simple");
  console.log(`  Hours: ${r.hoursRange.min}–${r.hoursRange.max}hr`);
  console.log(`  EstimateRange: NT$${r.estimateRange.min.toLocaleString()}–${r.estimateRange.max.toLocaleString()}`);

  assert("Backend hours should be 0", r.backendHoursMax === 0, `got ${r.backendHoursMax}`);
  assert("DevOps hours should be ≤ 4", r.devopsHoursMax <= 4, `got ${r.devopsHoursMax}`);
  assert("Total hours max should be < 60", r.hoursRange.max < 60, `got ${r.hoursRange.max}`);
  assert("Estimate max should be < NT$80,000", r.estimateRange.max < 80000, `got ${r.estimateRange.max}`);
  assert(
    "internalRange < estimateRange (positive margin)",
    r.internalRange.max < r.estimateRange.max,
    `internal ${r.internalRange.max} vs estimate ${r.estimateRange.max}`,
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Case 2: System with member auth + payment + admin (standard/complex)
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n[Case 2] Member + Payment + Admin system");
{
  const authR = compute("auth_standard", "standard");
  const payR = compute("payment_integration", "complex"); // complex + 20% riskBuffer
  const adminR = compute("admin_panel", "standard");

  const totalHoursMax = authR.hoursRange.max + payR.hoursRange.max + adminR.hoursRange.max;
  const totalPriceMax =
    authR.estimateRange.max + payR.estimateRange.max + adminR.estimateRange.max;
  const totalQaHoursMax = authR.qaHoursMax + payR.qaHoursMax + adminR.qaHoursMax;
  const totalBackendHoursMax =
    authR.backendHoursMax + payR.backendHoursMax + adminR.backendHoursMax;

  console.log(`  Combined hours: ~${totalHoursMax.toFixed(0)}hr`);
  console.log(`  Estimate max: NT$${totalPriceMax.toLocaleString()}`);
  console.log(`  QA hours max: ${totalQaHoursMax.toFixed(1)}hr`);
  console.log(`  Backend hours max: ${totalBackendHoursMax.toFixed(1)}hr`);
  console.log(`  Payment riskBuffer applied: ${payR.totalMultiplier.toFixed(2)}x`);

  assert(
    "Payment riskBuffer elevates multiplier above 1.0",
    payR.totalMultiplier > 1.0,
    `got ${payR.totalMultiplier}`,
  );
  assert(
    "QA hours max should be > 30hr across 3 modules",
    totalQaHoursMax > 30,
    `got ${totalQaHoursMax}`,
  );
  assert(
    "Backend hours max should be > 60hr across 3 modules",
    totalBackendHoursMax > 60,
    `got ${totalBackendHoursMax}`,
  );
  assert(
    "Total estimate max should be > NT$200,000",
    totalPriceMax > 200000,
    `got ${totalPriceMax}`,
  );
  assert("payment_integration has riskBuffer", getBaseline("payment_integration").riskBuffer > 0);
  assert("payment_integration missingInfo is non-empty", getBaseline("payment_integration").missingInfo.length >= 1);
}

// ──────────────────────────────────────────────────────────────────────────────
// Case 3: AI SaaS MVP
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n[Case 3] AI SaaS MVP (auth + AI full feature + subscription + share)");
{
  const authR = compute("auth_standard", "standard");
  const aiR = compute("ai_feature_full", "complex");
  const subR = compute("subscription_credits", "standard");
  const shareR = compute("share_link", "simple");

  const modules = [
    { key: "auth_standard", ...authR },
    { key: "ai_feature_full", ...aiR },
    { key: "subscription_credits", ...subR },
    { key: "share_link", ...shareR },
  ];

  const totalHoursMax = modules.reduce((s, m) => s + m.hoursRange.max, 0);
  const totalPriceMin = modules.reduce((s, m) => s + m.estimateRange.min, 0);
  const totalPriceMax = modules.reduce((s, m) => s + m.estimateRange.max, 0);

  // Collect all missingInfo
  const allMissingInfo = [...new Set(modules.flatMap((m) => m.baseline.missingInfo))];

  console.log(`  Combined hours max: ~${totalHoursMax.toFixed(0)}hr`);
  console.log(`  Estimate range: NT$${totalPriceMin.toLocaleString()} – ${totalPriceMax.toLocaleString()}`);
  console.log(`  missingInfo count (deduplicated): ${allMissingInfo.length}`);
  console.log(`  AI module hours: ${aiR.hoursRange.min}–${aiR.hoursRange.max}hr`);

  assert("ai_feature_full baseline exists", !!getBaseline("ai_feature_full"));
  assert(
    "AI full feature at complex: hours max > 80hr",
    aiR.hoursRange.max > 80,
    `got ${aiR.hoursRange.max}`,
  );
  assert(
    "subscription_credits missingInfo mentions subscription vs credit distinction",
    getBaseline("subscription_credits").missingInfo.some((s) => s.includes("訂閱") || s.includes("點數")),
  );
  assert(
    "ai_feature_full missingInfo mentions RAG or history",
    getBaseline("ai_feature_full").missingInfo.some((s) => s.includes("RAG") || s.includes("歷史")),
  );
  assert(
    "missingInfo across all modules ≥ 5 unique items",
    allMissingInfo.length >= 5,
    `got ${allMissingInfo.length}`,
  );
  assert(
    "Total estimate max > NT$300,000 for SaaS MVP",
    totalPriceMax > 300000,
    `got ${totalPriceMax}`,
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Case 4: Small module cap — Email at complex
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n[Case 4] Small module cap — Email notification at complex complexity");
{
  const r = compute("email_notification", "complex"); // 1.4 × (1 + 0.1) = 1.54
  const baseline = getBaseline("email_notification");
  const baselineBackendMax = baseline.baselineHours.backend.max; // 14hr

  console.log(`  Combined multiplier: ${r.totalMultiplier.toFixed(2)}x`);
  console.log(`  Backend hours: up to ${r.backendHoursMax.toFixed(1)}hr (baseline max: ${baselineBackendMax}hr)`);
  console.log(`  Estimate range: NT$${r.estimateRange.min.toLocaleString()} – ${r.estimateRange.max.toLocaleString()}`);

  assert(
    "Combined multiplier ≤ MAX_COMBINED_MULTIPLIER (2.0)",
    r.totalMultiplier <= 2.0,
    `got ${r.totalMultiplier}`,
  );
  assert(
    "Backend hours max ≤ baseline_max × 2.0",
    r.backendHoursMax <= baselineBackendMax * 2.0,
    `got ${r.backendHoursMax}, cap=${baselineBackendMax * 2.0}`,
  );
  assert(
    "Estimate max for email at complex < NT$85,000 (sanity check — complex email with queue/templates is ~NT$70-80k)",
    r.estimateRange.max < 85000,
    `got NT$${r.estimateRange.max.toLocaleString()}`,
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Case 5: internalRange isolation check
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n[Case 5] internalRange isolation — field exists but margin is sensible");
{
  const r = compute("admin_panel", "standard");
  const margin = (r.estimateRange.min - r.internalRange.min) / r.estimateRange.min;

  console.log(`  EstimateRange: NT$${r.estimateRange.min.toLocaleString()} – ${r.estimateRange.max.toLocaleString()}`);
  console.log(`  InternalRange: NT$${r.internalRange.min.toLocaleString()} – ${r.internalRange.max.toLocaleString()}`);
  console.log(`  Gross margin (low end): ${(margin * 100).toFixed(1)}%`);

  assert("internalRange.min < estimateRange.min", r.internalRange.min < r.estimateRange.min);
  assert(
    "Gross margin is between 25% and 50%",
    margin >= 0.25 && margin <= 0.50,
    `got ${(margin * 100).toFixed(1)}%`,
  );
  assert(
    "internalRange field is present in compute result",
    r.internalRange != null && r.internalRange.min != null,
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Case 6: Serializer — internalRange must not appear in public / share responses
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n[Case 6] Serializer — internalRange isolation across all response types");
{
  // Build a realistic raw response (as the controller would produce)
  const fakeModule = {
    id: "M1", name: "會員系統", description: "", features: [], requirementIds: [],
    baselineKey: "auth_standard", baselineName: "會員系統", assumptions: [], exclusions: [],
    missingInfo: ["是否需要 2FA"], complexity: "standard", complexityReason: "", confidence: 0.8,
    riskBuffer: 0, roleHours: {}, hoursRange: { min: 48, max: 76 },
    estimateRange: { min: 65000, max: 103000, currency: "TWD" },
    internalRange: { min: 44000, max: 70000, currency: "TWD" },
  };

  const rawResponse = {
    success: true,
    modules: [fakeModule],
    estimateRange: { min: 65000, max: 103000, currency: "TWD" },
    hoursRange: { min: 48, max: 76 },
    internalRange: { min: 44000, max: 70000, currency: "TWD" },
    marginRange: { min: 0.32, max: 0.32 },
    missingInfo: ["是否需要 2FA"],
    projectRiskFlags: [],
    projectRiskSummary: "估算項目均屬常見模組，風險係數正常，可信度相對較高。",
    overallConfidence: 0.8,
    overallComplexity: "standard",
    estimationNotes: "",
    unmappedRequirements: [],
    ratesUsed: { pm: { billingRate: 1200, internalRate: 820 } },
  };

  const adminRes  = buildAdminEstimateResponse(rawResponse);
  const publicRes = buildPublicEstimateResponse(rawResponse);
  const shareRes  = buildShareProposalResponse(rawResponse);

  // Admin: should include internalRange
  assert("Admin response includes top-level internalRange", "internalRange" in adminRes);
  assert(
    "Admin module includes internalRange",
    "internalRange" in (adminRes.modules?.[0] ?? {}),
  );

  // Public: must NOT include internal fields
  assert("Public response excludes top-level internalRange", !("internalRange" in publicRes));
  assert("Public response excludes ratesUsed", !("ratesUsed" in publicRes));
  assert("Public response excludes marginRange", !("marginRange" in publicRes));
  assert(
    "Public module excludes internalRange",
    !("internalRange" in (publicRes.modules?.[0] ?? {})),
  );
  assert("Public response still includes estimateRange", "estimateRange" in publicRes);
  assert("Public response still includes modules", Array.isArray(publicRes.modules));

  // Share/Proposal: must NOT include internal fields, and has NO module array
  assert("Share response excludes internalRange", !("internalRange" in shareRes));
  assert("Share response excludes ratesUsed", !("ratesUsed" in shareRes));
  assert("Share response excludes marginRange", !("marginRange" in shareRes));
  assert("Share response excludes modules array", !("modules" in shareRes));
  assert("Share response includes estimateRange", "estimateRange" in shareRes);
  assert("Share response includes projectRiskSummary", typeof shareRes.projectRiskSummary === "string");

  // Risk summary text
  const noFlagsText = buildProjectRiskSummary([]);
  const singleFlagText = buildProjectRiskSummary(["金流模組 QA 比重高"]);
  const multiFlagText = buildProjectRiskSummary(["金流", "AI 功能", "權限系統"]);
  assert("Empty flags → fallback summary (non-empty string)", noFlagsText.length > 0);
  assert("Single flag → '一個注意事項'", singleFlagText.includes("一個注意事項"));
  assert("Multi flags → count in summary", multiFlagText.includes("3"));
  assert("Risk summary ends with action hint", multiFlagText.includes("調整空間") || multiFlagText.includes("確認"));
}

// ──────────────────────────────────────────────────────────────────────────────
// Case 7: Recursive deep scan + controller-layer role guard simulation
// ──────────────────────────────────────────────────────────────────────────────
console.log("\n[Case 7] Recursive deep scan — no forbidden keys in public/share, even nested");
{
  // Build a realistic raw response with internal fields scattered across nesting levels
  const fakeModule = (id) => ({
    id, name: `模組 ${id}`, description: "", features: [], requirementIds: [],
    baselineKey: "crud_module", baselineName: "CRUD", assumptions: [], exclusions: [],
    missingInfo: ["欄位數量"], complexity: "standard", complexityReason: "", confidence: 0.75,
    riskBuffer: 0, roleHours: { pm: { min: 3, max: 5 } },
    hoursRange: { min: 30, max: 50 },
    estimateRange:  { min: 42000, max: 70000, currency: "TWD" },
    internalRange:  { min: 29000, max: 48000, currency: "TWD" }, // must be stripped
  });

  const rawResponse = {
    success: true,
    modules: [fakeModule("M1"), fakeModule("M2")],
    estimateRange:  { min: 84000, max: 140000, currency: "TWD" },
    hoursRange:     { min: 60, max: 100 },
    internalRange:  { min: 58000, max: 96000, currency: "TWD" }, // must be stripped
    marginRange:    { min: 0.31, max: 0.31 },                    // must be stripped
    missingInfo:    ["欄位數量"],
    projectRiskFlags: [],
    projectRiskSummary: "風險正常",
    overallConfidence: 0.75,
    overallComplexity: "standard",
    estimationNotes: "",
    unmappedRequirements: [],
    ratesUsed: { pm: { billingRate: 1200, internalRate: 820 } }, // must be stripped
  };

  // --- Admin (OWNER role) ---
  const adminRes = buildAdminEstimateResponse(rawResponse);
  const adminHits = findForbiddenKeys(adminRes, new Set(["nonExistentSentinel"])); // nothing forbidden for admin
  assert("Admin response: no false-positives from sentinel scan", adminHits.length === 0);
  assert("Admin response has internalRange at top level", "internalRange" in adminRes);
  assert("Admin module[0] has internalRange", "internalRange" in (adminRes.modules?.[0] ?? {}));

  // --- Public (MEMBER role) ---
  const publicRes = buildPublicEstimateResponse(rawResponse);
  const publicHits = findForbiddenKeys(publicRes, FORBIDDEN_IN_PUBLIC);
  assert(
    `Public response: zero forbidden keys anywhere (recursive) — found: ${publicHits.join(", ") || "none"}`,
    publicHits.length === 0,
  );
  assert("Public response still has estimateRange", "estimateRange" in publicRes);
  assert("Public response still has modules array", Array.isArray(publicRes.modules));
  assert("Public response still has missingInfo", Array.isArray(publicRes.missingInfo));

  // --- Share/Proposal ---
  const shareRes = buildShareProposalResponse(rawResponse);
  const shareHits = findForbiddenKeys(shareRes, FORBIDDEN_IN_PUBLIC);
  assert(
    `Share response: zero forbidden keys anywhere (recursive) — found: ${shareHits.join(", ") || "none"}`,
    shareHits.length === 0,
  );
  assert("Share response has no modules key", !("modules" in shareRes));
  assert("Share response has estimateRange", "estimateRange" in shareRes);

  // --- Controller role-guard simulation ---
  // Simulate what estimationController does based on req.workspaceRole
  function simulateControllerResponse(rawData, workspaceRole) {
    const isOwnerOrAdmin = ["OWNER", "ADMIN"].includes(workspaceRole);
    return isOwnerOrAdmin
      ? buildAdminEstimateResponse(rawData)
      : buildPublicEstimateResponse(rawData);
  }

  const ownerRes  = simulateControllerResponse(rawResponse, "OWNER");
  const adminRole = simulateControllerResponse(rawResponse, "ADMIN");
  const memberRes = simulateControllerResponse(rawResponse, "MEMBER");
  const unknownRes = simulateControllerResponse(rawResponse, undefined);

  assert("OWNER role receives internalRange", "internalRange" in ownerRes);
  assert("ADMIN role receives internalRange", "internalRange" in adminRole);

  const memberHits = findForbiddenKeys(memberRes, FORBIDDEN_IN_PUBLIC);
  assert(
    `MEMBER role: zero forbidden keys (recursive) — found: ${memberHits.join(", ") || "none"}`,
    memberHits.length === 0,
  );
  const unknownHits = findForbiddenKeys(unknownRes, FORBIDDEN_IN_PUBLIC);
  assert(
    `undefined role: zero forbidden keys (recursive) — found: ${unknownHits.join(", ") || "none"}`,
    unknownHits.length === 0,
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
