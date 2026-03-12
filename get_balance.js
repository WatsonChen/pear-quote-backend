const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const workspaces = await prisma.workspace.findMany()
  console.log(workspaces)
}
main().catch(e => console.error(e)).finally(() => prisma.$disconnect())
