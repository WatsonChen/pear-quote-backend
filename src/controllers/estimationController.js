import prisma from "../lib/prisma.js";
import {
  extractGeminiRetryAfterSeconds,
  extractGeminiStatusCode,
  generateGeminiJsonText,
  getGeminiClient,
  getGeminiModelName,
  isGeminiTemporaryStatus as isGeminiRetryableStatus,
  normalizeJsonResponse,
} from "../lib/gemini.js";
import { buildEstimateModulesPrompt } from "../prompts/estimateModulesPrompt.js";
import {
  getEstimationBaselines,
  COMPLEXITY_MULTIPLIERS,
  DEFAULT_BILLING_RATES,
  humanizeBaselineKeysInQuestions,
} from "../lib/estimationBaselines.js";
import {
  buildAdminEstimateResponse,
  buildPublicEstimateResponse,
  buildProjectRiskSummary,
} from "../lib/estimateSerializer.js";
import {
  getCalibrationProfile,
  applyCalibrationToModule,
  saveEstimateSnapshot,
} from "../lib/calibrationService.js";
import { parseConversationCore } from "./conversationController.js";
import {
  buildEstimateComparison,
  buildEnhancedRequirementsText,
  summarizeRequirementSpec,
} from "../lib/estimateComparison.js";

/** Roles that may receive internalRange / ratesUsed / marginRange. */
const INTERNAL_ALLOWED_ROLES = new Set(["OWNER", "ADMIN"]);

/**
 * Detect whether a Prisma error is a P2002 unique violation on parentSnapshotId.
 *
 * Prisma reports this differently depending on the driver:
 *   - Standard engine:      err.meta.target = ["parentSnapshotId"]
 *   - PrismaPg driver adapter: err.meta.driverAdapterError.cause.constraint.fields
 *                            = ['"parentSnapshotId"']  (with surrounding quotes)
 *
 * We check both shapes so the detection works in production (Neon + PrismaPg)
 * and in unit-test environments (standard Prisma mock).
 */
