import { Router } from "express";
import {
  analyzeRequirements,
  refineQuote,
  roughEstimate,
  translateQuote,
} from "../controllers/aiController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();

// Public route — no auth required (marketing landing page rough estimate)
router.post("/rough-estimate", roughEstimate);

// Protect all other AI routes
router.use(authMiddleware);

router.post("/analyze", analyzeRequirements);
router.post("/translate-quote", translateQuote);
router.post("/refine-quote", refineQuote);

export default router;
