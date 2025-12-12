#!/usr/bin/env node
// scripts/createTestUser.js
// Usage: node scripts/createTestUser.js [email] [password]

import "dotenv/config";
import { createUser } from "../src/services/authService.js";

const [email, password] = process.argv.slice(2);

if (!email || !password) {
  console.error("Usage: node scripts/createTestUser.js [email] [password]");
  console.error(
    "Example: node scripts/createTestUser.js test@example.com password123"
  );
  process.exit(1);
}

async function main() {
  try {
    console.log(`Creating user with email: ${email}`);
    const user = await createUser(email, password);
    console.log("✅ User created successfully:");
    console.log(JSON.stringify(user, null, 2));
  } catch (error) {
    console.error("❌ Error creating user:", error.message);
    process.exit(1);
  }
}

main();
