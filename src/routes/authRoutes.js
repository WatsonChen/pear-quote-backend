// src/routes/authRoutes.js
import { Router } from "express";
import {
  handleLogin,
  handleGetMe,
  handleSocialLogin,
  handleAcceptTerms,
} from "../controllers/authController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { requireInternalAuth } from "../middleware/internalAuth.js";

const router = Router();

// Public routes
router.post("/login", handleLogin);
// Trusted server-to-server only: the Next.js server vouches for a verified OAuth email.
router.post("/social-login", requireInternalAuth, handleSocialLogin);

// Protected routes (require authentication)
router.get("/me", authMiddleware, handleGetMe);
router.post("/me/terms-acceptance", authMiddleware, handleAcceptTerms);

export default router;
