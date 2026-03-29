import { NextRequest } from "next/server";

// ── Mocks ──────────────────────────────────────────────────────────────────
jest.mock("@/db", () => ({
  db: { select: jest.fn(), update: jest.fn(), delete: jest.fn() },
}));
jest.mock("@/lib/auth", () => ({
  getAuthFromCookies: jest.fn(),
}));

import { GET, PATCH, DELETE } from "@/app/api/admin/channels/[channelId]/route";
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
  return new NextRequest("http://localhost/api/admin/channels/ch-1", init);
}

function mockSelect(rows: any[]) {
  const limitMock = jest.fn().mockResolvedValue(rows);
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

function mockUpdate(returned: any[]) {
  const returningMock = jest.fn().mockResolvedValue(returned);
  const whereMock = jest.fn().mockReturnValue({ returning: returningMock });
  const setMock = jest.fn().mockReturnValue({ where: whereMock });
  (db.update as jest.Mock).mockReturnValueOnce({ set: setMock });
}

function mockDelete() {
  const whereMock = jest.fn().mockResolvedValue(undefined);
  (db.delete as jest.Mock).mockReturnValueOnce({ where: whereMock });
}

beforeEach(() => jest.clearAllMocks());

// ── GET Tests ──────────────────────────────────────────────────────────────

describe("GET /api/admin/channels/[channelId]", () => {
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

  it("returns 200 with channel and mods", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "a1", role: "admin" });
    mockSelect([{ id: "ch-1", name: "Test Channel" }]); // channel
    mockSelect([{ id: "u1", username: "mod1", displayName: "Mod 1", role: "mod", assignedAt: "2024-01-01" }]); // mods
    const res = await GET(makeReq("GET"), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.channel.id).toBe("ch-1");
    expect(json.mods).toHaveLength(1);
  });
});

// ── PATCH Tests ────────────────────────────────────────────────────────────

describe("PATCH /api/admin/channels/[channelId]", () => {
  it("returns 403 for non-admin/supermod", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "c1", role: "creator" });
    const res = await PATCH(makeReq("PATCH", { name: "x" }), params);
    expect(res.status).toBe(403);
  });

  it("returns 404 when channel not found", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "a1", role: "admin" });
    mockSelect([]); // channel not found
    const res = await PATCH(makeReq("PATCH", { name: "x" }), params);
    expect(res.status).toBe(404);
  });

  it("returns 400 for fixed channel", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "a1", role: "admin" });
    mockSelect([{ id: "ch-1", isFixed: true }]);
    const res = await PATCH(makeReq("PATCH", { name: "x" }), params);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/fixed/i);
  });

  it("returns 400 for empty name", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "a1", role: "admin" });
    mockSelect([{ id: "ch-1", isFixed: false }]);
    const res = await PATCH(makeReq("PATCH", { name: "" }), params);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/name.*empty/i);
  });

  it("returns 409 for duplicate slug", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "a1", role: "admin" });
    mockSelect([{ id: "ch-1", isFixed: false }]); // channel
    mockSelect([{ id: "ch-other" }]); // slug check — different id
    const res = await PATCH(makeReq("PATCH", { name: "Existing Name" }), params);
    expect(res.status).toBe(409);
  });

  it("returns 200 when no fields to update (no-op)", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "a1", role: "admin" });
    mockSelect([{ id: "ch-1", isFixed: false, type: "discussion" }]);
    const res = await PATCH(makeReq("PATCH", {}), params);
    expect(res.status).toBe(200);
  });

  it("returns 200 on successful update", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "a1", role: "admin" });
    mockSelect([{ id: "ch-1", isFixed: false, type: "task" }]); // channel
    mockSelect([]); // slug unique
    const updated = { id: "ch-1", name: "Renamed", slug: "renamed" };
    mockUpdate([updated]);
    const res = await PATCH(makeReq("PATCH", { name: "Renamed" }), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.channel.name).toBe("Renamed");
  });
});

// ── DELETE Tests ────────────────────────────────────────────────────────────

describe("DELETE /api/admin/channels/[channelId]", () => {
  it("returns 403 for non-admin (supermod cannot delete)", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "s1", role: "supermod" });
    const res = await DELETE(makeReq("DELETE"), params);
    expect(res.status).toBe(403);
  });

  it("returns 404 when channel not found", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "a1", role: "admin" });
    mockSelect([]); // channel not found
    const res = await DELETE(makeReq("DELETE"), params);
    expect(res.status).toBe(404);
  });

  it("returns 400 for fixed channel", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "a1", role: "admin" });
    mockSelect([{ id: "ch-1", isFixed: true }]);
    const res = await DELETE(makeReq("DELETE"), params);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/fixed/i);
  });

  it("returns 200 with deleted counts", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "a1", role: "admin" });
    mockSelect([{ id: "ch-1", isFixed: false }]); // channel
    mockSelect([{ count: 5 }]); // messages count
    mockSelect([{ count: 3 }]); // tasks count
    mockDelete(); // delete channel
    const res = await DELETE(makeReq("DELETE"), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toBe("Channel deleted");
    expect(json.deletedCounts.messages).toBe(5);
    expect(json.deletedCounts.tasks).toBe(3);
  });
});
