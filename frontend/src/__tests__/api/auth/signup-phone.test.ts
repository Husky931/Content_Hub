import { NextRequest } from "next/server";
import { POST } from "@/app/api/auth/signup-phone/route";

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock("@/db", () => ({
  db: { select: jest.fn(), insert: jest.fn(), update: jest.fn(), delete: jest.fn() },
}));
jest.mock("@/lib/otp-store", () => ({ verifyOtp: jest.fn() }));
jest.mock("@/lib/auth-edge", () => ({
  createJWT: jest.fn().mockResolvedValue({
    token: "tok",
    jti: "jti-1",
    expiresAt: new Date(),
  }),
}));
jest.mock("bcryptjs", () => ({ hashSync: jest.fn().mockReturnValue("hashed") }));

// Pull mocked references AFTER jest.mock() declarations
import { db } from "@/db";
import { verifyOtp } from "@/lib/otp-store";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(body: object) {
  return new NextRequest("http://localhost/api/auth/signup-phone", {
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

function mockInsert(returning: object[] = [{ id: "new-user-1" }]) {
  const returningMock = jest.fn().mockResolvedValue(returning);
  const valuesMock = jest.fn().mockReturnValue({ returning: returningMock });
  (db.insert as jest.Mock).mockReturnValueOnce({ values: valuesMock });
}

function mockInsertNoReturn() {
  const valuesMock = jest.fn().mockResolvedValue([]);
  (db.insert as jest.Mock).mockReturnValueOnce({ values: valuesMock });
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

const validBody = {
  phone: "13800138000",
  otp: "123456",
  username: "alice_test",
  inviteCode: "ABC123",
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/auth/signup-phone", () => {
  describe("input validation", () => {
    it("returns 400 when required fields are missing", async () => {
      const res = await POST(makeRequest({ phone: "13800138000" }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining("required") });
    });

    it("returns 400 for invalid phone format", async () => {
      const res = await POST(makeRequest({ ...validBody, phone: "999" }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining("Invalid") });
    });

    it("returns 400 for invalid username", async () => {
      const res = await POST(makeRequest({ ...validBody, username: "a!" }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining("Username") });
    });
  });

  describe("OTP verification", () => {
    it("returns 400 when OTP verification fails", async () => {
      (verifyOtp as jest.Mock).mockReturnValue("Invalid or expired code");
      const res = await POST(makeRequest(validBody));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "Invalid or expired code" });
    });
  });

  describe("invite code validation", () => {
    it("returns 400 when invite code is invalid", async () => {
      (verifyOtp as jest.Mock).mockReturnValue(true);
      mockSelect([]); // no invite code found
      const res = await POST(makeRequest(validBody));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining("Invalid") });
    });
  });

  describe("uniqueness checks", () => {
    it("returns 409 when phone already registered", async () => {
      (verifyOtp as jest.Mock).mockReturnValue(true);
      // invite code found
      mockSelect([{ id: "c1", code: "ABC123", status: "active", useCount: 0, maxUses: 10, expiresAt: null }]);
      // phone lookup returns existing user
      mockSelect([{ id: "existing-user" }]);

      const res = await POST(makeRequest(validBody));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining("Phone") });
    });

    it("returns 409 when username taken", async () => {
      (verifyOtp as jest.Mock).mockReturnValue(true);
      // invite code found
      mockSelect([{ id: "c1", code: "ABC123", status: "active", useCount: 0, maxUses: 10, expiresAt: null }]);
      // phone lookup returns empty
      mockSelect([]);
      // username lookup returns existing user
      mockSelect([{ id: "existing-user" }]);

      const res = await POST(makeRequest(validBody));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining("Username") });
    });
  });

  describe("successful signup", () => {
    it("returns 201 with userId and sets auth cookie", async () => {
      (verifyOtp as jest.Mock).mockReturnValue(true);
      // invite code
      mockSelect([{ id: "c1", code: "ABC123", status: "active", useCount: 0, maxUses: 10, expiresAt: null }]);
      // phone not registered
      mockSelect([]);
      // username not taken
      mockSelect([]);
      // insert user (returning)
      mockInsert([{ id: "new-user-1" }]);
      // atomic update invite code succeeds
      mockUpdate([{ id: "c1" }]);
      // insert session
      mockInsertNoReturn();

      const res = await POST(makeRequest(validBody));
      expect(res.status).toBe(201);

      const json = await res.json();
      expect(json.message).toBe("Account created successfully");
      expect(json.userId).toBe("new-user-1");
      expect(res.cookies.get("auth_token")).toBeTruthy();
    });
  });

  describe("invite code race condition", () => {
    it("returns 400 and cleans up user when atomic update returns empty", async () => {
      (verifyOtp as jest.Mock).mockReturnValue(true);
      // invite code found
      mockSelect([{ id: "c1", code: "ABC123", status: "active", useCount: 0, maxUses: 10, expiresAt: null }]);
      // phone not registered
      mockSelect([]);
      // username not taken
      mockSelect([]);
      // insert user (returning)
      mockInsert([{ id: "new-user-1" }]);
      // atomic update returns empty — race condition lost
      mockUpdate([]);
      // cleanup: delete the created user
      mockDelete();

      const res = await POST(makeRequest(validBody));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("usage limit");

      // Verify the user cleanup was attempted
      expect(db.delete).toHaveBeenCalled();
    });
  });
});
