import { createHash, timingSafeEqual } from "node:crypto";

export const INTERNAL_AUTH_HEADER = "x-internal-auth";

function digest(value) {
  return createHash("sha256").update(String(value)).digest();
}

/**
 * Restricts an endpoint to the trusted Next.js server, which holds
 * INTERNAL_AUTH_SECRET. Browsers and third parties never see the secret.
 *
 * Fails closed in production when the secret is not configured. Outside
 * production an unset secret only logs a warning so local development works
 * without extra setup.
 */
export function requireInternalAuth(req, res, next) {
  const secret = process.env.INTERNAL_AUTH_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error("[internalAuth] INTERNAL_AUTH_SECRET is not set; refusing request");
      return res.status(503).json({
        success: false,
        message: "Authentication is temporarily unavailable",
      });
    }

    console.warn("[internalAuth] INTERNAL_AUTH_SECRET is not set; allowing request (non-production)");
    return next();
  }

  const provided = req.headers[INTERNAL_AUTH_HEADER];
  const candidate = Array.isArray(provided) ? provided[0] : provided;

  if (typeof candidate !== "string" || !timingSafeEqual(digest(candidate), digest(secret))) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized",
    });
  }

  return next();
}
