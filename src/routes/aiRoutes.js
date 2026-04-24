import { Router } from "express";
import { analyzeRequirements, roughEstimate } from "../controllers/aiController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();

// Public route — no auth required (marketing landing page rough estimate)
router.post("/rough-estimate", roughEstimate);

// Protect all other AI routes
router.use(authMiddleware);

router.post("/analyze", analyzeRequirements);

export default router;
