import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

const env = process.env.NODE_ENV || "development";
const envFile = env === "production" ? ".env.production" : ".env.development";
dotenv.config({ path: envFile });

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url:
      process.env.DATABASE_URL ||
      "postgresql://dummy:dummy@localhost:5432/dummy",
  },
});
