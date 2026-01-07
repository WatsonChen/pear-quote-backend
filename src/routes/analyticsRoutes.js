import { Router } from "express";
import {
  getAnalyticsMetrics,
  getAnalyticsProjects,
  postAnalyticsInsight,
} from "../controllers/analyticsController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = Router();

router.use(authMiddleware);

router.get("/metrics", getAnalyticsMetrics);
router.get("/projects", getAnalyticsProjects);
router.post("/insight", postAnalyticsInsight);

export default router;
