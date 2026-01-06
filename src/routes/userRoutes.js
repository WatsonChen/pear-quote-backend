import { Router } from "express";
import {
    getUsers,
    createUser,
    getUserById,
    updateUser,
    deleteUser,
} from "../controllers/userController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();

// Protect all user routes
router.use(authMiddleware);

router.get("/", getUsers);
router.post("/", createUser);
router.get("/:id", getUserById);
router.put("/:id", updateUser);
router.delete("/:id", deleteUser);

export default router;