export function isParentSnapshotConflict(err) {
  if (err?.code !== "P2002") return false;
  // Standard engine path
  if (
    Array.isArray(err?.meta?.target) &&
    err.meta.target.includes("parentSnapshotId")
  ) return true;
  // PrismaPg driver-adapter path (field names may have surrounding double-quotes)
  const adapterFields = err?.meta?.driverAdapterError?.cause?.constraint?.fields;
  if (Array.isArray(adapterFields)) {
    return adapterFields.some((f) => f.replace(/"/g, "") === "parentSnapshotId");
  }
  return false;
}

const VALID_COMPLEXITIES = new Set([
  "simple", "standard", "complex",
  "low", "medium", "high", "unknown",
]);

function normalizeTextField(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => normalizeTextField(v)).filter(Boolean);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Resolve the effective rate pair (billingRate, internalRate) for a role.
 * Workspace rates may be stored as flat numbers (legacy) or as { billingRate, internalRate } objects.
 */
function resolveRatePair(role, workspaceRates) {
  const ws = workspaceRates[role];
  const def = DEFAULT_BILLING_RATES[role] ?? { billingRate: 1400, internalRate: 950 };

  if (ws && typeof ws === "object" && (ws.billingRate != null || ws.internalRate != null)) {
    return {
      billingRate: ws.billingRate ?? def.billingRate,
      internalRate: ws.internalRate ?? def.internalRate,
    };
  }
  if (typeof ws === "number") {
    // Legacy: stored number is billingRate; internalRate defaults from DEFAULT_BILLING_RATES
    return { billingRate: ws, internalRate: def.internalRate };
  }
  return def;
}

/**
 * Compute per-role hours, hours range, cost range, and price range for one module.
 *
 * Uses baseline.baselineHours ({ role: { min, max } }) at standard complexity.
 * Applies COMPLEXITY_MULTIPLIERS and riskBuffer (if any), capped at MAX_COMBINED_MULTIPLIER.
 *
 * Returns:
 *   roleHours     – { role: { min, max } } adjusted hours per role
 *   estimatedHoursRange – { min, max } total hours
 *   estimateRange – { min, max, currency } client-facing quote range
 *   internalRange – { min, max, currency } internal reference only — NEVER send to client/share page
 */
function computeModuleEstimate(moduleMapping, baseline, workspaceRates) {
  // Cap combined multiplier so small baselines don't inflate disproportionately.
  // e.g. complex (1.4) × riskBuffer 20% = 1.68 — well under the 2.0 cap.
  // TODO: Replace with per-baseline maxMultiplier cap so small modules (Email, SMS, Share Link)
  // and large modules (AI full, Admin, Payment) have independent ceilings.
  const MAX_COMBINED_MULTIPLIER = 2.0;
  const multiplier = COMPLEXITY_MULTIPLIERS[moduleMapping.complexity] ?? 1.0;
  const riskBuffer = Number(baseline?.riskBuffer) || 0;
  const totalMultiplier = Math.min(multiplier * (1 + riskBuffer), MAX_COMBINED_MULTIPLIER);

  const hoursMap = baseline?.baselineHours || {};
  const roleHours = {};
  let totalHoursMin = 0;
  let totalHoursMax = 0;
  let costMin = 0;
  let costMax = 0;
  let priceMin = 0;
  let priceMax = 0;

  for (const [role, range] of Object.entries(hoursMap)) {
    const baseMin = range?.min ?? 0;
    const baseMax = range?.max ?? baseMin;
    const adjMin = baseMin * totalMultiplier;
    const adjMax = baseMax * totalMultiplier;

    roleHours[role] = {
      min: Math.round(adjMin * 10) / 10,
      max: Math.round(adjMax * 10) / 10,
    };
    totalHoursMin += adjMin;
    totalHoursMax += adjMax;

    const { billingRate, internalRate } = resolveRatePair(role, workspaceRates);
    priceMin += adjMin * billingRate;
    priceMax += adjMax * billingRate;
    costMin += adjMin * internalRate;
    costMax += adjMax * internalRate;
  }

  return {
    roleHours,
    estimatedHoursRange: {
      min: Math.round(totalHoursMin * 10) / 10,
      max: Math.round(totalHoursMax * 10) / 10,
    },
    estimateRange: {
      min: Math.round(priceMin / 1000) * 1000,
      max: Math.round(priceMax / 1000) * 1000,
      currency: "TWD",
    },
    internalRange: {
      min: Math.round(costMin / 1000) * 1000,
      max: Math.round(costMax / 1000) * 1000,
      currency: "TWD",
    },
  };
}

/**
 * Core estimate pipeline — pure of Express, reusable by both the estimate-modules
 * controller and the conversational refine-estimate flow.
 *
 * Runs ONE Gemini call (estimate-modules), computes module estimates in code,
 * applies team calibration, persists an EstimateSnapshot (non-blocking), and
 * returns the raw (pre-serialization) admin response plus snapshot metadata.
 *
 * Callers are responsible for routing through the correct serializer
 * (buildAdminEstimateResponse / buildPublicEstimateResponse).
 *
 * Throws typed errors (statusCode/errorCode) for Gemini/validation failures.
 * A snapshot persistence failure is swallowed (logged) and surfaced as snapshotId: null.
 *
 * @param {object} params
 * @param {object} params.requirementSpec
 * @param {string} params.workspaceId
 * @param {string|null} [params.quoteId]
 * @param {string|null} [params.parentSnapshotId]  - refine: snapshot this revision derives from
 * @param {number} [params.revisionNumber]         - 1 for first estimate, +1 per refine
 * @returns {Promise<{ rawResponse: object, modules: Array, snapshotId: string|null, revisionNumber: number, snapshotSaved: boolean }>}
 */
export async function estimateModulesCore({
  requirementSpec,
  workspaceId,
  quoteId = null,
  parentSnapshotId = null,
  revisionNumber = 1,
}) {
  if (!requirementSpec || typeof requirementSpec !== "object") {
    throw Object.assign(new Error("requirementSpec is required"), { statusCode: 400 });
  }
  if (!workspaceId) {
    throw Object.assign(new Error("Workspace not found"), { statusCode: 401 });
  }

  const geminiClient = getGeminiClient();
  if (!geminiClient) {
    throw Object.assign(new Error("GOOGLE_GENERATIVE_AI_API_KEY is not configured"), {
      statusCode: 500,
    });
  }

  // Load baselines, role rates, and calibration profile in parallel
  const [baselines, settings, calibrationProfile] = await Promise.all([
    getEstimationBaselines(workspaceId),
    prisma.systemSettings.findUnique({
      where: { workspaceId },
      select: { roleRates: true },
    }),
    getCalibrationProfile(workspaceId),
  ]);

  const workspaceRoleRates = (settings?.roleRates && typeof settings.roleRates === "object")
    ? settings.roleRates
    : {};

  const modelName = getGeminiModelName("analyze");
  const prompt = buildEstimateModulesPrompt({ requirementSpec, baselines });

  // Single Gemini call. Errors propagate with status info for the caller to translate.
  const text = await generateGeminiJsonText(geminiClient, [{ text: prompt }], {
    modelName,
    temperature: 0.1,
  });

  const cleanedText = normalizeJsonResponse(text);
  let parsed;
  try {
    parsed = JSON.parse(cleanedText);
  } catch (parseError) {
    throw Object.assign(new Error("Failed to parse AI response as JSON"), {
      statusCode: 500,
      cause: parseError,
    });
  }

  // Normalize AI module mappings and compute estimates in code (no AI math)
  const baselineMap = new Map(baselines.map((b) => [b.baselineKey, b]));
  const rawModules = Array.isArray(parsed?.modules) ? parsed.modules : [];

    // Step 1: Compute all modules using only global baselines (no team calibration yet)
    const uncalibratedModules = rawModules
      .map((m, index) => {
        if (!m || typeof m !== "object") return null;
        const id = normalizeTextField(m.id) || `M${index + 1}`;
        const name = normalizeTextField(m.name);
        if (!name) return null;

        const baselineKey = normalizeTextField(m.baselineKey);
        const baseline = baselineMap.get(baselineKey) ?? null;
        const complexity = VALID_COMPLEXITIES.has(m.complexity)
          ? m.complexity
          : baseline?.defaultComplexity ?? "standard";
        const confidence = clamp(Number(m.confidence) || 0.7, 0, 1);

        const emptyEstimate = {
          hoursRange: { min: 0, max: 0 },
          estimateRange: { min: 0, max: 0, currency: "TWD" },
          internalRange: { min: 0, max: 0, currency: "TWD" },
          roleHours: {},
        };
        const estimate = baseline
          ? computeModuleEstimate({ ...m, complexity }, baseline, workspaceRoleRates)
          : emptyEstimate;

        return {
          id,
          name,
          description: normalizeTextField(m.description),
          features: normalizeStringArray(m.features),
          requirementIds: normalizeStringArray(m.requirementIds),
          baselineKey: baselineKey || null,
          baselineName: baseline?.name || null,
          assumptions: baseline?.assumptions ?? [],
          exclusions: baseline?.exclusions ?? [],
          missingInfo: baseline?.missingInfo ?? [],
          complexity,
          complexityReason: normalizeTextField(m.complexityReason),
          confidence,
          riskBuffer: baseline?.riskBuffer ?? 0,
          roleHours: estimate.roleHours,
          hoursRange: estimate.estimatedHoursRange,
          estimateRange: estimate.estimateRange,
          internalRange: estimate.internalRange,
        };
      })
      .filter(Boolean);

    // Step 2: Compute rawGlobalEstimate BEFORE calibration (immutable historical record)
    const sumRangeRaw = (mods, field) =>
      mods.reduce(
        (acc, m) => ({ min: acc.min + (m[field]?.min || 0), max: acc.max + (m[field]?.max || 0), currency: "TWD" }),
        { min: 0, max: 0, currency: "TWD" },
      );
    const rawGlobalEstimate = sumRangeRaw(uncalibratedModules, "estimateRange");

    // Step 3: Apply team calibration (estimate + pricing factors separately)
    const hasCalibration = calibrationProfile != null && (
      Object.keys(calibrationProfile.estimateCalibrationFactors ?? {}).length > 0 ||
      Object.keys(calibrationProfile.pricingCalibrationFactors ?? {}).length > 0
    );
    const modules = hasCalibration
      ? uncalibratedModules.map((m) => applyCalibrationToModule(m, m.baselineKey, calibrationProfile))
      : uncalibratedModules;

    // Aggregate ranges and missingInfo across all modules
    const zero = { min: 0, max: 0, currency: "TWD" };
    const sumRange = (acc, m, field) => ({
      min: acc.min + (m[field]?.min || 0),
      max: acc.max + (m[field]?.max || 0),
      currency: "TWD",
    });

    const totalEstimateRange = modules.reduce((acc, m) => sumRange(acc, m, "estimateRange"), { ...zero });
    const totalInternalRange = modules.reduce((acc, m) => sumRange(acc, m, "internalRange"), { ...zero });
    const totalHoursRange = modules.reduce(
      (acc, m) => ({ min: acc.min + (m.hoursRange?.min || 0), max: acc.max + (m.hoursRange?.max || 0) }),
      { min: 0, max: 0 },
    );

    const totalMarginRange = {
      min: totalEstimateRange.min > 0
        ? Math.round(((totalEstimateRange.min - totalInternalRange.min) / totalEstimateRange.min) * 100) / 100
        : 0,
      max: totalEstimateRange.max > 0
        ? Math.round(((totalEstimateRange.max - totalInternalRange.max) / totalEstimateRange.max) * 100) / 100
        : 0,
    };

    // overallConfidence must be computed before projectRiskFlags (which uses it)
    const overallConfidence =
      modules.length > 0
        ? Math.round((modules.reduce((s, m) => s + m.confidence, 0) / modules.length) * 100) / 100
        : 0;

    // Collect unique missingInfo items across all modules (deduplicated)
    const allMissingInfo = [...new Set(modules.flatMap((m) => m.missingInfo))];

    // requirementQuestions: same items framed as actionable questions for UI display
    // Rules: items already ending with ？ pass through; items starting with action verbs get ？;
    //        bare nouns (e.g. "頁面數量") get "請提供：" prefix so they read as requests.
    const requirementQuestions = humanizeBaselineKeysInQuestions(
      allMissingInfo.map((item) => {
        const s = item.trim();
        if (/[？?]$/.test(s)) return s;
        if (/^是否|^需要|^有沒有|^是不是|^是否有/.test(s)) return `${s}？`;
        if (/^請/.test(s)) return s.endsWith("？") ? s : `${s}？`;
        return `請提供：${s}`;
      }),
    );

    // Build project-level risk flags
    const projectRiskFlags = [];
    if (modules.some((m) => m.riskBuffer > 0)) {
      projectRiskFlags.push("包含第三方 API 或高風險整合，已套用風險係數");
    }
    if (modules.some((m) => m.baselineKey === "payment_integration")) {
      projectRiskFlags.push("金流模組 QA 比重高，建議預留沙箱測試時間");
    }
    if (modules.some((m) => m.baselineKey === "rbac")) {
      projectRiskFlags.push("權限系統複雜度易被低估，建議在 kickoff 前確認角色矩陣");
    }
    if (modules.some((m) => m.baselineKey === "share_link" || m.baselineKey === "status_tracking")) {
      projectRiskFlags.push("含公開分享或狀態追蹤，需確認存取控制與資安需求");
    }
    if (modules.some((m) => m.baselineKey?.startsWith("ai_"))) {
      projectRiskFlags.push("AI 功能受 LLM provider 穩定性影響，建議設計 fallback 機制");
    }
    if (overallConfidence < 0.65) {
      projectRiskFlags.push("整體需求描述不足，估算範圍較大，建議補充 missingInfo 後重新估算");
    }

    const rawResponse = {
      success: true,
      modules,
      estimateRange: totalEstimateRange,
      hoursRange: totalHoursRange,
      internalRange: totalInternalRange,
      marginRange: totalMarginRange,
      missingInfo: allMissingInfo,
      requirementQuestions,
      projectRiskFlags,
      projectRiskSummary: buildProjectRiskSummary(projectRiskFlags),
      overallConfidence,
      overallComplexity: normalizeTextField(parsed?.overallComplexity) || "standard",
      estimationNotes: normalizeTextField(parsed?.estimationNotes),
      unmappedRequirements: normalizeStringArray(parsed?.unmappedRequirements),
      ratesUsed: Object.fromEntries(
        Object.keys(DEFAULT_BILLING_RATES).map((role) => [role, resolveRatePair(role, workspaceRoleRates)])
      ),
      calibration: {
        applied: hasCalibration,
        estimateConfidenceLevel: calibrationProfile?.estimateConfidenceLevel ?? null,
        pricingConfidenceLevel: calibrationProfile?.pricingConfidenceLevel ?? null,
        estimateSampleSize: calibrationProfile?.estimateSampleSize ?? 0,
        pricingSampleSize: calibrationProfile?.pricingSampleSize ?? 0,
      },
    };

    // Auto-save snapshot (non-blocking: snapshot failure must not block the estimate response)
    // EXCEPTION: P2002 on parentSnapshotId means a concurrent refine already claimed this
    // parent (@@unique violation). Re-throw as a typed 409 so refineEstimate can surface it.
    let snapshotId = null;
    let snapshotSaved = false;
    try {
      const calibrationFactorsApplied = hasCalibration ? {
        estimateCalibrationFactors: calibrationProfile.estimateCalibrationFactors ?? {},
        pricingCalibrationFactors:  calibrationProfile.pricingCalibrationFactors  ?? {},
      } : null;
      const snapshot = await saveEstimateSnapshot({
        workspaceId,
        quoteId,
        modules,
        rawGlobalEstimate,
        calibratedEstimate: totalEstimateRange,
        calibrationFactorsApplied,
        hoursRange: totalHoursRange,
        overallConfidence,
        missingInfo: allMissingInfo,
        projectRiskFlags,
        requirementSpec,
        parentSnapshotId,
        revisionNumber,
      });
      snapshotId = snapshot.id;
      snapshotSaved = true;
    } catch (snapshotErr) {
      if (isParentSnapshotConflict(snapshotErr)) {
        throw Object.assign(
          new Error("此版本已被另一次操作更新，請重新載入後再試。"),
          { statusCode: 409, errorCode: "ESTIMATE_REVISION_CONFLICT" },
        );
      }
      // Non-blocking: other snapshot failures are logged but don't abort the response.
      console.error("[estimateModulesCore] Snapshot save failed (non-blocking):", snapshotErr);
    }

    return { rawResponse, modules, snapshotId, revisionNumber, snapshotSaved };
}

/**
 * Translate a typed/Gemini error from estimateModulesCore into an HTTP response.
 * Shared by estimateModules and refineEstimate controllers.
 *
 * @returns {boolean} true if a response was sent
 */
function sendEstimateErrorResponse(res, error, logTag) {
  const statusCode = extractGeminiStatusCode(error);
  const retryAfterSeconds = extractGeminiRetryAfterSeconds(error, 20);

  if (statusCode === 429) {
    res.set("Retry-After", String(retryAfterSeconds));
    res.status(429).json({
      success: false,
      message: `AI 服務忙碌，請 ${retryAfterSeconds} 秒後重試。`,
      errorCode: "AI_RATE_LIMIT",
      retryAfterSeconds,
    });
    return true;
  }

  if (isGeminiRetryableStatus(statusCode)) {
    res.status(503).json({
      success: false,
      message: "AI 服務暫時不可用，請稍後重試。",
      errorCode: "AI_TEMP_UNAVAILABLE",
    });
    return true;
  }

  if (error?.statusCode === 409) {
    res.status(409).json({
      success: false,
      message: error.message,
      errorCode: error.errorCode || "ESTIMATE_REVISION_CONFLICT",
    });
    return true;
  }

  if (error?.statusCode === 400 || error?.statusCode === 401 || error?.statusCode === 404) {
    res.status(error.statusCode).json({ success: false, message: error.message });
    return true;
  }

  console.error(`[${logTag}] Error:`, error);
  res.status(500).json({
    success: false,
    message: "Failed to estimate modules",
    error: error.message,
  });
  return true;
}

/**
 * Estimate project modules from a RequirementSpec.
 * POST /api/ai/estimate-modules
 *
 * Body: { requirementSpec: object, quoteId?: string }
 * Response: admin or public estimate response (role-gated), incl. snapshotId.
 */
export async function estimateModules(req, res) {
  try {
    const { rawResponse, snapshotId } = await estimateModulesCore({
      requirementSpec: req.body?.requirementSpec,
      workspaceId: req.workspace?.id,
      quoteId: req.body?.quoteId ?? null,
    });

    const isOwnerOrAdmin = INTERNAL_ALLOWED_ROLES.has(req.workspaceRole);
    return res.json(
      isOwnerOrAdmin
        ? buildAdminEstimateResponse({ ...rawResponse, snapshotId })
        : buildPublicEstimateResponse({ ...rawResponse, snapshotId }),
    );
  } catch (error) {
    return sendEstimateErrorResponse(res, error, "estimateModules");
  }
}

/**
 * Validate + normalize the refine-estimate request body.
 * Exported for unit testing.
 * @returns {{ snapshotId: string, answers: Array<{question:string, answer:string}>, additionalContext: string }}
 * @throws {Error} with statusCode 400 on validation failure
 */
export function normalizeRefineBody(body) {
  const snapshotId = typeof body?.snapshotId === "string" ? body.snapshotId.trim() : "";
  if (!snapshotId) {
    throw Object.assign(new Error("snapshotId is required"), { statusCode: 400 });
  }

  const rawAnswers = Array.isArray(body?.answers) ? body.answers : [];
  // Strip whitespace-only answers; keep the question text for context.
  const answers = rawAnswers
    .map((a) => ({
      question: typeof a?.question === "string" ? a.question.trim() : "",
      answer: typeof a?.answer === "string" ? a.answer.trim() : "",
    }))
    .filter((a) => a.answer.length > 0);

  const additionalContext =
    typeof body?.additionalContext === "string" ? body.additionalContext.trim() : "";

  if (answers.length === 0 && additionalContext.length === 0) {
    throw Object.assign(
      new Error("至少需提供一項補充回答或補充說明"),
      { statusCode: 400 },
    );
  }

  return { snapshotId, answers, additionalContext };
}

const REFINE_CREDIT_COST = 3;

/**
 * Re-estimate after the user answers AI follow-up questions.
 * POST /api/ai/refine-estimate
 *
 * Credit policy (reserve-then-refund):
 *   - Validation / ownership / revision-conflict failures → no deduction
 *   - Atomically deduct REFINE_CREDIT_COST before Gemini calls
 *   - Gemini or system failure → refund credits
 *   - Success → keep deduction
 *
 * Pipeline (all Gemini calls strictly SEQUENTIAL to avoid 429):
 *   1. Validate body + workspace + ownership (no deduction)
 *   2. Pre-check: existing child snapshot → 409 immediately (no deduction)
 *   3. Atomically deduct REFINE_CREDIT_COST
 *   4. parse-conversation → new requirementSpec      (Gemini call #1)
 *   5. estimate-modules → new estimate + new snapshot (Gemini call #2, awaits #4)
 *   6. Compare new vs old modules by baselineKey
 *   7. Respond with role-gated estimate + comparison (snapshotId may be null if save failed)
 */
export async function refineEstimate(req, res) {
  let normalized;
  try {
    normalized = normalizeRefineBody(req.body);
  } catch (validationError) {
    return res.status(validationError.statusCode || 400).json({
      success: false,
      message: validationError.message,
    });
  }

  const workspaceId = req.workspace?.id;
  if (!workspaceId) {
    return res.status(401).json({ success: false, message: "Workspace not found" });
  }

  let creditReserved = false;

  try {
    // 1. Workspace ownership guard — snapshot must belong to this workspace.
    const previousSnapshot = await prisma.estimateSnapshot.findFirst({
      where: { id: normalized.snapshotId, workspaceId },
      select: {
        id: true,
        quoteId: true,
        revisionNumber: true,
        requirementSpec: true,
        detectedModules: true,
        calibratedEstimate: true,
        rawGlobalEstimate: true,
      },
    });

    if (!previousSnapshot) {
      return res.status(404).json({
        success: false,
        message: "Snapshot not found or does not belong to this workspace",
      });
    }

    // 2. Pre-check: if the parent already has a child, reject immediately (no deduction).
    //    The @@unique([parentSnapshotId]) DB constraint is the authoritative guard;
    //    this pre-check surfaces the conflict before wasting Gemini credits.
    const existingChild = await prisma.estimateSnapshot.findFirst({
      where: { parentSnapshotId: previousSnapshot.id },
      select: { id: true },
    });
    if (existingChild) {
      return res.status(409).json({
        success: false,
        message: "此版本已被另一次操作更新，請重新載入後再試。",
        errorCode: "ESTIMATE_REVISION_CONFLICT",
      });
    }

    // 3. Atomically check balance and deduct REFINE_CREDIT_COST.
    //    updateMany with creditBalance >= cost acts as a CAS — returns count=0 if insufficient.
    const deductResult = await prisma.workspace.updateMany({
      where: { id: workspaceId, creditBalance: { gte: REFINE_CREDIT_COST } },
      data: { creditBalance: { decrement: REFINE_CREDIT_COST } },
    });
    if (deductResult.count === 0) {
      return res.status(403).json({
        success: false,
        message: "Insufficient credits. Please top up your account.",
        errorCode: "INSUFFICIENT_CREDITS",
      });
    }
    creditReserved = true;

    // 4. Build enhanced requirements text from prior spec + new answers/context.
    const baseText = summarizeRequirementSpec(previousSnapshot.requirementSpec);
    const enhancedRequirements = buildEnhancedRequirementsText({
      baseText,
      answers: normalized.answers,
      additionalContext: normalized.additionalContext,
    });

    // 5a. parse-conversation (Gemini call #1) — produce a fresh requirementSpec.
    const newRequirementSpec = await parseConversationCore({ rawInput: enhancedRequirements });

    // 5b. estimate-modules (Gemini call #2) — strictly AFTER step 5a completes.
    //     New snapshot links to the previous one and increments the revision number.
    const previousRevisionNumber = Number.isFinite(previousSnapshot.revisionNumber)
      ? previousSnapshot.revisionNumber
      : 1;
    const { rawResponse, modules, snapshotId, revisionNumber, snapshotSaved } =
      await estimateModulesCore({
        requirementSpec: newRequirementSpec,
        workspaceId,
        quoteId: previousSnapshot.quoteId ?? null,
        parentSnapshotId: previousSnapshot.id,
        revisionNumber: previousRevisionNumber + 1,
      });

    // 6. Compare new vs old modules — keyed by baselineKey, never baselineName.
    const previousModules = Array.isArray(previousSnapshot.detectedModules)
      ? previousSnapshot.detectedModules
      : [];
    const previousEstimateRange =
      previousSnapshot.calibratedEstimate ??
      previousSnapshot.rawGlobalEstimate ??
      { min: 0, max: 0, currency: "TWD" };

    const comparison = buildEstimateComparison({
      previous: {
        snapshotId: previousSnapshot.id,
        revisionNumber: previousRevisionNumber,
        estimateRange: previousEstimateRange,
        modules: previousModules,
      },
      current: {
        snapshotId,
        revisionNumber,
        estimateRange: rawResponse.estimateRange,
        modules,
      },
    });

    // 7. Role-gated response. Serializer strips internal fields; comparison is client-safe.
    const isOwnerOrAdmin = INTERNAL_ALLOWED_ROLES.has(req.workspaceRole);
    const serialized = isOwnerOrAdmin
      ? buildAdminEstimateResponse({ ...rawResponse, snapshotId })
      : buildPublicEstimateResponse({ ...rawResponse, snapshotId });

    creditReserved = false; // success — keep the deduction
    return res.json({
      ...serialized,
      snapshotSaved,
      snapshotId,
      revisionNumber,
      comparison,
    });
  } catch (error) {
    if (creditReserved) {
      // Refund must be awaited — a dropped refund silently bills the user for nothing.
      // On failure, log a CRITICAL entry with enough context for manual compensation.
      try {
        await prisma.workspace.update({
          where: { id: workspaceId },
          data: { creditBalance: { increment: REFINE_CREDIT_COST } },
        });
      } catch (refundErr) {
        const compensationContext = {
          workspaceId,
          creditAmount: REFINE_CREDIT_COST,
          refundError: refundErr?.message,
          originalError: error?.message,
          timestamp: new Date().toISOString(),
        };
        console.error(
          "[refineEstimate] CRITICAL: Credit refund failed — manual compensation required.",
          JSON.stringify(compensationContext),
        );
        // Best-effort: write a compensation record so the failed refund is
        // visible and retryable even if the CRITICAL log is lost or rotated.
        try {
          await prisma.creditCompensation.create({
            data: {
              workspaceId,
              amount: REFINE_CREDIT_COST,
              operation: "refine_refund",
              status: "pending",
              error: refundErr?.message ?? "unknown",
            },
          });
        } catch (compensationErr) {
          // If the compensation record also fails (e.g. DB completely down),
          // there is nothing more we can do in-process — the CRITICAL log above
          // is the last resort.
          console.error(
            "[refineEstimate] CRITICAL: Compensation record write failed — recovery requires manual log audit.",
            compensationErr?.message,
          );
        }
      }
    }
    return sendEstimateErrorResponse(res, error, "refineEstimate");
  }
}
