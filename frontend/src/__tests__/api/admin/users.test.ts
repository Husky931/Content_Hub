import { NextRequest } from "next/server";
import { GET, PATCH } from "@/app/api/admin/users/route";

// ── Mocks ──────────────────────────────────────────────────────────────────
jest.mock("@/db", () => ({
  db: { select: jest.fn(), update: jest.fn() },
}));
jest.mock("@/lib/auth", () => ({
  getAuthFromCookies: jest.fn(),
}));

import { db } from "@/db";
import { getAuthFromCookies } from "@/lib/auth";

// ── Helpers ────────────────────────────────────────────────────────────────

function makePatchReq(body: object) {
  return new NextRequest("http://localhost/api/admin/users", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function mockSelect(rows: any[]) {
  const limitMock = jest.fn().mockResolvedValue(rows);
  const orderByMock = jest.fn().mockResolvedValue(rows);
  const whereMock = jest.fn().mockReturnValue({ limit: limitMock, orderBy: orderByMock });
  // innerJoin must be thenable (some queries await directly after innerJoin)
  const innerJoinResult = Object.assign(Promise.resolve(rows), { where: whereMock, orderBy: orderByMock });
  const innerJoinMock = jest.fn().mockReturnValue(innerJoinResult);
  const fromMock = jest.fn().mockReturnValue({
    where: whereMock,
    orderBy: orderByMock,
    innerJoin: innerJoinMock,
    limit: limitMock,
  });
  (db.select as jest.Mock).mockReturnValueOnce({ from: fromMock });
}

function mockUpdate() {
  const whereMock = jest.fn().mockResolvedValue([]);
  const setMock = jest.fn().mockReturnValue({ where: whereMock });
  (db.update as jest.Mock).mockReturnValueOnce({ set: setMock });
}

beforeEach(() => jest.clearAllMocks());

// ── GET Tests ──────────────────────────────────────────────────────────────

describe("GET /api/admin/users", () => {
  it("returns 403 when not admin", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "c1", role: "creator" });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns 403 for mod", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "m1", role: "mod" });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns users with tags for admin", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "a1", role: "admin" });
    // Users query
    mockSelect([
      { id: "u1", username: "user1", role: "creator", status: "verified" },
      { id: "u2", username: "user2", role: "mod", status: "verified" },
    ]);
    // User tags query
    mockSelect([
      { userId: "u1", tagId: "t1", tagName: "Voiceover", tagColor: "#5865f2" },
    ]);

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.users).toHaveLength(2);
    expect(json.users[0].tags).toHaveLength(1);
    expect(json.users[1].tags).toHaveLength(0);
  });
});

// ── PATCH Tests ────────────────────────────────────────────────────────────

describe("PATCH /api/admin/users", () => {
  it("returns 403 when not admin", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "c1", role: "creator" });
    const res = await PATCH(makePatchReq({ userId: "u1", action: "ban" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when userId is missing", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "a1", role: "admin" });
    const res = await PATCH(makePatchReq({ action: "ban" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when trying to modify own account", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "a1", role: "admin" });
    const res = await PATCH(makePatchReq({ userId: "a1", action: "ban" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/own account/i);
  });

  it("returns 400 for invalid action", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "a1", role: "admin" });
    const res = await PATCH(makePatchReq({ userId: "u1", action: "promote" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid role on changeRole", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "a1", role: "admin" });
    const res = await PATCH(makePatchReq({ userId: "u1", action: "changeRole", role: "superadmin" }));
    expect(res.status).toBe(400);
  });

  it("changes user role successfully", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "a1", role: "admin" });
    mockUpdate();

    const res = await PATCH(makePatchReq({ userId: "u1", action: "changeRole", role: "mod" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("changes user role to supercreator successfully", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "a1", role: "admin" });
    mockUpdate();

    const res = await PATCH(makePatchReq({ userId: "u1", action: "changeRole", role: "supercreator" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("bans user successfully", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "a1", role: "admin" });
    mockUpdate();

    const res = await PATCH(makePatchReq({ userId: "u1", action: "ban", banReason: "Spamming" }));
    expect(res.status).toBe(200);
  });

  it("unbans user successfully", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "a1", role: "admin" });
    mockUpdate();

    const res = await PATCH(makePatchReq({ userId: "u1", action: "unban" }));
    expect(res.status).toBe(200);
  });
});
