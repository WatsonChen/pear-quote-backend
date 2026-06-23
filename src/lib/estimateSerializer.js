/**
 * Response serializers for /api/ai/estimate-modules output.
 *
 * RULE: internalRange, ratesUsed, and marginRange are NEVER included in
 * public, share, or proposal responses. This is enforced structurally —
 * not by convention or memory. Always route through the correct serializer.
 *
 * Three contexts:
 *   buildAdminEstimateResponse   — workspace owner / admin view (all fields)
 *   buildPublicEstimateResponse  — logged-in client-facing views (no internal cost)
 *   buildShareProposalResponse   — share link / proposal / PDF export (summary only)
 *
 * Field visibility guide (for UI developers):
 *
 *   CLIENT-VISIBLE (safe to show to clients on proposal / share page):
 *     estimateRange, hoursRange, modules[].name, modules[].description,
 *     modules[].features, modules[].estimateRange, modules[].assumptions,
 *     modules[].exclusions, modules[].complexity, modules[].complexityReason,
 *     missingInfo, requirementQuestions, projectRiskSummary,
 *     overallConfidence, overallComplexity, estimationNotes, snapshotId
 *
 *   INTERNAL-ONLY (admin / owner view only — NEVER send to clients):
 *     internalRange, marginRange, ratesUsed, calibration (factors),
 *     estimateCalibrationFactors, pricingCalibrationFactors, calibrationFactorsApplied,
 *     modules[].internalRange, modules[].roleHours
 */

/** Internal-only fields that must never appear outside admin context. */
const INTERNAL_TOP_LEVEL = new Set([
  "internalRange",
  "ratesUsed",
  "marginRange",
  // Calibration internals — factors and applied-factor snapshots are strategy data
  "estimateCalibrationFactors",
  "pricingCalibrationFactors",
  "calibrationFactorsApplied",
]);
const INTERNAL_MODULE = new Set(["internalRange"]);

/** Explicit field visibility declaration — for admin response metadata and UI reference. */
const FIELD_VISIBILITY = {
  clientVisible: [
    "estimateRange",
    "hoursRange",
    "overallConfidence",
    "overallComplexity",
    "estimationNotes",
    "projectRiskSummary",
    "missingInfo",
    "requirementQuestions",
    "snapshotId",
    // module-level
    "modules[].name",
    "modules[].description",
    "modules[].features",
    "modules[].assumptions",
    "modules[].exclusions",
    "modules[].estimateRange",
    "modules[].complexity",
    "modules[].complexityReason",
    "modules[].baselineName",
  ],
  internalOnly: [
    "internalRange",
    "marginRange",
    "ratesUsed",
    "calibration",
    "calibrationFactorsApplied",
    // module-level
    "modules[].internalRange",
    "modules[].roleHours",
    "modules[].riskBuffer",
  ],
};

function serializeModule(module, { admin = false } = {}) {
  return {
    id: module.id,
    name: module.name,
    description: module.description,
    features: module.features ?? [],
    requirementIds: module.requirementIds ?? [],
    baselineKey: module.baselineKey,
    baselineName: module.baselineName,
    assumptions: module.assumptions ?? [],
    exclusions: module.exclusions ?? [],
    missingInfo: module.missingInfo ?? [],
    complexity: module.complexity,
    complexityReason: module.complexityReason,
    confidence: module.confidence,
    riskBuffer: module.riskBuffer ?? 0,
    roleHours: module.roleHours ?? {},
    hoursRange: module.hoursRange ?? { min: 0, max: 0 },
    estimateRange: module.estimateRange ?? { min: 0, max: 0, currency: "TWD" },
    ...(module.calibration ? { calibration: module.calibration } : {}),
    ...(admin ? { internalRange: module.internalRange } : {}),
  };
}

/**
 * Admin response — workspace owner / internal tools only.
 * Contains all fields including internalRange and ratesUsed.
 * Includes `_fieldVisibility` guide so frontend developers know what to show clients.
 */
export function buildAdminEstimateResponse(data) {
  return {
    ...data,
    modules: (data.modules ?? []).map((m) => serializeModule(m, { admin: true })),
    _fieldVisibility: FIELD_VISIBILITY,
  };
}

/**
 * Public response — logged-in user views (client-facing quote workflow).
 * Strips all internal cost / margin data.
 */
export function buildPublicEstimateResponse(data) {
  const out = { ...data };
  for (const field of INTERNAL_TOP_LEVEL) delete out[field];
  out.modules = (data.modules ?? []).map((m) => serializeModule(m, { admin: false }));
  return out;
}

/**
 * Share / proposal / PDF response — public access via share token or proposal page.
 * Returns summary-level only: no module-level breakdown, no internal data.
 */
export function buildShareProposalResponse(data) {
  return {
    estimateRange: data.estimateRange ?? { min: 0, max: 0, currency: "TWD" },
    hoursRange: data.hoursRange ?? { min: 0, max: 0 },
    overallConfidence: data.overallConfidence ?? 0,
    overallComplexity: data.overallComplexity ?? "standard",
    estimationNotes: data.estimationNotes ?? "",
    projectRiskSummary: data.projectRiskSummary ?? "",
    missingInfo: data.missingInfo ?? [],
    requirementQuestions: data.requirementQuestions ?? [],
  };
}

/**
 * Convert an array of projectRiskFlags into a user-readable summary paragraph.
 * Used in admin and public responses; never exposes internal cost reasoning.
 *
 * @param {string[]} flags
 * @returns {string}
 */
export function buildProjectRiskSummary(flags) {
  if (!Array.isArray(flags) || flags.length === 0) {
    return "估算項目均屬常見模組，風險係數正常，可信度相對較高。";
  }
  const intro = flags.length === 1
    ? "此估算有一個注意事項"
    : `此估算有 ${flags.length} 個注意事項`;

  return `${intro}：${flags.join("；")}。建議在正式報價前與客戶確認以上細節，並預留調整空間。`;
}
