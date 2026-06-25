import { Router } from "express";
import {
  analyzeRequirements,
  getBaselineDisplayNames,
  refineProposalSection,
  refineQuote,
  refineRoughEstimate,
  roughEstimate,
  translateQuote,
} from "../controllers/aiController.js";
import { parseConversation } from "../controllers/conversationController.js";
import { estimateModules, refineEstimate } from "../controllers/estimationController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();

// Public route — no auth required (marketing landing page rough estimate)
router.post("/rough-estimate", roughEstimate);

// Protect all other AI routes
router.use(authMiddleware);

router.get("/baseline-display-names", getBaselineDisplayNames);
router.post("/analyze", analyzeRequirements);
router.post("/parse-conversation", parseConversation);
router.post("/estimate-modules", estimateModules);
router.post("/refine-estimate", refineEstimate);
router.post("/translate-quote", translateQuote);
router.post("/refine-quote", refineQuote);
router.post("/refine-proposal-section", refineProposalSection);
router.post("/refine-rough-estimate", refineRoughEstimate);

export default router;
