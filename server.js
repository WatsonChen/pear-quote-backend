// server.js
import "dotenv/config"; // ← 新增這行，讓 process.env 載入 .env

import app from "./src/app.js";

const PORT = process.env.PORT || 3001;

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`Backend listening on port ${PORT}`);
  });
}

export default app;
