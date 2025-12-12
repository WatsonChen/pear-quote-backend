// src/lib/jwt.js
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = "7d"; // 7 days

if (!JWT_SECRET) {
  console.error(
    "❌ JWT_SECRET is not defined in environment variables. Please add it to your .env file."
  );
  process.exit(1);
}

/**
 * Generate a JWT token
 * @param {Object} payload - The data to encode in the token (e.g., { userId, email })
 * @returns {string} The signed JWT token
 */
export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Verify and decode a JWT token
 * @param {string} token - The JWT token to verify
 * @returns {Object} The decoded payload
 * @throws {Error} If token is invalid or expired
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      throw new Error("Token has expired");
    } else if (error.name === "JsonWebTokenError") {
      throw new Error("Invalid token");
    }
    throw error;
  }
}
