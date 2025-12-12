import { Router } from "express";

const router = Router();

// Basic test route
router.get("/", (req, res) => {
  res.send({ message: "PearQuote backend is running" });
});

export default router;
