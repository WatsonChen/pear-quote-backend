// server.js - touched for restart
import dotenv from "dotenv";

// Load environment variables based on NODE_ENV
const env = process.env.NODE_ENV || "development";
const envFile = env === "production" ? ".env.production" : ".env.development";
dotenv.config({ path: envFile });

const { default: app } = await import("./src/app.js");

const PORT = process.env.PORT || 3001;

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`Backend listening on port ${PORT}`);
  });
}

export default app;
