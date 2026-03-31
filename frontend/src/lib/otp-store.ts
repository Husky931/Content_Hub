/**
 * In-memory OTP store with TTL.
 * Good enough for single-server dev/staging.
 * For production with multiple instances, swap for Redis or a DB table.
 */

interface OtpEntry {
  code: string;
  expiresAt: number;
  attempts: number; // brute-force protection
}

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_VERIFY_ATTEMPTS = 5;
const RATE_LIMIT_MS = 60 * 1000; // 1 minute between sends

// Attach to globalThis so the store survives Next.js HMR in development
const globalForOtp = globalThis as unknown as {
  __otpStore?: Map<string, OtpEntry>;
  __otpLastSent?: Map<string, number>;
};

const store = (globalForOtp.__otpStore ??= new Map<string, OtpEntry>());
const lastSent = (globalForOtp.__otpLastSent ??= new Map<string, number>());

/** Generate a 6-digit OTP code */
export function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Store an OTP for a phone number.
 * Returns null on success, or an error string if rate-limited.
 */
export function storeOtp(phone: string, code: string): string | null {
  const now = Date.now();
  const last = lastSent.get(phone);
  if (last && now - last < RATE_LIMIT_MS) {
    const wait = Math.ceil((RATE_LIMIT_MS - (now - last)) / 1000);
    return `Please wait ${wait} seconds before requesting another code`;
  }

  store.set(phone, { code, expiresAt: now + OTP_TTL_MS, attempts: 0 });
  lastSent.set(phone, now);
  return null;
}

/**
 * Verify an OTP for a phone number.
 * Returns true if valid, consumes the OTP.
 * Returns a string error message if invalid.
 */
export function verifyOtp(phone: string, code: string): true | string {
  const entry = store.get(phone);
  if (!entry) {
    return "No verification code found. Please request a new one.";
  }

  if (Date.now() > entry.expiresAt) {
    store.delete(phone);
    return "Verification code has expired. Please request a new one.";
  }

  if (entry.attempts >= MAX_VERIFY_ATTEMPTS) {
    store.delete(phone);
    return "Too many incorrect attempts. Please request a new code.";
  }

  if (entry.code !== code) {
    entry.attempts++;
    return "Incorrect verification code";
  }

  // Success — consume the OTP
  store.delete(phone);
  return true;
}

/** Clean up expired entries periodically */
setInterval(() => {
  const now = Date.now();
  for (const [phone, entry] of store) {
    if (now > entry.expiresAt) store.delete(phone);
  }
  for (const [phone, ts] of lastSent) {
    if (now - ts > OTP_TTL_MS) lastSent.delete(phone);
  }
}, 60_000);
