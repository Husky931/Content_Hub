import { NextRequest } from "next/server";
import { POST } from "@/app/api/auth/forgot-password/route";

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock("@/db", () => ({
  db: { select: jest.fn(), insert: jest.fn() },
}));
jest.mock("@/lib/email", () => ({
  sendPasswordResetEmail: jest.fn().mockResolvedValue({ success: true }),
}));

import { db } from "@/db";
import { sendPasswordResetEmail } from "@/lib/email";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(body: object) {
  return new NextRequest("http://localhost/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function mockSelect(rows: object[]) {
  const limitMock = jest.fn().mockResolvedValue(rows);
  const whereMock = jest.fn().mockReturnValue({ limit: limitMock });
  const fromMock = jest.fn().mockReturnValue({ where: whereMock });
  (db.select as jest.Mock).mockReturnValueOnce({ from: fromMock });
}

function mockInsert() {
  const valuesMock = jest.fn().mockResolvedValue([]);
  (db.insert as jest.Mock).mockReturnValueOnce({ values: valuesMock });
}

beforeEach(() => jest.clearAllMocks());

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/auth/forgot-password", () => {
  it("returns 400 when email is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("required") });
  });

  it("returns success even when user does not exist", async () => {
    mockSelect([]); // no user found
    const res = await POST(makeRequest({ email: "nobody@example.com" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toMatch(/password reset/i);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("creates reset token and sends email for existing user", async () => {
    mockSelect([{ id: "u1", email: "test@test.com" }]); // user found
    mockInsert(); // insert token

    const res = await POST(makeRequest({ email: "test@test.com" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toMatch(/password reset/i);
    expect(db.insert).toHaveBeenCalled();
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(
      "test@test.com",
      expect.any(String)
    );
  });

  it("returns success even when email sending fails", async () => {
    mockSelect([{ id: "u1", email: "test@test.com" }]); // user found
    mockInsert(); // insert token
    (sendPasswordResetEmail as jest.Mock).mockResolvedValueOnce({ success: false, error: "smtp error" });

    const res = await POST(makeRequest({ email: "test@test.com" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toMatch(/password reset/i);
  });
});
