import { Router } from "express";
import {
  getUserById,
  updateUser,
  deleteUser,
  verifyPhone,
} from "../controllers/userController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();

// Protect all user routes
router.use(authMiddleware);

// There is deliberately no user listing or creation endpoint: users are created
// by the sign-in flow, and no client may enumerate other users.
router.post("/verify-phone", verifyPhone); // Must be before /:id routes
router.get("/:id", getUserById);
router.put("/:id", updateUser);
router.delete("/:id", deleteUser);

export default router;
