import { Router } from "express";
import { analyzeRequirements } from "../controllers/aiController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();

// Protect AI routes
router.use(authMiddleware);

router.post("/analyze", analyzeRequirements);

export default router;
