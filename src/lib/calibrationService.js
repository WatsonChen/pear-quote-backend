/**
 * Calibration Service — PearQuote Team Learning Layer v2
 *
 * Two independent calibration tracks:
 *
 *   estimateCalibration
 *     Source:  actualHoursByRole from COMPLETED projects (scopeChanged = false)
 *     Signal:  "How long does our team actually take for this module type?"
 *     Effect:  Adjusts hoursRange (and thus both estimateRange and internalRange)
 *
 *   pricingCalibration
 *     Source:  finalQuotedPrice / adjustedEstimateRange from any sent/accepted project
 *     Signal:  "What price band does our team prefer for this module type?"
 *     Effect:  Adjusts estimateRange only (not hours, not internalRange)
 *
 * Estimate formula:
 *   hours       = baselineHours × complexity × riskBuffer × estimateCalibrationFactor
 *   clientPrice = hours × billingRate × pricingCalibrationFactor
 *   internalCost = hours × internalRate   (no pricing calibration — cost doesn't change with strategy)
 *
 * Safety rules:
 *   - NEVER auto-apply; user must confirm via POST /api/calibration/apply
 *   - MIN 3 samples per module before generating a suggestion
 *   - scopeChanged = true → excluded from both calibrations, tracked as riskPattern only
 *   - All factors clamped to [0.5, 2.5]
 *   - Every apply() writes a CalibrationAuditLog
 */

import prisma from "./prisma.js";
import { DEPRECATED_MODULE_MAP } from "./estimationBaselines.js";

export const MIN_SAMPLES_FOR_SUGGESTION = 3;
const MIN_FACTOR = 0.5;
const MAX_FACTOR = 2.5;
export const CURRENT_BASELINE_VERSION = "1";

