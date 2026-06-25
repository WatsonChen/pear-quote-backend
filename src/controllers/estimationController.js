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

/** Roles that may receive internalRange / ratesUsed / marginRange. */
const INTERNAL_ALLOWED_ROLES = new Set(["OWNER", "ADMIN"]);

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
 * Estimate project modules from a RequirementSpec.
 * POST /api/ai/estimate-modules
 *
 * Body: { requirementSpec: object, workspaceId: string }
 * Response: { modules, priceRange, overallConfidence, estimationNotes }
 */
export async function estimateModules(req, res) {
  try {
    const { requirementSpec } = req.body;
    const workspaceId = req.workspace?.id;

    if (!requirementSpec || typeof requirementSpec !== "object") {
      return res.status(400).json({ success: false, message: "requirementSpec is required" });
    }

    if (!workspaceId) {
      return res.status(401).json({ success: false, message: "Workspace not found" });
    }

    const geminiClient = getGeminiClient();
    if (!geminiClient) {
      return res.status(500).json({ success: false, message: "GOOGLE_GENERATIVE_AI_API_KEY is not configured" });
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

    let text;
    try {
      text = await generateGeminiJsonText(geminiClient, [{ text: prompt }], {
        modelName,
        temperature: 0.1,
      });
    } catch (error) {
      const statusCode = extractGeminiStatusCode(error);
      const retryAfterSeconds = extractGeminiRetryAfterSeconds(error, 20);

      if (statusCode === 429) {
        res.set("Retry-After", String(retryAfterSeconds));
        return res.status(429).json({
          success: false,
          message: `AI 服務忙碌，請 ${retryAfterSeconds} 秒後重試。`,
          errorCode: "AI_RATE_LIMIT",
          retryAfterSeconds,
        });
      }

      if (isGeminiRetryableStatus(statusCode)) {
        return res.status(503).json({
          success: false,
          message: "AI 服務暫時不可用，請稍後重試。",
          errorCode: "AI_TEMP_UNAVAILABLE",
        });
      }

      throw error;
    }

    const cleanedText = normalizeJsonResponse(text);
    let parsed;
    try {
      parsed = JSON.parse(cleanedText);
    } catch (parseError) {
      return res.status(500).json({
        success: false,
        message: "Failed to parse AI response as JSON",
        error: parseError.message,
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
    const requirementQuestions = allMissingInfo.map((item) => {
      const s = item.trim();
      if (/[？?]$/.test(s)) return s;
      if (/^是否|^需要|^有沒有|^是不是|^是否有/.test(s)) return `${s}？`;
      if (/^請/.test(s)) return s.endsWith("？") ? s : `${s}？`;
      return `請提供：${s}`;
    });

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
    let snapshotId = null;
    const quoteId = req.body?.quoteId ?? null;
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
      });
      snapshotId = snapshot.id;
    } catch (snapshotErr) {
      // Non-blocking but must be logged with stack so data loss is traceable
      console.error("[estimateModules] Snapshot save failed (non-blocking):", snapshotErr);
    }

    const isOwnerOrAdmin = INTERNAL_ALLOWED_ROLES.has(req.workspaceRole);
    return res.json(
      isOwnerOrAdmin
        ? buildAdminEstimateResponse({ ...rawResponse, snapshotId })
        : buildPublicEstimateResponse({ ...rawResponse, snapshotId }),
    );
  } catch (error) {
    console.error("[estimateModules] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to estimate modules",
      error: error.message,
    });
  }
}
