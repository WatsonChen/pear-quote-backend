import express from "express";
import {
  createTopupOrder,
  handleWebhook,
} from "../controllers/paymentController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

/**
 * @route POST /api/payments/topup
 * @desc Create ECPay AioCheckOut transaction
 * @access Private
 */
router.post("/topup", authMiddleware, createTopupOrder);

/**
 * @route POST /api/payments/webhook
 * @desc ECPay Server-to-Server return URL
 * @access Public
 */
router.post("/webhook", handleWebhook);

export default router;
