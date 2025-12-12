// src/services/authService.js
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { signToken } from "../lib/jwt.js";
import crypto from "crypto";
import bcrypt from "bcrypt"; // Keep for createUser if needed for tests, but mainly unused

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

/**
 * Generate a random 6-digit numeric code
 */
function generateOTP() {
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * Send a login code to the given email
 * @param {string} email
 * @returns {Promise<void>}
 */
export async function sendLoginCode(email) {
  const code = generateOTP();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now

  // Upsert user: create if not exists, otherwise update OTP
  // Note: We don't require a password anymore.
  await prisma.user.upsert({
    where: { email },
    update: {
      otpCode: code,
      otpExpiresAt: expiresAt,
    },
    create: {
      email,
      otpCode: code,
      otpExpiresAt: expiresAt,
      // passwordHash is optional now, so we can omit it or set null
    },
  });

  // TODO: Integrate with a real email service (e.g., SendGrid, AWS SES)
  console.log(`[MOCK EMAIL] Login code for ${email}: ${code}`);
}

/**
 * Verify the login code and return a token
 * @param {string} email
 * @param {string} code
 * @returns {Promise<{token: string, user: {id: string, email: string}}>}
 */
export async function verifyLoginCode(email, code) {
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw new Error("Invalid email or code");
  }

  if (!user.otpCode || !user.otpExpiresAt) {
    throw new Error("Invalid email or code");
  }

  // Check if code matches
  if (user.otpCode !== code) {
    throw new Error("Invalid email or code");
  }

  // Check if expired
  if (new Date() > user.otpExpiresAt) {
    throw new Error("Code has expired");
  }

  // Clear OTP after successful use
  await prisma.user.update({
    where: { id: user.id },
    data: {
      otpCode: null,
      otpExpiresAt: null,
    },
  });

  // Generate Token
  const token = signToken({
    userId: user.id,
    email: user.email,
  });

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
    },
  };
}

/**
 * Get user by ID
 */
export async function getUserById(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  return user;
}
