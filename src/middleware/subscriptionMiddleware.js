import { SUBSCRIPTION_PLANS } from "../config/pricing.config.js";

/**
 * Middleware wrapper to ensure the requested action is allowed
 * only for workspaces that have a 'PREMIUM' (or higher) subscription plan.
 * 
 * Assumes authMiddleware has run before and injected req.workspace.
 */
export const requirePremiumSubscription = (req, res, next) => {
  try {
    const workspace = req.workspace;

    if (!workspace) {
      return res.status(403).json({
        success: false,
        message: "No workspace context found to verify subscription.",
      });
    }

    if (workspace.subscriptionPlan !== SUBSCRIPTION_PLANS.PREMIUM) {
      return res.status(403).json({
        success: false,
        message: "This feature requires a PREMIUM subscription.",
        requiredPlan: SUBSCRIPTION_PLANS.PREMIUM,
        currentPlan: workspace.subscriptionPlan,
      });
    }

    next();
  } catch (error) {
    console.error("Subscription middleware error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error during subscription verification.",
    });
  }
};
