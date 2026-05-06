// src/services/authService.js
import prisma from "../lib/prisma.js";
import { signToken } from "../lib/jwt.js";
import crypto from "crypto";
import bcrypt from "bcrypt"; // Keep for createUser if needed for tests, but mainly unused

export const CURRENT_TERMS_VERSION = "2026-03-26";

/**
 * Generate a random 6-digit numeric code
 */
function generateOTP() {
  return crypto.randomInt(100000, 999999).toString();
}

function buildAuthUser(user, workspace) {
  return {
    id: user.id,
    email: user.email,
    workspaceId: workspace.id,
    bookingUrl: user.bookingUrl,
    termsAcceptedAt: user.termsAcceptedAt,
    termsVersionAccepted: user.termsVersionAccepted,
    currentTermsVersion: CURRENT_TERMS_VERSION,
  };
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
 * Verify email and password
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{token: string, user: {id: string, email: string}}>}
 */
export async function verifyPassword(email, password) {
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user || !user.passwordHash) {
    throw new Error("Invalid email or password");
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);

  if (!isValid) {
    throw new Error("Invalid email or password");
  }

  // Ensure workspace exists
  const workspace = await ensureUserWorkspace(user.id, user.email);

  // Generate Token
  const token = signToken({
    userId: user.id,
    email: user.email,
  });

  return {
    token,
    user: buildAuthUser(user, workspace),
  };
}

/**
 * Ensures the user has at least one workspace. If not, creates a default one.
 */
async function ensureUserWorkspace(userId, email) {
  const existingLinks = await prisma.workspaceUser.findMany({
    where: { userId },
    include: { workspace: true },
  });

  if (existingLinks.length > 0) {
    return existingLinks[0].workspace;
  }

  const workspaceName = email.split("@")[0] + "'s Workspace";
  const workspace = await prisma.workspace.create({
    data: {
      name: workspaceName,
      subscriptionPlan: "FREE",
      creditBalance: 20, // Initial free trial credits
      users: {
        create: {
          userId,
          role: "OWNER",
        },
      },
    },
  });
  return workspace;
}

/**
 * Temp: Create user for seeding
 */
export async function createUser(email, password) {
  const passwordHash = await bcrypt.hash(password, 10);
  return prisma.user.create({
    data: {
      email,
      passwordHash,
    },
  });
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
      bookingUrl: true,
      phoneNumber: true,
      termsAcceptedAt: true,
      termsVersionAccepted: true,
      createdAt: true,
      workspaces: {
        include: {
          workspace: true,
        },
      },
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  return {
    ...user,
    currentTermsVersion: CURRENT_TERMS_VERSION,
  };
}

/**
 * Mark the current user as having accepted the current terms version.
 */
export async function acceptCurrentTerms(userId) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      termsAcceptedAt: new Date(),
      termsVersionAccepted: CURRENT_TERMS_VERSION,
    },
  });

  return getUserById(userId);
}

/**
 * Handle Social Login (Find or Create User)
 * @param {string} email
 * @returns {Promise<{token: string, user: {id: string, email: string}}>}
 */
export async function socialLogin(email) {
  // Find or Create User
  const user = await prisma.user.upsert({
    where: { email },
    update: {}, // No updates needed if exists
    create: {
      email,
      // No password, no OTP
    },
  });

  // Ensure workspace exists
  const workspace = await ensureUserWorkspace(user.id, user.email);

  // Generate Token
  const token = signToken({
    userId: user.id,
    email: user.email,
  });

  return {
    token,
    user: buildAuthUser(user, workspace),
  };
}
