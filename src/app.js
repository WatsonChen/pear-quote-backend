// src/app.js
import express from "express";
import cors from "cors";
import quoteRoutes from "./routes/quoteRoutes.js";

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Basic test route
app.get("/", (req, res) => {
  res.send({ message: "PearQuote backend is running" });
});

// API routes
app.use("/api/quotes", quoteRoutes);

export default app;