function median(values) {
  if (values.length === 0) return 1.0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function confidenceLevelFromSampleSize(n) {
  if (n >= 10) return "high";
  if (n >= 5) return "medium";
  return "low";
}

// ─────────────────────────────────────────────────────────────────────────────
// Outcome status integrity (Stage 3.6)
// ─────────────────────────────────────────────────────────────────────────────

const PROJECT_STATUS_RANK = { draft: 0, sent: 1, accepted: 2, completed: 3 };
const TERMINAL_INCOMPATIBLE_WITH_REJECTED = new Set(["accepted", "completed"]);

/**
 * Decides whether an EstimateAdjustment may move from currentStatus to
 * requestedStatus. `rejected` sits outside the linear draft→sent→accepted→
 * completed progression: it's only reachable from draft/sent, and is
 * terminal in v1 (no path back out, not even to "draft").
 *
 * Pure function — no I/O, independently testable.
 *
 * @param {string} currentStatus
 * @param {string} requestedStatus
 * @returns {{allowed: boolean, reason: "same_status"|"forward"|"regression"|"terminal_conflict"}}
 */
export function resolveProjectStatusTransition(currentStatus, requestedStatus) {
  if (currentStatus === requestedStatus) {
    return { allowed: true, reason: "same_status" };
  }

  if (currentStatus === "rejected") {
    return { allowed: false, reason: "terminal_conflict" };
  }

  if (requestedStatus === "rejected") {
    if (TERMINAL_INCOMPATIBLE_WITH_REJECTED.has(currentStatus)) {
      return { allowed: false, reason: "terminal_conflict" };
    }
    return { allowed: true, reason: "forward" };
  }

  const currentRank = PROJECT_STATUS_RANK[currentStatus] ?? 0;
  const requestedRank = PROJECT_STATUS_RANK[requestedStatus] ?? 0;

  if (requestedRank > currentRank) {
    return { allowed: true, reason: "forward" };
  }
  return { allowed: false, reason: "regression" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Save an AI estimate snapshot.
 * Called automatically inside estimationController — not by the frontend.
 *
 * Stores BOTH rawGlobalEstimate (before calibration) and calibratedEstimate
 * so historical quotes remain traceable even if the profile later changes.
 *
 * @param {object} params
 * @param {string} params.workspaceId
 * @param {string|null} params.quoteId
 * @param {Array}  params.modules               - computed modules (after calibration applied)
 * @param {object} params.rawGlobalEstimate      - { min, max, currency } before calibration
 * @param {object} params.calibratedEstimate     - { min, max, currency } after calibration (may equal raw)
 * @param {object|null} params.calibrationFactorsApplied - snapshot of profile factors used
 * @param {object} params.hoursRange             - { min, max }
 * @param {number} params.overallConfidence
 * @param {string[]} params.missingInfo
 * @param {string[]} params.projectRiskFlags
 * @param {object|null} params.requirementSpec
 * @param {string|null} params.parentSnapshotId   - conversational refine: the snapshot this revision derives from
 * @param {number} params.revisionNumber          - 1 for first estimate, +1 per refine
 */
export async function saveEstimateSnapshot({
  workspaceId,
  quoteId = null,
  modules,
  rawGlobalEstimate,
  calibratedEstimate,
  calibrationFactorsApplied = null,
  hoursRange,
  overallConfidence,
  missingInfo,
  projectRiskFlags,
  requirementSpec = null,
  parentSnapshotId = null,
  revisionNumber = 1,
}) {
  const modulesArray = Array.isArray(modules) ? modules : [];
  const avgMultiplier =
    modulesArray.length > 0
      ? modulesArray.reduce((s, m) => s + (m.complexityMultiplier ?? 1.0), 0) / modulesArray.length
      : 1.0;
  const maxRiskBuffer = modulesArray.reduce((max, m) => Math.max(max, m.riskBuffer ?? 0), 0);
  const baselineHours = Object.fromEntries(
    modulesArray.map((m) => [m.id ?? m.baselineKey ?? m.name, m.roleHours ?? {}])
  );

  return prisma.estimateSnapshot.create({
    data: {
      workspaceId,
      quoteId,
      parentSnapshotId,
      revisionNumber: Number.isFinite(revisionNumber) && revisionNumber >= 1 ? revisionNumber : 1,
      baselineVersion: CURRENT_BASELINE_VERSION,
      detectedModules: modulesArray,
      baselineHours,
      complexityMultiplier: Math.round(avgMultiplier * 100) / 100,
      riskBuffer: maxRiskBuffer,
      rawGlobalEstimate: rawGlobalEstimate ?? { min: 0, max: 0, currency: "TWD" },
      calibratedEstimate: calibratedEstimate ?? rawGlobalEstimate ?? { min: 0, max: 0, currency: "TWD" },
      calibrationFactorsApplied,
      originalHoursRange: hoursRange ?? { min: 0, max: 0 },
      confidenceScore: overallConfidence ?? null,
      missingInfo: missingInfo ?? [],
      projectRiskFlags: projectRiskFlags ?? [],
      requirementSpec: requirementSpec ?? null,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Adjustment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Save or update a user adjustment for a snapshot.
 * Validates that the snapshot belongs to the same workspace (cross-workspace guard).
 *
 * Outcome status integrity (Stage 3.6): once an adjustment exists, a request
 * whose projectStatus would regress it (e.g. accepted → sent) or conflict
 * with a terminal status is ignored IN FULL — every field on the request is
 * dropped, not just projectStatus. A stale "sent" request replaying after a
 * deal closed must not rewrite the historical estimate/adjustment record
 * either, or Estimate vs Actual and Pricing Preference would be learning
 * from a report that was quietly edited after the fact. See
 * resolveProjectStatusTransition for the allowed/ignored matrix.
 *
 * Fields omitted from the request (undefined) never overwrite existing
 * values — only keys actually present in the call are written. For
 * finalQuotedPrice / acceptedPrice / actualHoursByRole specifically, an
 * explicit null is ALSO treated as "no value provided" rather than "clear
 * it": no caller today has a real reason to null out deal-outcome history,
 * so the conservative default is to preserve whatever is already recorded.
 *
 * @param {object} params
 * @param {string} params.snapshotId
 * @param {string} params.workspaceId
 * @param {Array|undefined}  params.adjustedModules
 * @param {object|undefined} params.adjustedHoursByRole   - user's price-strategy adjustments (NOT actual hours)
 * @param {object|null|undefined} params.actualHoursByRole - real tracked hours after project completes
 * @param {object|undefined} params.adjustedEstimateRange
 * @param {string|null|undefined} params.adjustmentReason
 * @param {number|null|undefined} params.finalQuotedPrice
 * @param {number|null|undefined} params.acceptedPrice
 * @param {string}      params.projectStatus
 * @param {boolean|undefined} params.scopeChanged
 * @param {object} [params.client]  - Prisma client/transaction to use (defaults to the module-level prisma singleton; injectable for tests)
 */
export async function saveEstimateAdjustment({
  snapshotId,
  workspaceId,
  adjustedModules,
  adjustedHoursByRole,
  actualHoursByRole,
  adjustedEstimateRange,
  adjustmentReason,
  finalQuotedPrice,
  acceptedPrice,
  projectStatus = "draft",
  scopeChanged,
  client = prisma,
}) {
  // Cross-workspace guard: verify snapshot belongs to this workspace
  const snapshot = await client.estimateSnapshot.findFirst({
    where: { id: snapshotId, workspaceId },
    select: { id: true },
  });
  if (!snapshot) {
    throw Object.assign(new Error("Snapshot not found or does not belong to this workspace"), {
      statusCode: 404,
    });
  }

  const existing = await client.estimateAdjustment.findUnique({ where: { snapshotId } });

  if (existing) {
    const transition = resolveProjectStatusTransition(existing.projectStatus, projectStatus);

    if (!transition.allowed) {
      console.warn(
        `[calibration] projectStatus transition ignored: snapshotId=${snapshotId} current=${existing.projectStatus} requested=${projectStatus} reason=${transition.reason}`,
      );
      return existing;
    }

    const data = { projectStatus, updatedAt: new Date() };
    if (adjustedModules !== undefined) data.adjustedModules = adjustedModules;
    if (adjustedHoursByRole !== undefined) data.adjustedHoursByRole = adjustedHoursByRole;
    if (actualHoursByRole !== undefined && actualHoursByRole !== null) data.actualHoursByRole = actualHoursByRole;
    if (adjustedEstimateRange !== undefined) data.adjustedEstimateRange = adjustedEstimateRange;
    if (adjustmentReason !== undefined) data.adjustmentReason = adjustmentReason;
    if (finalQuotedPrice !== undefined && finalQuotedPrice !== null) data.finalQuotedPrice = finalQuotedPrice;
    if (acceptedPrice !== undefined && acceptedPrice !== null) data.acceptedPrice = acceptedPrice;
    if (scopeChanged !== undefined) data.scopeChanged = Boolean(scopeChanged);

    return client.estimateAdjustment.update({ where: { snapshotId }, data });
  }

  return client.estimateAdjustment.create({
    data: {
      snapshotId,
      workspaceId,
      adjustedModules: adjustedModules ?? null,
      adjustedHoursByRole: adjustedHoursByRole ?? null,
      actualHoursByRole: actualHoursByRole ?? null,
      adjustedEstimateRange: adjustedEstimateRange ?? null,
      adjustmentReason: adjustmentReason ?? null,
      finalQuotedPrice: finalQuotedPrice ?? null,
      acceptedPrice: acceptedPrice ?? null,
      projectStatus,
      scopeChanged: Boolean(scopeChanged),
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Suggestions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute calibration suggestions — split into estimate and pricing factors.
 * Does NOT write to DB. User must confirm before applying.
 *
 * estimateCalibration:
 *   Source: adjustments with actualHoursByRole + projectStatus = "completed" + scopeChanged = false
 *   Factor: actualHoursMax / baselineHoursMax (per module)
 *
 * pricingCalibration:
 *   Source: adjustments with finalQuotedPrice or adjustedEstimateRange + scopeChanged = false
 *   Factor: (finalQuotedPrice or adjustedMax) / rawGlobalEstimateMax (per module)
 *
 * @param {string} workspaceId
 * @returns {Promise<object>}
 */
export async function computeCalibrationSuggestions(workspaceId) {
  const adjustments = await prisma.estimateAdjustment.findMany({
    where: { workspaceId, scopeChanged: false },
    include: { snapshot: true },
    orderBy: { createdAt: "asc" },
  });

  const scopeChangedCount = await prisma.estimateAdjustment.count({
    where: { workspaceId, scopeChanged: true },
  });

  if (adjustments.length === 0) {
    return {
      status: "no_data",
      message: "尚無校準資料。每次報價調整都會自動記錄，累積足夠樣本後會產生建議。",
      suggestedEstimateFactors: {},
      suggestedPricingFactors: {},
      estimateSampleSize: 0,
      pricingSampleSize: 0,
      estimateConfidenceLevel: "low",
      pricingConfidenceLevel: "low",
      moduleBreakdown: {},
      includedSnapshotIds: [],
      excludedSnapshotIds: [],
      exclusionReasons: { scopeChanged: scopeChangedCount },
      hasSufficientData: false,
      minSamplesRequired: MIN_SAMPLES_FOR_SUGGESTION,
    };
  }

  // Track which snapshots are included / excluded
  const includedSnapshotIds = adjustments.map((a) => a.snapshotId);
  const excludedSnapshotIds = await prisma.estimateAdjustment
    .findMany({ where: { workspaceId, scopeChanged: true }, select: { snapshotId: true } })
    .then((rows) => rows.map((r) => r.snapshotId));

  // Collect per-module data
  const estimateFactorsByModule = {}; // { effectiveKey: number[] }
  const pricingFactorsByModule  = {}; // { effectiveKey: number[] }
  const deprecatedKeysSeen      = {}; // { originalKey: { suggestedKeys, snapshotIds[] } }

  for (const adj of adjustments) {
    const snapshot = adj.snapshot;
    const origModules = Array.isArray(snapshot?.detectedModules) ? snapshot.detectedModules : [];
    const rawEstimateMax = snapshot?.rawGlobalEstimate?.max ?? 0;

    for (const origModule of origModules) {
      const key = origModule.baselineKey;
      if (!key) continue;

      // Deprecated key handling:
      // - Keep original key in historical display (moduleBreakdown uses original)
      // - Route calibration signals to the FIRST suggested replacement (most likely match)
      // - If multiple replacements exist, skip automatic routing and mark as ambiguous
      const deprecationInfo = DEPRECATED_MODULE_MAP[key];
      const isDeprecated = deprecationInfo != null;
      const suggestedKeys = deprecationInfo?.suggestedKeys ?? [];
      const effectiveKey = isDeprecated
        ? (suggestedKeys.length === 1 ? suggestedKeys[0] : null) // null = ambiguous, skip routing
        : key;

      if (isDeprecated) {
        if (!deprecatedKeysSeen[key]) {
          deprecatedKeysSeen[key] = {
            suggestedKeys,
            snapshotIds: [],
            ambiguous: suggestedKeys.length !== 1,
          };
        }
        deprecatedKeysSeen[key].snapshotIds.push(adj.snapshotId);
      }

      // Skip calibration routing if no effective key (ambiguous deprecated module)
      if (!effectiveKey) continue;

      const origHoursMax = origModule.hoursRange?.max ?? 0;
      if (origHoursMax <= 0) continue;

      // --- estimateCalibration: only completed projects with actualHoursByRole ---
      if (adj.projectStatus === "completed" && adj.actualHoursByRole) {
        const adjModules = Array.isArray(adj.adjustedModules) ? adj.adjustedModules : [];
        const adjModule = adjModules.find((m) => m.baselineKey === key);
        const actualMax = adjModule?.hoursRange?.max ?? null;

        if (actualMax != null && actualMax > 0) {
          if (!estimateFactorsByModule[effectiveKey]) estimateFactorsByModule[effectiveKey] = [];
          estimateFactorsByModule[effectiveKey].push(actualMax / origHoursMax);
        }
      }

      // --- pricingCalibration: any sent/accepted/completed project with a final price ---
      const usableStatuses = new Set(["sent", "accepted", "completed"]);
      if (usableStatuses.has(adj.projectStatus)) {
        let pricingSignal = null;

        if (typeof adj.finalQuotedPrice === "number" && rawEstimateMax > 0) {
          pricingSignal = adj.finalQuotedPrice / rawEstimateMax;
        } else if (adj.adjustedEstimateRange?.max != null && rawEstimateMax > 0) {
          pricingSignal = adj.adjustedEstimateRange.max / rawEstimateMax;
        }

        if (pricingSignal != null && pricingSignal > 0) {
          if (!pricingFactorsByModule[effectiveKey]) pricingFactorsByModule[effectiveKey] = [];
          pricingFactorsByModule[effectiveKey].push(pricingSignal);
        }
      }
    }
  }

  // Build module breakdown and suggestions
  const moduleBreakdown = {};
  const suggestedEstimateFactors = {};
  const suggestedPricingFactors  = {};

  const allKeys = new Set([
    ...Object.keys(estimateFactorsByModule),
    ...Object.keys(pricingFactorsByModule),
  ]);

  for (const key of allKeys) {
    const estFactors = estimateFactorsByModule[key] ?? [];
    const priceFactors = pricingFactorsByModule[key] ?? [];

    moduleBreakdown[key] = {
      estimateSamples: estFactors.length,
      pricingSamples: priceFactors.length,
      estimateFactors: estFactors.map((f) => Math.round(f * 100) / 100),
      pricingFactors:  priceFactors.map((f) => Math.round(f * 100) / 100),
      suggestedEstimateFactor: estFactors.length >= MIN_SAMPLES_FOR_SUGGESTION
        ? Math.round(clamp(median(estFactors), MIN_FACTOR, MAX_FACTOR) * 100) / 100
        : null,
      suggestedPricingFactor: priceFactors.length >= MIN_SAMPLES_FOR_SUGGESTION
        ? Math.round(clamp(median(priceFactors), MIN_FACTOR, MAX_FACTOR) * 100) / 100
        : null,
    };

    if (estFactors.length >= MIN_SAMPLES_FOR_SUGGESTION) {
      suggestedEstimateFactors[key] = moduleBreakdown[key].suggestedEstimateFactor;
    }
    if (priceFactors.length >= MIN_SAMPLES_FOR_SUGGESTION) {
      suggestedPricingFactors[key] = moduleBreakdown[key].suggestedPricingFactor;
    }
  }

  const estimateSampleSize = adjustments.filter((a) => a.projectStatus === "completed" && a.actualHoursByRole).length;
  const pricingSampleSize  = adjustments.filter((a) => ["sent", "accepted", "completed"].includes(a.projectStatus)).length;

  // Deprecated key summary: show in output so caller can surface migration hints
  const deprecatedModuleSeen = Object.entries(deprecatedKeysSeen).map(([key, info]) => ({
    originalKey: key,
    suggestedKeys: info.suggestedKeys,
    snapshotCount: info.snapshotIds.length,
    calibrationRouted: !info.ambiguous,
    excludedReason: info.ambiguous ? "deprecated_module_ambiguous" : null,
    migrationHint: DEPRECATED_MODULE_MAP[key]?.reason ?? null,
  }));

  const hasSufficientData =
    Object.keys(suggestedEstimateFactors).length > 0 ||
    Object.keys(suggestedPricingFactors).length > 0;

  // Build per-track status and user-friendly message
  const remainingEst   = Math.max(0, MIN_SAMPLES_FOR_SUGGESTION - estimateSampleSize);
  const remainingPrice = Math.max(0, MIN_SAMPLES_FOR_SUGGESTION - pricingSampleSize);

  const estimateTrackStatus =
    estimateSampleSize === 0                         ? "no_data"
    : remainingEst > 0                              ? "collecting_data"
    : Object.keys(suggestedEstimateFactors).length > 0 ? "ready"
    : "collecting_data";

  const pricingTrackStatus =
    pricingSampleSize === 0                           ? "no_data"
    : remainingPrice > 0                             ? "collecting_data"
    : Object.keys(suggestedPricingFactors).length > 0 ? "ready"
    : "collecting_data";

  const overallStatus = hasSufficientData ? "ready" : "collecting_data";

  // Human-readable status message for UI display
  let message = null;
  if (!hasSufficientData) {
    const parts = [];
    if (estimateTrackStatus === "collecting_data") {
      parts.push(`工時校準還需 ${remainingEst} 筆「已完工 + 填入實際工時」紀錄`);
    }
    if (pricingTrackStatus === "collecting_data") {
      parts.push(`報價策略校準還需 ${remainingPrice} 筆「已送出報價」紀錄`);
    }
    message = parts.length > 0
      ? `目前樣本不足，已記錄本次調整。${parts.join("；")}後會產生校準建議。`
      : "尚無足夠校準資料，繼續使用後會自動累積。";
  }

  return {
    status: overallStatus,
    message,
    estimateTrackStatus,
    pricingTrackStatus,
    suggestedEstimateFactors,
    suggestedPricingFactors,
    estimateSampleSize,
    pricingSampleSize,
    estimateConfidenceLevel: confidenceLevelFromSampleSize(estimateSampleSize),
    pricingConfidenceLevel:  confidenceLevelFromSampleSize(pricingSampleSize),
    moduleBreakdown,
    includedSnapshotIds,
    excludedSnapshotIds,
    exclusionReasons: { scopeChanged: scopeChangedCount },
    deprecatedModuleSeen,
    hasSufficientData,
    minSamplesRequired: MIN_SAMPLES_FOR_SUGGESTION,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply (OWNER/ADMIN only, writes audit log)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply confirmed calibration factors to the team profile.
 * Writes a CalibrationAuditLog entry for traceability.
 *
 * @param {string} workspaceId
 * @param {string} userId               - who confirmed the apply
 * @param {object} confirmedFactors     - { estimateCalibrationFactors?, pricingCalibrationFactors? }
 * @param {number} estimateSampleSize
 * @param {number} pricingSampleSize
 * @param {string|null} reason
 */
export async function applyCalibrationSuggestions(
  workspaceId,
  userId,
  confirmedFactors,
  estimateSampleSize = 0,
  pricingSampleSize = 0,
  reason = null,
) {
  const newEstimateFactors = confirmedFactors?.estimateCalibrationFactors ?? {};
  const newPricingFactors  = confirmedFactors?.pricingCalibrationFactors  ?? {};

  const result = await prisma.$transaction(async (tx) => {
    // Read previous factors for audit log
    const existing = await tx.teamCalibrationProfile.findUnique({
      where: { workspaceId },
      select: {
        id: true,
        estimateCalibrationFactors: true,
        pricingCalibrationFactors: true,
      },
    });

    const profile = await tx.teamCalibrationProfile.upsert({
      where: { workspaceId },
      update: {
        estimateCalibrationFactors: newEstimateFactors,
        pricingCalibrationFactors:  newPricingFactors,
        estimateSampleSize,
        pricingSampleSize,
        estimateConfidenceLevel: confidenceLevelFromSampleSize(estimateSampleSize),
        pricingConfidenceLevel:  confidenceLevelFromSampleSize(pricingSampleSize),
        updatedAt: new Date(),
      },
      create: {
        workspaceId,
        estimateCalibrationFactors: newEstimateFactors,
        pricingCalibrationFactors:  newPricingFactors,
        estimateSampleSize,
        pricingSampleSize,
        estimateConfidenceLevel: confidenceLevelFromSampleSize(estimateSampleSize),
        pricingConfidenceLevel:  confidenceLevelFromSampleSize(pricingSampleSize),
      },
    });

    await tx.calibrationAuditLog.create({
      data: {
        workspaceId,
        profileId: profile.id,
        appliedBy: userId,
        previousEstimateFactors: existing?.estimateCalibrationFactors ?? null,
        newEstimateFactors,
        previousPricingFactors: existing?.pricingCalibrationFactors ?? null,
        newPricingFactors,
        reason: reason ?? null,
      },
    });

    return profile;
  });

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile & History
// ─────────────────────────────────────────────────────────────────────────────

export async function getCalibrationProfile(workspaceId) {
  return prisma.teamCalibrationProfile.findUnique({ where: { workspaceId } });
}

export async function getCalibrationHistory(workspaceId, limit = 20) {
  const snapshots = await prisma.estimateSnapshot.findMany({
    where: { workspaceId },
    include: { adjustment: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return snapshots.map((s) => {
    const adj = s.adjustment;
    const rawMax = s.rawGlobalEstimate?.max ?? 0;
    const calibratedMax = s.calibratedEstimate?.max ?? rawMax;
    const adjMax = adj?.adjustedEstimateRange?.max ?? null;
    const finalPrice = adj?.finalQuotedPrice ?? null;

    const pricingDeltaPercent =
      adjMax != null && rawMax > 0 ? Math.round(((adjMax - rawMax) / rawMax) * 100) : null;

    const calibrationDeltaPercent =
      rawMax > 0 && calibratedMax !== rawMax
        ? Math.round(((calibratedMax - rawMax) / rawMax) * 100)
        : null;

    return {
      snapshotId: s.id,
      createdAt: s.createdAt,
      baselineVersion: s.baselineVersion,
      moduleCount: Array.isArray(s.detectedModules) ? s.detectedModules.length : 0,
      confidenceScore: s.confidenceScore,
      rawGlobalEstimate: s.rawGlobalEstimate,
      calibratedEstimate: s.calibratedEstimate,
      calibrationFactorsApplied: s.calibrationFactorsApplied,
      adjustedEstimateRange: adj?.adjustedEstimateRange ?? null,
      finalQuotedPrice: finalPrice,
      acceptedPrice: adj?.acceptedPrice ?? null,
      projectStatus: adj?.projectStatus ?? null,
      scopeChanged: adj?.scopeChanged ?? false,
      hasActualHours: adj?.actualHoursByRole != null,
      pricingDeltaPercent,
      calibrationDeltaPercent,
      hasAdjustment: adj != null,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply calibration to a single module estimate (called in estimationController)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply team calibration factors to a computed module estimate.
 *
 * estimateCalibrationFactor → adjusts hoursRange (and therefore both price and cost proportionally)
 * pricingCalibrationFactor  → adjusts estimateRange only (price strategy, not cost)
 *
 * @param {object} moduleEstimate   - from computeModuleEstimate
 * @param {string} baselineKey
 * @param {object|null} profile     - TeamCalibrationProfile
 * @returns {object}
 */
export function applyCalibrationToModule(moduleEstimate, baselineKey, profile) {
  if (!profile) return moduleEstimate;

  const estFactor   = Number(profile.estimateCalibrationFactors?.[baselineKey] ?? 1.0);
  const priceFactor = Number(profile.pricingCalibrationFactors?.[baselineKey]  ?? 1.0);

  if (estFactor === 1.0 && priceFactor === 1.0) return moduleEstimate;

  const cEst   = clamp(estFactor, MIN_FACTOR, MAX_FACTOR);
  const cPrice = clamp(priceFactor, MIN_FACTOR, MAX_FACTOR);

  const scaleHours = (range) =>
    range ? {
      min: Math.round(range.min * cEst * 10) / 10,
      max: Math.round(range.max * cEst * 10) / 10,
    } : range;

  const scalePrice = (range) =>
    range ? {
      ...range,
      min: Math.round((range.min * cEst * cPrice) / 1000) * 1000,
      max: Math.round((range.max * cEst * cPrice) / 1000) * 1000,
    } : range;

  const scaleInternal = (range) =>
    range ? {
      ...range,
      min: Math.round((range.min * cEst) / 1000) * 1000, // no pricing factor on cost
      max: Math.round((range.max * cEst) / 1000) * 1000,
    } : range;

  const scaleRoleHours = (roleHours) => {
    if (!roleHours) return roleHours;
    return Object.fromEntries(
      Object.entries(roleHours).map(([role, hours]) => {
        if (hours && typeof hours === "object") {
          return [role, { min: Math.round(hours.min * cEst * 10) / 10, max: Math.round(hours.max * cEst * 10) / 10 }];
        }
        return [role, Math.round(Number(hours) * cEst * 10) / 10];
      })
    );
  };

  return {
    ...moduleEstimate,
    hoursRange:    scaleHours(moduleEstimate.hoursRange),
    estimateRange: scalePrice(moduleEstimate.estimateRange),
    internalRange: scaleInternal(moduleEstimate.internalRange),
    roleHours:     scaleRoleHours(moduleEstimate.roleHours),
    calibration: {
      estimateFactor: cEst,
      pricingFactor:  cPrice,
      applied: true,
    },
  };
}
