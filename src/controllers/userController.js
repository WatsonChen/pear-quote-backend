import prisma from "../lib/prisma.js";
import bcrypt from "bcrypt";

// Helper to exclude password from user object
function excludePassword(user) {
  const { passwordHash, otpCode, otpExpiresAt, ...userWithoutPassword } = user;
  return userWithoutPassword;
}

/**
 * A user may only read, change or delete their own record.
 * Returns true when the request was rejected.
 */
function rejectIfNotSelf(req, res) {
  if (req.params.id === req.user?.userId) return false;

  res.status(403).json({ message: "Forbidden" });
  return true;
}

/**
 * Get user by ID
 * GET /api/users/:id
 */
export async function getUserById(req, res) {
  if (rejectIfNotSelf(req, res)) return;

  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json(excludePassword(user));
  } catch (error) {
    console.error("Get user error:", error);
    return res.status(500).json({ message: "Failed to fetch user" });
  }
}

/**
 * Update user
 * PUT /api/users/:id
 */
export async function updateUser(req, res) {
  if (rejectIfNotSelf(req, res)) return;

  try {
    const { id } = req.params;
    const { email, password } = req.body;

    const data = {};
    if (email) data.email = email;
    if (password) {
      data.passwordHash = await bcrypt.hash(password, 10);
    }

    const user = await prisma.user.update({
      where: { id },
      data,
    });

    return res.json(excludePassword(user));
  } catch (error) {
    console.error("Update user error:", error);
    return res.status(500).json({ message: "Failed to update user" });
  }
}

/**
 * Delete user
 * DELETE /api/users/:id
 */
export async function deleteUser(req, res) {
  if (rejectIfNotSelf(req, res)) return;

  try {
    const { id } = req.params;

    await prisma.user.delete({
      where: { id },
    });

    return res.json({ success: true, message: "User deleted" });
  } catch (error) {
    console.error("Delete user error:", error);
    return res.status(500).json({ message: "Failed to delete user" });
  }
}

/**
 * Phone verification is disabled: there is no OTP channel yet, and granting
 * credits for an unverified phone number let anyone mint free credits.
 * POST /api/users/verify-phone
 */
export async function verifyPhone(req, res) {
  return res.status(503).json({
    success: false,
    message: "Phone verification is temporarily unavailable",
    errorCode: "PHONE_VERIFICATION_UNAVAILABLE",
  });
}
