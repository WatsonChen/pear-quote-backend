// src/app.js
import express from "express";
import cors from "cors";
import quoteRoutes from "./routes/quoteRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import baseRoutes from "./routes/baseRoutes.js";

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Routes
app.use("/", baseRoutes);
app.use("/api", authRoutes);
app.use("/api/quotes", quoteRoutes);

export default app;
