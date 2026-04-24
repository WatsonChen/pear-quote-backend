// server.js - touched for restart
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables based on NODE_ENV
const env = process.env.NODE_ENV || "development";
const envFile = env === "production" ? ".env.production" : ".env.development";
dotenv.config({ path: path.join(__dirname, envFile), quiet: true });

const { default: app } = await import("./src/app.js");

const PORT = process.env.PORT || 3001;
const hasGeminiKey = Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim());

if (!hasGeminiKey) {
  console.warn(
    `[AI] GOOGLE_GENERATIVE_AI_API_KEY is missing (env=${env}). rough-estimate and analyze endpoints will fail.`,
  );
} else {
  console.log(`[AI] Gemini key loaded (env=${env}).`);
}

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`Backend listening on port ${PORT}`);
  });
}

export default app;
