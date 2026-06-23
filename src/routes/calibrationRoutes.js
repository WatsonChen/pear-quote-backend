import { Router } from "express";
import { authMiddleware } from "../middleware/authMiddleware.js";
import {
  createAdjustment,
  getProfile,
  getSuggestions,
  applyProfile,
  getHistory,
} from "../controllers/calibrationController.js";

const router = Router();

router.use(authMiddleware);

// Adjustment for a specific snapshot (cross-workspace guarded in service layer)
router.post("/snapshots/:snapshotId/adjustment", createAdjustment);

// Profile & suggestions (read-only)
router.get("/profile", getProfile);
router.get("/suggestions", getSuggestions);
router.get("/history", getHistory);

// Apply confirmed factors (OWNER/ADMIN only — enforced in controller)
router.post("/apply", applyProfile);

export default router;
