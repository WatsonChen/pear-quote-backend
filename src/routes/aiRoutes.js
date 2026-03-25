import { Router } from "express";
import { analyzeRequirements, generateCustomerSummary, translateQuote, refineQuote } from "../controllers/aiController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();

// Protect AI routes
router.use(authMiddleware);

router.post("/analyze", analyzeRequirements);
router.post("/customer-summary", generateCustomerSummary);
router.post("/translate-quote", translateQuote);
router.post("/refine-quote", refineQuote);

export default router;
