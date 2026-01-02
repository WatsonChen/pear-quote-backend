import pkg from "pg";
const { Client } = pkg;
import dotenv from "dotenv";

dotenv.config();

async function testConnection() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log(
      "Connecting to:",
      process.env.DATABASE_URL.replace(/:([^:@]+)@/, ":****@")
    );
    await client.connect();
    console.log("Connected successfully!");
    const res = await client.query(
      "SELECT current_database(), current_user, version();"
    );
    console.log("Query result:", res.rows[0]);
    await client.end();
  } catch (err) {
    console.error("Connection failed:", err.message);
    if (err.message.includes("Tenant or user not found")) {
      console.error(
        "HINT: This error often means the Supabase project is paused or the project ID is wrong."
      );
    }
  }
}

testConnection();
