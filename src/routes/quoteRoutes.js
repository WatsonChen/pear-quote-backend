// src/routes/quoteRoutes.js
import { Router } from "express";
import {
  createQuote,
  getQuotes,
  getQuoteById,
  updateQuote,
  deleteQuote,
  exportQuote,
  generateQuote,
} from "../controllers/quoteController.js";
import {
  getProposalActivity,
  replyToProposalComment,
} from "../controllers/proposalController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();

// All routes require authentication
router.use(authMiddleware);

router.post("/", createQuote);
router.get("/", getQuotes);
router.get("/:id", getQuoteById);
router.put("/:id", updateQuote);
router.delete("/:id", deleteQuote);
router.post("/:id/export", exportQuote);
router.post("/:id/generate", generateQuote);
router.get("/:id/proposal-activity", getProposalActivity);
router.post("/:id/proposal-comments", replyToProposalComment);

export default router;
