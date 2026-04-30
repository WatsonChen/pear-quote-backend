import { Router } from "express";
import {
  acceptProposal,
  getPublicProposal,
  trackProposalView,
} from "../controllers/proposalController.js";

const router = Router();

router.get("/:shareToken", getPublicProposal);
router.post("/:shareToken/view", trackProposalView);
router.post("/:shareToken/accept", acceptProposal);

export default router;
