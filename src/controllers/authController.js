// src/controllers/authController.js
import {
  sendLoginCode,
  verifyPassword,
  getUserById,
  socialLogin,
} from "../services/authService.js";

/**
 * Send login verification code
 * POST /api/auth/send-code
 */
export async function handleSendCode(req, res) {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    await sendLoginCode(email);

    return res.json({
      success: true,
      message: "Verification code sent",
    });
  } catch (error) {
    console.error("Send code error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

/**
 * Handle login (password)
 * POST /api/login
 */
export async function handleLogin(req, res) {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // Attempt login
    const result = await verifyPassword(email, password);

    return res.json({
      success: true,
      token: result.token,
      user: result.user,
    });
  } catch (error) {
    // Check for specific errors
    if (error.message === "Invalid email or password") {
      return res.status(401).json({
        success: false,
        message: error.message,
      });
    }

    // Server error
    console.error("Login error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

/**
 * Handle Social Login
 * POST /api/social-login
 */
export async function handleSocialLogin(req, res) {
  console.log("[Auth] handleSocialLogin called with body:", req.body);
  try {
    const { email } = req.body;

    if (!email) {
      console.log("[Auth] Email missing in body");
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const result = await socialLogin(email);
    console.log("[Auth] socialLogin success for:", email);

    return res.json({
      success: true,
      token: result.token,
      user: result.user,
    });
  } catch (error) {
    console.error("Social login error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

/**
 * Handle get current user request
 * GET /api/me
 * Requires authMiddleware
 */
export async function handleGetMe(req, res) {
  try {
    // req.user is injected by authMiddleware
    const { userId } = req.user;

    const user = await getUserById(userId);

    return res.json(user);
  } catch (error) {
    console.error("Get me error:", error);

    if (error.message === "User not found") {
      return res.status(401).json({
        success: false,
        message: "User session invalid or user not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}
