// src/routes/quoteRoutes.js
import { Router } from "express";
import {
  createQuote,
  getQuotes,
  getQuoteById,
} from "../controllers/quoteController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();

// All routes require authentication
router.use(authMiddleware);

router.post("/", createQuote);
router.get("/", getQuotes);
router.get("/:id", getQuoteById);

export default router;
