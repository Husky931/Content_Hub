import { NextRequest } from "next/server";
import { POST } from "@/app/api/settings/change-password/route";

// ── Mocks ──────────────────────────────────────────────────────────────────
jest.mock("@/db", () => ({
  db: { select: jest.fn(), update: jest.fn() },
}));
jest.mock("@/lib/auth", () => ({
  getAuthFromCookies: jest.fn(),
  hashPassword: jest.fn().mockReturnValue("new-hashed-password"),
  verifyPassword: jest.fn(),
}));

import { db } from "@/db";
import { getAuthFromCookies, verifyPassword } from "@/lib/auth";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeReq(body: object) {
  return new NextRequest("http://localhost/api/settings/change-password", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function mockSelect(rows: any[]) {
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

beforeEach(() => jest.clearAllMocks());

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/settings/change-password", () => {
  it("returns 401 when not authenticated", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue(null);
    const res = await POST(makeReq({ currentPassword: "old", newPassword: "newpass12" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when currentPassword is missing", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "u1", role: "creator" });
    const res = await POST(makeReq({ newPassword: "newpass12" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("required") });
  });

  it("returns 400 when newPassword is missing", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "u1", role: "creator" });
    const res = await POST(makeReq({ currentPassword: "oldpass12" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when new password is too short", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "u1", role: "creator" });
    const res = await POST(makeReq({ currentPassword: "oldpass12", newPassword: "short" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("8 characters") });
  });

  it("returns 403 when current password is incorrect", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "u1", role: "creator" });
    mockSelect([{ passwordHash: "hashed-old" }]);
    (verifyPassword as jest.Mock).mockReturnValue(false);

    const res = await POST(makeReq({ currentPassword: "wrong", newPassword: "newpass12" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("incorrect") });
  });

  it("updates password successfully", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "u1", role: "creator" });
    mockSelect([{ passwordHash: "hashed-old" }]);
    (verifyPassword as jest.Mock).mockReturnValue(true);
    mockUpdate();

    const res = await POST(makeReq({ currentPassword: "oldpass12", newPassword: "newpass12" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toMatch(/updated/i);
    expect(db.update).toHaveBeenCalled();
  });
});
