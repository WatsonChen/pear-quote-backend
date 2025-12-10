// src/routes/quoteRoutes.js
import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });
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
