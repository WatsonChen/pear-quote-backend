// src/routes/authRoutes.js
import { Router } from "express";
import {
  handleLogin,
  handleSendCode,
  handleGetMe,
  handleSocialLogin,
  handleAcceptTerms,
} from "../controllers/authController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();

// Public routes
router.post("/sentotp", handleSendCode);
router.post("/login", handleLogin);
router.post("/social-login", handleSocialLogin);

// Protected routes (require authentication)
router.get("/me", authMiddleware, handleGetMe);
router.post("/me/terms-acceptance", authMiddleware, handleAcceptTerms);

export default router;
