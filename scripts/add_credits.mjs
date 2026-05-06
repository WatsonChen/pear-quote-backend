import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.development" });

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const email = "chenpkpk@gmail.com";
const creditsToAdd = 10000;

// Find user
const userRes = await pool.query(`SELECT id, email FROM "User" WHERE email = $1`, [email]);
if (userRes.rows.length === 0) {
  console.error(`User not found: ${email}`);
  await pool.end();
  process.exit(1);
}
const user = userRes.rows[0];
console.log(`Found user: ${user.id} (${user.email})`);

// Find workspaces
const wsRes = await pool.query(
  `SELECT wu."workspaceId", w."creditBalance" FROM "WorkspaceUser" wu JOIN "Workspace" w ON w.id = wu."workspaceId" WHERE wu."userId" = $1`,
  [user.id]
);
console.log(`Workspaces: ${wsRes.rows.length}`);

for (const row of wsRes.rows) {
  const newBalance = row.creditBalance + creditsToAdd;
  await pool.query(`UPDATE "Workspace" SET "creditBalance" = $1 WHERE id = $2`, [newBalance, row.workspaceId]);
  console.log(`Workspace ${row.workspaceId}: ${row.creditBalance} -> ${newBalance} credits`);
}

await pool.end();
