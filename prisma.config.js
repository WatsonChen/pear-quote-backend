import dotenv from "dotenv";
import { defineConfig } from "prisma/config";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const env = process.env.NODE_ENV || "development";
const envFile = env === "production" ? ".env.production" : ".env.development";
dotenv.config({ path: path.join(__dirname, envFile), quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url:
      process.env.DATABASE_URL ||
      "postgresql://dummy:dummy@localhost:5432/dummy",
  },
});
