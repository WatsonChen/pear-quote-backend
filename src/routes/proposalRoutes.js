// src/routes/proposalRoutes.js
import { Router } from "express";
import {
  acceptProposal,
  createPublicComment,
  getPublicProposal,
  listPublicComments,
  trackProposalAction,
  trackProposalSection,
  trackProposalView,
} from "../controllers/proposalController.js";
import { createRateLimiter } from "../middleware/rateLimit.js";

const router = Router();

const readLimit = createRateLimiter({ windowMs: 60_000, max: 120, keyPrefix: "read" });
const eventLimit = createRateLimiter({ windowMs: 60_000, max: 90, keyPrefix: "event" });
const commentLimit = createRateLimiter({ windowMs: 60_000, max: 5, keyPrefix: "comment" });
const acceptLimit = createRateLimiter({ windowMs: 60_000, max: 10, keyPrefix: "accept" });

router.get("/:shareToken", readLimit, getPublicProposal);
router.post("/:shareToken/view", eventLimit, trackProposalView);
router.post("/:shareToken/events", eventLimit, trackProposalSection);
router.post("/:shareToken/action", eventLimit, trackProposalAction);
router.get("/:shareToken/comments", readLimit, listPublicComments);
router.post("/:shareToken/comments", commentLimit, createPublicComment);
router.post("/:shareToken/accept", acceptLimit, acceptProposal);

export default router;
