// src/app.js
import express from "express";
import cors from "cors";
import quoteRoutes from "./routes/quoteRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import baseRoutes from "./routes/baseRoutes.js";

const app = express();

// CORS configuration
const corsOptions = {
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

// Middlewares
app.use(cors(corsOptions));
app.use(express.json());

// Routes
app.use("/", baseRoutes);
app.use("/api", authRoutes);
app.use("/api/quotes", quoteRoutes);

// Swagger Documentation
import swaggerUi from "swagger-ui-express";
import swaggerSpec from "./config/swagger.js";

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
  })
);

export default app;
