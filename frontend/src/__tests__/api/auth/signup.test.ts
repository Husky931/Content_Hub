import { NextRequest } from "next/server";
import { POST } from "@/app/api/auth/signup/route";

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock("@/db", () => ({
  db: { select: jest.fn(), insert: jest.fn(), update: jest.fn(), delete: jest.fn() },
}));
jest.mock("@/lib/email", () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue({ success: true }),
}));

import { db } from "@/db";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(body: object) {
  return new NextRequest("http://localhost/api/auth/signup", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const validBody = {
  email: "alice@example.com",
  username: "alice123",
  password: "securepass",
  inviteCode: "INV-ABCD-EFGH",
};

const activeInvite = {
  id: "inv-1",
  code: "INV-ABCD-EFGH",
  status: "active",
  useCount: 0,
  maxUses: 5,
  expiresAt: null,
};

function mockSelect(rows: object[]) {
  const limitMock = jest.fn().mockResolvedValue(rows);
  const whereMock = jest.fn().mockReturnValue({ limit: limitMock });
  const fromMock = jest.fn().mockReturnValue({ where: whereMock });
  (db.select as jest.Mock).mockReturnValueOnce({ from: fromMock });
}

function mockInsert(returning: object[] = []) {
  const returningMock = jest.fn().mockResolvedValue(returning);
  const valuesMock = jest.fn().mockReturnValue({ returning: returningMock });
  // insert without returning (e.g. verification tokens)
  const valuesMockNoReturn = jest.fn().mockResolvedValue([]);
  (db.insert as jest.Mock).mockReturnValueOnce({
    values: returning.length > 0 ? valuesMock : valuesMockNoReturn,
  });
}

function mockUpdate(returning: object[] = [{ id: "inv-1" }]) {
  const returningMock = jest.fn().mockResolvedValue(returning);
  const whereMock = jest.fn().mockReturnValue({ returning: returningMock });
  const setMock = jest.fn().mockReturnValue({ where: whereMock });
  (db.update as jest.Mock).mockReturnValueOnce({ set: setMock });
}

function mockDelete() {
  const whereMock = jest.fn().mockResolvedValue([]);
  (db.delete as jest.Mock).mockReturnValueOnce({ where: whereMock });
}

beforeEach(() => jest.clearAllMocks());

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/auth/signup", () => {
  describe("input validation", () => {
    it("returns 400 when email is missing", async () => {
      const { email: _e, ...body } = validBody;
      const res = await POST(makeRequest(body));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining("required") });
    });

    it("returns 400 when username is missing", async () => {
      const { username: _u, ...body } = validBody;
      const res = await POST(makeRequest(body));
      expect(res.status).toBe(400);
    });

    it("returns 400 when password is missing", async () => {
      const { password: _p, ...body } = validBody;
      const res = await POST(makeRequest(body));
      expect(res.status).toBe(400);
    });

    it("returns 400 when inviteCode is missing", async () => {
      const { inviteCode: _i, ...body } = validBody;
      const res = await POST(makeRequest(body));
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid email format", async () => {
      const res = await POST(makeRequest({ ...validBody, email: "not-an-email" }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining("email") });
    });

    it("returns 400 for username shorter than 3 chars", async () => {
      const res = await POST(makeRequest({ ...validBody, username: "ab" }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining("Username") });
    });

    it("returns 400 for username longer than 20 chars", async () => {
      const res = await POST(makeRequest({ ...validBody, username: "a".repeat(21) }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for username with invalid characters", async () => {
      const res = await POST(makeRequest({ ...validBody, username: "user name!" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for password shorter than 8 chars", async () => {
      const res = await POST(makeRequest({ ...validBody, password: "short" }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining("8 characters") });
    });
  });

  describe("invite code checks", () => {
    it("returns 400 for an invalid invite code", async () => {
      mockSelect([]); // no matching invite
      const res = await POST(makeRequest(validBody));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining("invite code") });
    });

    it("returns 400 when invite code has reached max uses", async () => {
      mockSelect([{ ...activeInvite, useCount: 5, maxUses: 5 }]);
      const res = await POST(makeRequest(validBody));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining("usage limit") });
    });

    it("returns 400 when invite code has expired", async () => {
      mockSelect([{ ...activeInvite, expiresAt: new Date(Date.now() - 1000) }]);
      const res = await POST(makeRequest(validBody));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining("expired") });
    });
  });

  describe("duplicate checks", () => {
    it("returns 409 when email is already registered", async () => {
      mockSelect([activeInvite]);   // invite found
      mockSelect([{ id: "u1" }]);   // existing email found
      const res = await POST(makeRequest(validBody));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining("Email") });
    });

    it("returns 409 when username is already taken", async () => {
      mockSelect([activeInvite]);  // invite found
      mockSelect([]);              // email available
      mockSelect([{ id: "u2" }]); // username taken
      const res = await POST(makeRequest(validBody));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining("Username") });
    });
  });

  describe("successful signup", () => {
    it("returns 201 and a success message", async () => {
      mockSelect([activeInvite]); // invite
      mockSelect([]);             // email available
      mockSelect([]);             // username available

      // db.insert(users).values({}).returning({}) → new user
      const returningMock = jest.fn().mockResolvedValue([{ id: "new-user", email: "alice@example.com" }]);
      const valuesMock = jest.fn().mockReturnValue({ returning: returningMock });
      (db.insert as jest.Mock).mockReturnValueOnce({ values: valuesMock });

      mockUpdate([{ id: "inv-1" }]); // atomic update succeeds

      // db.insert(verificationTokens).values({})
      const vtValuesMock = jest.fn().mockResolvedValue([]);
      (db.insert as jest.Mock).mockReturnValueOnce({ values: vtValuesMock });

      const res = await POST(makeRequest(validBody));
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.message).toMatch(/verify/i);
    });
  });

  describe("invite code race condition", () => {
    it("returns 400 and cleans up user when atomic update returns empty", async () => {
      mockSelect([activeInvite]); // invite found
      mockSelect([]);             // email available
      mockSelect([]);             // username available

      // db.insert(users) → new user created
      const returningMock = jest.fn().mockResolvedValue([{ id: "new-user", email: "alice@example.com" }]);
      const valuesMock = jest.fn().mockReturnValue({ returning: returningMock });
      (db.insert as jest.Mock).mockReturnValueOnce({ values: valuesMock });

      mockUpdate([]); // atomic update returns empty — race condition lost
      mockDelete();   // cleanup: delete the created user

      const res = await POST(makeRequest(validBody));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("usage limit");

      // Verify the user cleanup was attempted
      expect(db.delete).toHaveBeenCalled();
    });
  });
});
