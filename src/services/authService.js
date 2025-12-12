// src/services/authService.js
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { signToken } from "../lib/jwt.js";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

const BCRYPT_ROUNDS = 10;

/**
 * Login user with email and password
 * @param {string} email - User email
 * @param {string} password - Plain text password
 * @returns {Promise<{token: string, user: {id: string, email: string}}>}
 * @throws {Error} If credentials are invalid
 */
export async function login(email, password) {
  // Find user by email
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw new Error("Invalid email or password");
  }

  // Verify password
  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

  if (!isPasswordValid) {
    throw new Error("Invalid email or password");
  }

  // Generate JWT token
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
 * @param {string} userId - User ID
 * @returns {Promise<{id: string, email: string, createdAt: Date}>}
 * @throws {Error} If user not found
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

/**
 * Create a new user (for testing purposes)
 * @param {string} email - User email
 * @param {string} password - Plain text password
 * @returns {Promise<{id: string, email: string}>}
 */
export async function createUser(email, password) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
    },
    select: {
      id: true,
      email: true,
    },
  });

  return user;
}
