import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const workspaces = await prisma.workspace.findMany();
  console.log("Workspaces:");
  workspaces.forEach((w) => {
    console.log(`- ID: ${w.id}, Name: ${w.name}, Balance: ${w.creditBalance}`);
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
