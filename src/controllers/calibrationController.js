/**
 * Calibration Controller
 *
 * Route summary:
 *   GET  /api/calibration/profile                            — read current team profile
 *   GET  /api/calibration/suggestions                        — compute suggestions (no DB write)
 *   POST /api/calibration/apply                              — apply confirmed factors (OWNER/ADMIN only)
 *   GET  /api/calibration/history                            — snapshot history with delta analysis
 *   POST /api/calibration/snapshots/:snapshotId/adjustment   — record user adjustment for a snapshot
 *
 * Snapshots are auto-created inside estimationController.
 * Frontend does NOT need to call a create-snapshot endpoint.
 */

import {
  saveEstimateAdjustment,
  computeCalibrationSuggestions,
  applyCalibrationSuggestions,
  getCalibrationProfile,
  getCalibrationHistory,
} from "../lib/calibrationService.js";

const OWNER_ADMIN = new Set(["OWNER", "ADMIN"]);
const VALID_STATUSES = new Set(["draft", "sent", "accepted", "rejected", "completed"]);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/calibration/profile
// ─────────────────────────────────────────────────────────────────────────────

export async function getProfile(req, res) {
  try {
    const workspaceId = req.workspace?.id;
    if (!workspaceId) return res.status(401).json({ success: false, message: "Workspace not found" });

    const profile = await getCalibrationProfile(workspaceId);
    return res.json({ success: true, profile: profile ?? null, hasProfile: profile != null });
  } catch (err) {
    console.error("[calibration/profile]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/calibration/suggestions
// ─────────────────────────────────────────────────────────────────────────────

export async function getSuggestions(req, res) {
  try {
    const workspaceId = req.workspace?.id;
    if (!workspaceId) return res.status(401).json({ success: false, message: "Workspace not found" });

    const result = await computeCalibrationSuggestions(workspaceId);
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error("[calibration/suggestions]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/calibration/apply  (OWNER/ADMIN only)
// ─────────────────────────────────────────────────────────────────────────────

export async function applyProfile(req, res) {
  try {
    const workspaceId = req.workspace?.id;
    if (!workspaceId) return res.status(401).json({ success: false, message: "Workspace not found" });

    if (!OWNER_ADMIN.has(req.workspaceRole)) {
      return res.status(403).json({
        success: false,
        message: "只有 OWNER 或 ADMIN 可以套用校準設定",
      });
    }

    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "User not found" });

    const {
      estimateCalibrationFactors,
      pricingCalibrationFactors,
      estimateSampleSize = 0,
      pricingSampleSize = 0,
      reason = null,
    } = req.body;

    if (!estimateCalibrationFactors && !pricingCalibrationFactors) {
      return res.status(400).json({
        success: false,
        message: "至少需提供 estimateCalibrationFactors 或 pricingCalibrationFactors",
      });
    }

    const profile = await applyCalibrationSuggestions(
      workspaceId,
      userId,
      { estimateCalibrationFactors, pricingCalibrationFactors },
      estimateSampleSize,
      pricingSampleSize,
      reason,
    );

    return res.json({ success: true, profile });
  } catch (err) {
    console.error("[calibration/apply]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/calibration/history
// ─────────────────────────────────────────────────────────────────────────────

export async function getHistory(req, res) {
  try {
    const workspaceId = req.workspace?.id;
    if (!workspaceId) return res.status(401).json({ success: false, message: "Workspace not found" });

    const limit = Math.min(parseInt(req.query.limit ?? "20", 10), 100);
    const history = await getCalibrationHistory(workspaceId, limit);
    return res.json({ success: true, history, count: history.length });
  } catch (err) {
    console.error("[calibration/history]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/calibration/snapshots/:snapshotId/adjustment
// ─────────────────────────────────────────────────────────────────────────────

export async function createAdjustment(req, res) {
  try {
    const workspaceId = req.workspace?.id;
    if (!workspaceId) return res.status(401).json({ success: false, message: "Workspace not found" });

    const { snapshotId } = req.params;
    if (!snapshotId) return res.status(400).json({ success: false, message: "snapshotId is required" });

    const {
      adjustedModules = null,
      adjustedHoursByRole = null,
      actualHoursByRole = null,
      adjustedEstimateRange = null,
      adjustmentReason = null,
      finalQuotedPrice = null,
      acceptedPrice = null,
      projectStatus = "draft",
      scopeChanged = false,
    } = req.body;

    const status = VALID_STATUSES.has(projectStatus) ? projectStatus : "draft";

    // Guard: actualHoursByRole is only valid for completed projects
    if (actualHoursByRole != null && status !== "completed") {
      return res.status(400).json({
        success: false,
        message: "actualHoursByRole 只能在 projectStatus = 'completed' 時提供，否則會污染工時校準資料",
      });
    }

    const adjustment = await saveEstimateAdjustment({
      snapshotId,
      workspaceId,
      adjustedModules,
      adjustedHoursByRole,
      actualHoursByRole,
      adjustedEstimateRange,
      adjustmentReason: typeof adjustmentReason === "string" ? adjustmentReason.trim() || null : null,
      finalQuotedPrice: typeof finalQuotedPrice === "number" ? finalQuotedPrice : null,
      acceptedPrice: typeof acceptedPrice === "number" ? acceptedPrice : null,
      projectStatus: status,
      scopeChanged: Boolean(scopeChanged),
    });

    return res.status(201).json({ success: true, adjustmentId: adjustment.id, updatedAt: adjustment.updatedAt });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ success: false, message: err.message });
    }
    console.error("[calibration/adjustment]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}
