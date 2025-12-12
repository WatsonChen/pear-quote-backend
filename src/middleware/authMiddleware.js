// src/middleware/authMiddleware.js
import { verifyToken } from "../lib/jwt.js";

/**
 * Middleware to verify JWT token and authenticate user
 * Extracts token from Authorization header (Bearer token)
 * Injects user info into req.user
 */
export function authMiddleware(req, res, next) {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "No token provided",
      });
    }

    // Extract token from "Bearer <token>" format
    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return res.status(401).json({
        success: false,
        message: "Invalid token format. Expected 'Bearer <token>'",
      });
    }

    const token = parts[1];

    // Verify token
    const decoded = verifyToken(token);

    // Inject user info into request object
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: error.message || "Invalid or expired token",
    });
  }
}
