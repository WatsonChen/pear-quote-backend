// src/routes/quoteRoutes.js
import { Router } from "express";
import {
  createQuote,
  getQuotes,
  getQuoteById,
  updateQuote,
  deleteQuote,
} from "../controllers/quoteController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();

// All routes require authentication
router.use(authMiddleware);

router.post("/", createQuote);
router.get("/", getQuotes);
router.get("/:id", getQuoteById);
router.put("/:id", updateQuote);
router.delete("/:id", deleteQuote);

export default router;
