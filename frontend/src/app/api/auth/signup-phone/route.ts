import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, inviteCodes, sessions } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { verifyOtp } from "@/lib/otp-store";
import { createJWT } from "@/lib/auth-edge";
import { hashSync } from "bcryptjs";

export async function POST(req: NextRequest) {
  try {
    const { phone, otp, username, inviteCode } = await req.json();

    if (!phone || !otp || !username || !inviteCode) {
      return NextResponse.json(
        { error: "Phone, OTP, username, and invite code are required" },
        { status: 400 }
      );
    }

    // Validate phone
    const cleaned = phone.replace(/\s/g, "").replace(/^\+?86/, "");
    const phoneRegex = /^1[3-9]\d{9}$/;
    if (!phoneRegex.test(cleaned)) {
      return NextResponse.json({ error: "Invalid Chinese phone number" }, { status: 400 });
    }

    // Validate username
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!usernameRegex.test(username)) {
      return NextResponse.json(
        { error: "Username must be 3-20 characters, alphanumeric and underscores only" },
        { status: 400 }
      );
    }

    // Verify OTP
    const otpResult = verifyOtp(cleaned, otp);
    if (otpResult !== true) {
      return NextResponse.json({ error: otpResult }, { status: 400 });
    }

    // Validate invite code
    const [code] = await db
      .select()
      .from(inviteCodes)
      .where(
        and(
          eq(inviteCodes.code, inviteCode.toUpperCase()),
          eq(inviteCodes.status, "active")
        )
      )
      .limit(1);

    if (!code || code.useCount >= code.maxUses || (code.expiresAt && code.expiresAt < new Date())) {
      return NextResponse.json({ error: "Invalid or expired invite code" }, { status: 400 });
    }

    // Check if phone already registered
    const [existingPhone] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.phone, cleaned))
      .limit(1);

    if (existingPhone) {
      return NextResponse.json({ error: "Phone number already registered" }, { status: 409 });
    }

    // Check if username taken
    const [existingUsername] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username.toLowerCase()))
      .limit(1);

    if (existingUsername) {
      return NextResponse.json({ error: "Username already taken" }, { status: 409 });
    }

    // Create user — phone-verified users are immediately "verified"
    // Use a placeholder email and random password hash (phone-only users don't need these)
    const placeholderEmail = `${cleaned}@phone.local`;
    const [newUser] = await db
      .insert(users)
      .values({
        email: placeholderEmail,
        username: username.toLowerCase(),
        passwordHash: hashSync(crypto.randomUUID(), 12),
        phone: cleaned,
        role: "creator",
        status: "verified",
        displayName: username,
      })
      .returning({ id: users.id });

    // Atomically increment invite code usage (prevents race condition)
    const [updated] = await db
      .update(inviteCodes)
      .set({
        useCount: sql`${inviteCodes.useCount} + 1`,
        usedById: newUser.id,
        status: sql`(CASE WHEN ${inviteCodes.useCount} + 1 >= ${code.maxUses} THEN 'used' ELSE 'active' END)::invite_status`,
      })
      .where(
        and(
          eq(inviteCodes.id, code.id),
          sql`${inviteCodes.useCount} < ${code.maxUses}`
        )
      )
      .returning({ id: inviteCodes.id });

    if (!updated) {
      await db.delete(users).where(eq(users.id, newUser.id));
      return NextResponse.json(
        { error: "Invite code has reached its usage limit" },
        { status: 400 }
      );
    }

    // Issue JWT session
    const { token, jti, expiresAt } = await createJWT({
      userId: newUser.id,
      role: "creator",
    });

    // Store session for invalidation
    await db.insert(sessions).values({
      userId: newUser.id,
      tokenJti: jti,
      expiresAt,
    });

    const response = NextResponse.json(
      { message: "Account created successfully", userId: newUser.id },
      { status: 201 }
    );
    response.cookies.set("auth_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("[signup-phone] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
