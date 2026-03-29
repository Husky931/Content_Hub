import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, inviteCodes, verificationTokens } from "@/db/schema";
import { hashPassword, generateVerificationToken } from "@/lib/auth";
import { sendVerificationEmail } from "@/lib/email";
import { eq, and, sql } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, username, password, inviteCode } = body;

    // Validate required fields
    if (!email || !username || !password || !inviteCode) {
      return NextResponse.json(
        { error: "All fields are required: email, username, password, inviteCode" },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      );
    }

    // Validate username (alphanumeric + underscores, 3-20 chars)
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!usernameRegex.test(username)) {
      return NextResponse.json(
        { error: "Username must be 3-20 characters, alphanumeric and underscores only" },
        { status: 400 }
      );
    }

    // Validate password (8+ chars)
    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    // Check invite code
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

    if (!code) {
      return NextResponse.json(
        { error: "Invalid or expired invite code" },
        { status: 400 }
      );
    }

    // Check if invite code has remaining uses
    if (code.useCount >= code.maxUses) {
      return NextResponse.json(
        { error: "Invite code has reached its usage limit" },
        { status: 400 }
      );
    }

    // Check expiration
    if (code.expiresAt && code.expiresAt < new Date()) {
      return NextResponse.json(
        { error: "Invite code has expired" },
        { status: 400 }
      );
    }

    // Check if email already exists
    const [existingEmail] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);

    if (existingEmail) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 409 }
      );
    }

    // Check if username already exists
    const [existingUsername] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username.toLowerCase()))
      .limit(1);

    if (existingUsername) {
      return NextResponse.json(
        { error: "Username already taken" },
        { status: 409 }
      );
    }

    // Create user in PENDING_VERIFICATION state
    const [newUser] = await db
      .insert(users)
      .values({
        email: email.toLowerCase(),
        username: username.toLowerCase(),
        passwordHash: hashPassword(password),
        role: "creator",
        status: "pending_verification",
        displayName: username,
      })
      .returning({ id: users.id, email: users.email });

    // Atomically increment invite code usage (prevents race condition)
    const [updated] = await db
      .update(inviteCodes)
      .set({
        useCount: sql`${inviteCodes.useCount} + 1`,
        usedById: newUser.id,
        status: sql`CASE WHEN ${inviteCodes.useCount} + 1 >= ${code.maxUses} THEN 'used' ELSE 'active' END`,
      })
      .where(
        and(
          eq(inviteCodes.id, code.id),
          sql`${inviteCodes.useCount} < ${code.maxUses}`
        )
      )
      .returning({ id: inviteCodes.id });

    if (!updated) {
      // Another request used the last slot — clean up the user we just created
      await db.delete(users).where(eq(users.id, newUser.id));
      return NextResponse.json(
        { error: "Invite code has reached its usage limit" },
        { status: 400 }
      );
    }

    // Generate verification token (24h TTL)
    const token = generateVerificationToken();
    await db.insert(verificationTokens).values({
      userId: newUser.id,
      token,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    // Send verification email via Resend
    const emailResult = await sendVerificationEmail(newUser.email, token);

    if (!emailResult.success) {
      console.error("[signup] Failed to send verification email:", emailResult.error);
    }

    const response: Record<string, string> = {
      message: emailResult.success
        ? "Account created! Check your email to verify your account."
        : "Account created, but we couldn't send the verification email. Please try again later.",
    };

    // Only expose verify URL in development
    if (process.env.NODE_ENV === "development") {
      response.devVerifyUrl = `${req.nextUrl.origin}/api/auth/verify?token=${token}`;
    }

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("Signup error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
