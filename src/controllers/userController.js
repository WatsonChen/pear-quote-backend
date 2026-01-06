import prisma from "../lib/prisma.js";
import bcrypt from "bcrypt";

// Helper to exclude password from user object
function excludePassword(user) {
    const { passwordHash, otpCode, otpExpiresAt, ...userWithoutPassword } = user;
    return userWithoutPassword;
}

/**
 * Get all users
 * GET /api/users
 */
export async function getUsers(req, res) {
    try {
        const users = await prisma.user.findMany({
            orderBy: { createdAt: "desc" },
        });

        return res.json(users.map(excludePassword));
    } catch (error) {
        console.error("Get users error:", error);
        return res.status(500).json({ message: "Failed to fetch users" });
    }
}

/**
 * Create a new user
 * POST /api/users
 */
export async function createUser(req, res) {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: "Email and password are required" });
        }

        const existingUser = await prisma.user.findUnique({
            where: { email },
        });

        if (existingUser) {
            return res.status(400).json({ message: "User already exists" });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const user = await prisma.user.create({
            data: {
                email,
                passwordHash,
            },
        });

        return res.status(201).json(excludePassword(user));
    } catch (error) {
        console.error("Create user error:", error);
        return res.status(500).json({ message: "Failed to create user" });
    }
}

/**
 * Get user by ID
 * GET /api/users/:id
 */
export async function getUserById(req, res) {
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
    try {
        const { id } = req.params;

        // Prevent deleting self? Maybe.
        if (req.user.userId === id) {
            // Optional safeguard
        }

        await prisma.user.delete({
            where: { id },
        });

        return res.json({ success: true, message: "User deleted" });
    } catch (error) {
        console.error("Delete user error:", error);
        return res.status(500).json({ message: "Failed to delete user" });
    }
}
