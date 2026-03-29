import { NextRequest } from "next/server";

// ── Mocks ──────────────────────────────────────────────────────────────────
jest.mock("@/db", () => ({
  db: { select: jest.fn(), delete: jest.fn(), insert: jest.fn() },
}));
jest.mock("@/lib/auth", () => ({
  getAuthFromCookies: jest.fn(),
}));

import { GET, PUT } from "@/app/api/admin/channels/[channelId]/mods/route";
import { db } from "@/db";
import { getAuthFromCookies } from "@/lib/auth";

// ── Helpers ────────────────────────────────────────────────────────────────

const params = { params: Promise.resolve({ channelId: "ch-1" }) };

function makeReq(method: string, body?: object) {
  const init: RequestInit = { method };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new NextRequest("http://localhost/api/admin/channels/ch-1/mods", init);
}

function mockSelect(rows: any[]) {
  const limitMock = jest.fn().mockResolvedValue(rows);
  // where returns a thenable that also has .limit()
  const whereResult = Object.assign(Promise.resolve(rows), { limit: limitMock });
  const whereMock = jest.fn().mockReturnValue(whereResult);
  const innerJoinMock = jest.fn().mockReturnValue({ where: whereMock });
  const fromMock = jest.fn().mockReturnValue({
    where: whereMock,
    limit: limitMock,
    innerJoin: innerJoinMock,
  });
  (db.select as jest.Mock).mockReturnValueOnce({ from: fromMock });
}

function mockDelete() {
  const whereMock = jest.fn().mockResolvedValue(undefined);
  (db.delete as jest.Mock).mockReturnValueOnce({ where: whereMock });
}

function mockInsert() {
  const valuesMock = jest.fn().mockResolvedValue(undefined);
  (db.insert as jest.Mock).mockReturnValueOnce({ values: valuesMock });
}

beforeEach(() => jest.clearAllMocks());

// ── GET Tests ──────────────────────────────────────────────────────────────

describe("GET /api/admin/channels/[channelId]/mods", () => {
  it("returns 403 for non-admin/supermod", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "c1", role: "creator" });
    const res = await GET(makeReq("GET"), params);
    expect(res.status).toBe(403);
  });

  it("returns 404 when channel not found", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "a1", role: "admin" });
    mockSelect([]); // channel not found
    const res = await GET(makeReq("GET"), params);
    expect(res.status).toBe(404);
  });

  it("returns 200 with mods list", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "a1", role: "admin" });
    mockSelect([{ id: "ch-1" }]); // channel exists
    const modList = [
      { id: "u1", username: "mod1", displayName: "Mod 1", role: "mod", assignedAt: "2024-01-01" },
    ];
    mockSelect(modList); // mods
    const res = await GET(makeReq("GET"), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.mods).toHaveLength(1);
    expect(json.mods[0].username).toBe("mod1");
  });

  it("returns 200 when mod is assigned to the channel", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "m1", role: "mod" });
    mockSelect([{ id: "ch-1" }]); // channel exists
    mockSelect([{ channelId: "ch-1" }]); // mod assignment exists
    const modList = [
      { id: "m1", username: "mod1", displayName: "Mod 1", role: "mod", assignedAt: "2024-01-01" },
      { id: "m2", username: "mod2", displayName: "Mod 2", role: "mod", assignedAt: "2024-01-01" },
    ];
    mockSelect(modList); // mods
    const res = await GET(makeReq("GET"), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.mods).toHaveLength(2);
  });

  it("returns 403 when mod is NOT assigned to the channel", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "m1", role: "mod" });
    mockSelect([{ id: "ch-1" }]); // channel exists
    mockSelect([]); // mod assignment NOT found
    const res = await GET(makeReq("GET"), params);
    expect(res.status).toBe(403);
  });
});

// ── PUT Tests ──────────────────────────────────────────────────────────────

describe("PUT /api/admin/channels/[channelId]/mods", () => {
  it("returns 403 for non-admin/supermod", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "c1", role: "creator" });
    const res = await PUT(makeReq("PUT", { modUserIds: [] }), params);
    expect(res.status).toBe(403);
  });

  it("returns 404 when channel not found", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "a1", role: "admin" });
    mockSelect([]); // channel not found
    const res = await PUT(makeReq("PUT", { modUserIds: [] }), params);
    expect(res.status).toBe(404);
  });

  it("returns 400 when modUserIds is not an array", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "a1", role: "admin" });
    mockSelect([{ id: "ch-1" }]); // channel exists
    const res = await PUT(makeReq("PUT", { modUserIds: "u1" }), params);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/array/i);
  });

  it("returns 400 when users have invalid roles", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "a1", role: "admin" });
    mockSelect([{ id: "ch-1" }]); // channel exists
    // validUsers query returns a creator (invalid role for mod assignment)
    mockSelect([{ id: "u1", role: "creator" }]);
    const res = await PUT(makeReq("PUT", { modUserIds: ["u1"] }), params);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/mod.*supermod.*admin/i);
  });

  it("returns 400 when user IDs are invalid (count mismatch)", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "a1", role: "admin" });
    mockSelect([{ id: "ch-1" }]); // channel exists
    // Only 1 valid user found but 2 requested
    mockSelect([{ id: "u1", role: "mod" }]);
    const res = await PUT(makeReq("PUT", { modUserIds: ["u1", "u-nonexistent"] }), params);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/invalid/i);
  });

  it("returns 200 on success replacing mods", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "a1", role: "admin" });
    mockSelect([{ id: "ch-1" }]); // channel exists
    // validUsers — all are mods
    mockSelect([
      { id: "u1", role: "mod" },
      { id: "u2", role: "supermod" },
    ]);
    mockDelete(); // delete old mods
    mockInsert(); // insert new mods
    // return updated mod list
    const updatedMods = [
      { id: "u1", username: "mod1", displayName: "Mod 1", role: "mod", assignedAt: "2024-01-01" },
      { id: "u2", username: "smod", displayName: "Supermod", role: "supermod", assignedAt: "2024-01-01" },
    ];
    mockSelect(updatedMods);
    const res = await PUT(makeReq("PUT", { modUserIds: ["u1", "u2"] }), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.mods).toHaveLength(2);
  });
});
