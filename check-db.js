import dotenv from "dotenv";
dotenv.config();
import prisma from "./src/lib/prisma.js";

async function main() {
  const users = await prisma.user.findMany();
  console.log("--- Users ---");
  console.log(users.map((u) => ({ id: u.id, email: u.email })));

  const customers = await prisma.customer.findMany();
  console.log("--- Customers ---");
  console.log(customers.map((c) => ({ id: c.id, name: c.name })));

  const settings = await prisma.systemSettings.findMany();
  console.log("--- Settings ---");
  console.log(settings.map((s) => ({ id: s.id, companyName: s.companyName })));

  const quotes = await prisma.quote.findMany({
    select: {
      id: true,
      projectName: true,
      userId: true,
    },
  });
  console.log("--- Quotes ---");
  console.log(quotes);
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());
