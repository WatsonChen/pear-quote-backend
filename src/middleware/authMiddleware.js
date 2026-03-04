import { verifyToken } from "../lib/jwt.js";
import prisma from "../lib/prisma.js";

/**
 * Middleware to verify JWT token and authenticate user
 * Extracts token from Authorization header (Bearer token)
 * Injects user info into req.user
 * Also extracts X-Workspace-Id and injects req.workspace
 */
export async function authMiddleware(req, res, next) {
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

    // Verify Workspace Access if X-Workspace-Id is provided
    let workspaceId = req.headers["x-workspace-id"];
    let workspaceUser;

    // Check for string "undefined" or "null" from localStorage issues
    if (workspaceId === "undefined" || workspaceId === "null") {
      workspaceId = undefined;
    }

    if (workspaceId) {
      workspaceUser = await prisma.workspaceUser.findUnique({
        where: {
          userId_workspaceId: {
            userId: decoded.userId,
            workspaceId: workspaceId,
          },
        },
        include: {
          workspace: true,
        },
      });
    } else {
      // Fallback is DANGEROUS for credit-based actions
      // However, to prevent breaking the entire app, we will still allow fallback
      // BUT we inject a flag to strictly warn endpoints like AI analysis.
      req.isFallbackWorkspace = true;

      const workspaces = await prisma.workspaceUser.findMany({
        where: { userId: decoded.userId },
        include: { workspace: true },
        take: 1,
      });
      if (workspaces.length > 0) {
        workspaceUser = workspaces[0];
      }
    }

    if (workspaceUser) {
      req.workspace = workspaceUser.workspace;
      req.workspaceRole = workspaceUser.role;
    } else {
      console.warn(`User ${decoded.userId} has no workspaces.`);
    }

    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    return res.status(401).json({
      success: false,
      message: error.message || "Invalid or expired token",
    });
  }
}
