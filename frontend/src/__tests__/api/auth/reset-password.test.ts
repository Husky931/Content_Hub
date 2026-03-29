import { NextRequest } from "next/server";
import { POST } from "@/app/api/auth/reset-password/route";

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock("@/db", () => ({
  db: { select: jest.fn(), update: jest.fn(), delete: jest.fn() },
}));
jest.mock("@/lib/auth", () => ({
  hashPassword: jest.fn().mockReturnValue("hashed-password"),
}));

import { db } from "@/db";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(body: object) {
  return new NextRequest("http://localhost/api/auth/reset-password", {
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

function mockUpdate() {
  const whereMock = jest.fn().mockResolvedValue([]);
  const setMock = jest.fn().mockReturnValue({ where: whereMock });
  (db.update as jest.Mock).mockReturnValueOnce({ set: setMock });
}

function mockDelete() {
  const whereMock = jest.fn().mockResolvedValue([]);
  (db.delete as jest.Mock).mockReturnValueOnce({ where: whereMock });
}

const validToken = {
  id: "t1",
  userId: "u1",
  token: "abc123",
  expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
  usedAt: null,
};

beforeEach(() => jest.clearAllMocks());

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/auth/reset-password", () => {
  it("returns 400 when token is missing", async () => {
    const res = await POST(makeRequest({ password: "newpassword123" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("required") });
  });

  it("returns 400 when password is missing", async () => {
    const res = await POST(makeRequest({ token: "some-token" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("required") });
  });

  it("returns 400 when password is too short", async () => {
    const res = await POST(makeRequest({ token: "some-token", password: "short" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("8 characters") });
  });

  it("returns 400 for invalid/used token", async () => {
    mockSelect([]); // no matching token
    const res = await POST(makeRequest({ token: "bad-token", password: "newpassword123" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("Invalid") });
  });

  it("returns 400 for expired token", async () => {
    mockSelect([{
      ...validToken,
      expiresAt: new Date(Date.now() - 1000), // expired
    }]);
    const res = await POST(makeRequest({ token: "abc123", password: "newpassword123" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("expired") });
  });

  it("resets password successfully", async () => {
    mockSelect([validToken]); // valid token found
    mockUpdate();             // update user password
    mockUpdate();             // mark token as used
    mockDelete();             // delete sessions

    const res = await POST(makeRequest({ token: "abc123", password: "newpassword123" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toMatch(/reset successfully/i);

    // Verify all DB operations were called
    expect(db.update).toHaveBeenCalledTimes(2);
    expect(db.delete).toHaveBeenCalledTimes(1);
  });
});
