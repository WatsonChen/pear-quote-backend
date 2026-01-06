import { createUser } from "../src/services/authService.js";
import { prisma } from "../src/lib/prisma.js";

async function main() {
    try {
        console.log("Seeding user...");
        const email = "admin@pear.com";
        const password = "password123";

        // Check if exists
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
            console.log(`User ${email} already exists.`);
            return;
        }

        const user = await createUser(email, password);
        console.log("User created successfully:", user);
    } catch (e) {
        console.error("Seed error:", e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
