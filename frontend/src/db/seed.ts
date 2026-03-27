import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { hashSync } from "bcryptjs";
import { eq } from "drizzle-orm";
import { users } from "./schema";

async function seed() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const DOMAIN = process.env.DOMAIN || process.env.NEXT_PUBLIC_APP_URL?.replace(/^https?:\/\//, "") || "localhost";
  const ADMIN_EMAIL = `admin@${DOMAIN}`;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || generatePassword();

  const sql = postgres(DATABASE_URL);
  const db = drizzle(sql);

  console.log("Seeding database (idempotent)...\n");

  // ============================================================
  // 1. ADMIN USER (upsert)
  // ============================================================
  console.log("Admin user...");
  const [existingAdmin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "admin"))
    .limit(1);

  if (existingAdmin) {
    console.log("  Admin already exists, skipping");
  } else {
    const [admin] = await db
      .insert(users)
      .values({
        email: ADMIN_EMAIL,
        username: "admin",
        passwordHash: hashSync(ADMIN_PASSWORD, 12),
        role: "admin",
        status: "verified",
        displayName: "System Admin",
        onboardingCompleted: true,
        currency: "usd",
      })
      .returning();
    console.log(`  Created: ${admin.email}`);
    console.log(`  Password: ${ADMIN_PASSWORD}`);
    console.log(`  ⚠ Save this password — it will not be shown again.`);
  }

  console.log("\nSeed completed successfully!");
}

function generatePassword(): string {
  const chars = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*";
  const bytes = require("crypto").randomBytes(20);
  return Array.from(bytes as Uint8Array).map((b) => chars[b % chars.length]).join("");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
