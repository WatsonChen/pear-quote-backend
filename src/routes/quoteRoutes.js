// src/routes/quoteRoutes.js
import { Router } from "express";
import prisma from "../lib/prisma.js";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const { title, content } = req.body;

    if (!title) {
      return res.status(400).json({ error: "title is required" });
    }

    const quote = await prisma.quote.create({
      data: { title, content },
    });

    res.json(quote);
  } catch (err) {
    console.error("Error creating quote:", err);
    res.status(500).json({ error: "Failed to create quote" });
  }
});

export default router;
