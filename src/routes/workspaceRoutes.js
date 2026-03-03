import express from "express";
import { getCurrentWorkspace } from "../controllers/workspaceController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(authMiddleware);

/**
 * @route GET /api/workspaces/current
 * @desc Get current workspace details including credit balance
 * @access Private
 */
router.get("/current", getCurrentWorkspace);

export default router;
