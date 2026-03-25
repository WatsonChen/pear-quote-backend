// src/routes/quoteRoutes.js
import { Router } from "express";
import {
  createQuote,
  getQuotes,
  getQuoteById,
  updateQuote,
  deleteQuote,
  generateQuote,
  exportQuotePremium,
} from "../controllers/quoteController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { requirePremiumSubscription } from "../middleware/subscriptionMiddleware.js";

const router = Router();

// Protect quote routes
router.use(authMiddleware);

router.post("/", createQuote);
router.get("/", getQuotes);
router.get("/:id", getQuoteById);
router.put("/:id", updateQuote);
router.delete("/:id", deleteQuote);
router.post("/:id/generate", generateQuote);

// Premium export feature
router.post("/:id/export", requirePremiumSubscription, exportQuotePremium);

export default router;
