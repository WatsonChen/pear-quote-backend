// src/app.js
import express from "express";
import cors from "cors";
import quoteRoutes from "./routes/quoteRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import aiRoutes from "./routes/aiRoutes.js";
import customerRoutes from "./routes/customerRoutes.js";
import settingsRoutes from "./routes/settingsRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import baseRoutes from "./routes/baseRoutes.js";
import analyticsRoutes from "./routes/analyticsRoutes.js";

const app = express();

// CORS configuration
const corsOptions = {
  origin: [
    "http://localhost:3000",
    "https://pear-quote-web.vercel.app",
    process.env.FRONTEND_URL,
  ].filter(Boolean),
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

// Middlewares
app.use(cors(corsOptions));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Routes
app.use("/", baseRoutes);
app.use("/api", authRoutes);
app.use("/api/quotes", quoteRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/users", userRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/analytics", analyticsRoutes);

// Swagger Documentation
import swaggerUi from "swagger-ui-express";
import swaggerSpec from "./config/swagger.js";

// Error handling middleware
app.use((err, req, res, next) => {
  if (err.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      message: "Payload too large. Please upload smaller images.",
    });
  }

  console.error("Server Error:", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

// Expose OpenAPI spec as JSON at root level
app.get("/doc.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(null, {
    explorer: true,
    swaggerOptions: {
      urls: [
        {
          url: "/doc.json",
          name: "Pear Backend API",
        },
      ],
    },
  }),
);

export default app;
