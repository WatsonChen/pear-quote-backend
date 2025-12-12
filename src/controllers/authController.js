// src/controllers/authController.js
import { login, getUserById } from "../services/authService.js";

/**
 * Handle login request
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
    const result = await login(email, password);

    return res.json({
      success: true,
      token: result.token,
      user: result.user,
    });
  } catch (error) {
    // Check if it's an authentication error
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
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}
