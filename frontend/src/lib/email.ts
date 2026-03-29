/**
 * Email service using Resend SDK.
 *
 * Requires environment variables:
 *   RESEND_API_KEY - Your Resend API key (starts with re_)
 *   NEXT_PUBLIC_APP_URL - Base URL for links in emails (e.g. http://localhost:3000)
 */

import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// Default "from" address — use onboarding@resend.dev if no custom domain verified
// For production, verify a domain at https://resend.com/domains
const FROM_EMAIL = process.env.EMAIL_FROM || "Content Creator Hub <onboarding@resend.dev>";

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: SendEmailParams): Promise<{ success: boolean; error?: string }> {
  if (!resend) {
    console.error("[email] RESEND_API_KEY not set — cannot send email");
    return { success: false, error: "Email service not configured (RESEND_API_KEY missing)" };
  }

  const { data, error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: [to],
    subject,
    html,
  });

  if (error) {
    console.error("[email] Resend API error:", error);
    return { success: false, error: error.message || "Failed to send email" };
  }

  console.log("[email] Sent successfully:", data?.id);
  return { success: true };
}

/**
 * Send password reset email.
 */
export async function sendPasswordResetEmail(email: string, token: string): Promise<{ success: boolean; error?: string }> {
  const resetUrl = `${APP_URL}/reset-password?token=${token}`;

  return sendEmail({
    to: email,
    subject: "Reset your Content Creator Hub password",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #5865f2; font-size: 24px;">Content Creator Hub</h1>
        <p style="color: #333; font-size: 16px;">We received a request to reset your password. Click the link below to set a new password:</p>
        <a href="${resetUrl}" style="display: inline-block; background: #5865f2; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; margin: 16px 0;">
          Reset Password
        </a>
        <p style="color: #666; font-size: 14px;">Or copy and paste this URL into your browser:</p>
        <p style="color: #5865f2; font-size: 14px; word-break: break-all;">${resetUrl}</p>
        <p style="color: #999; font-size: 12px; margin-top: 24px;">This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.</p>
      </div>
    `,
  });
}

/**
 * Send verification email to a new user.
 */
export async function sendVerificationEmail(email: string, token: string): Promise<{ success: boolean; error?: string }> {
  const verifyUrl = `${APP_URL}/api/auth/verify?token=${token}`;

  return sendEmail({
    to: email,
    subject: "Verify your Content Creator Hub account",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #5865f2; font-size: 24px;">Content Creator Hub</h1>
        <p style="color: #333; font-size: 16px;">Welcome! Click the link below to verify your email address:</p>
        <a href="${verifyUrl}" style="display: inline-block; background: #5865f2; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; margin: 16px 0;">
          Verify Email
        </a>
        <p style="color: #666; font-size: 14px;">Or copy and paste this URL into your browser:</p>
        <p style="color: #5865f2; font-size: 14px; word-break: break-all;">${verifyUrl}</p>
        <p style="color: #999; font-size: 12px; margin-top: 24px;">This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.</p>
      </div>
    `,
  });
}
