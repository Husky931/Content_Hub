import { NextRequest } from "next/server";

// ── Mocks ──────────────────────────────────────────────────────────────────
jest.mock("@/db", () => ({
  db: { select: jest.fn(), update: jest.fn(), insert: jest.fn() },
}));
jest.mock("@/lib/auth", () => ({
  getAuthFromCookies: jest.fn(),
}));
jest.mock("@/lib/ws-publish", () => ({
  publishMessage: jest.fn().mockResolvedValue(undefined),
  publishNotification: jest.fn().mockResolvedValue(undefined),
  publishTaskUpdate: jest.fn().mockResolvedValue(undefined),
}));

import { PATCH } from "@/app/api/appeals/[id]/route";
import { db } from "@/db";
import { getAuthFromCookies } from "@/lib/auth";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeReq(body: object) {
  return new NextRequest("http://localhost/api/appeals/appeal-1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const paramsPromise = Promise.resolve({ id: "appeal-1" });

function mockSelect(rows: any[]) {
  const limitMock = jest.fn().mockResolvedValue(rows);
  const thenableWithLimit = Object.assign(Promise.resolve(rows), { limit: limitMock });
  const whereMock = jest.fn().mockReturnValue(thenableWithLimit);
  const fromMock = jest.fn().mockReturnValue({ where: whereMock, limit: limitMock });
  (db.select as jest.Mock).mockReturnValueOnce({ from: fromMock });
}

function mockUpdate() {
  const whereMock = jest.fn().mockResolvedValue(undefined);
  const returningMock = jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{}]) });
  const setMock = jest.fn().mockReturnValue({ where: whereMock, returning: returningMock });
  (db.update as jest.Mock).mockReturnValueOnce({ set: setMock });
}

function mockInsert(returned: any[] = []) {
  const returningMock = jest.fn().mockResolvedValue(returned);
  const valuesMock = jest.fn().mockReturnValue({ returning: returningMock });
  (db.insert as jest.Mock).mockReturnValueOnce({ values: valuesMock });
}

beforeEach(() => jest.clearAllMocks());

// ── Tests ──────────────────────────────────────────────────────────────────

describe("PATCH /api/appeals/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue(null);
    const res = await PATCH(makeReq({ status: "granted" }), { params: paramsPromise });
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is not mod/supermod/admin", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "u1", role: "creator" });
    const res = await PATCH(makeReq({ status: "granted" }), { params: paramsPromise });
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid status value", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "mod-1", role: "mod" });
    const res = await PATCH(makeReq({ status: "pending" }), { params: paramsPromise });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/granted.*denied/i);
  });

  it("returns 404 when appeal not found", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "mod-1", role: "mod" });
    mockSelect([]); // appeal not found
    const res = await PATCH(makeReq({ status: "granted" }), { params: paramsPromise });
    expect(res.status).toBe(404);
  });

  it("returns 400 when appeal already resolved", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "mod-1", role: "mod" });
    mockSelect([{ id: "appeal-1", status: "granted", attemptId: "a1", userId: "u1" }]);
    const res = await PATCH(makeReq({ status: "denied" }), { params: paramsPromise });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/already resolved/i);
  });

  it("returns 403 when arbitrator is the original reviewer", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "mod-1", role: "admin" });
    // appeal lookup
    mockSelect([{ id: "appeal-1", status: "pending", attemptId: "a1", userId: "u1" }]);
    // reviewer check — same user as arbitrator
    mockSelect([{ reviewerId: "mod-1" }]);

    const res = await PATCH(makeReq({ status: "granted" }), { params: paramsPromise });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/original reviewer/i);
  });

  it("returns 200 when granting an appeal", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "mod-1", role: "admin" });

    // appeal lookup
    mockSelect([{ id: "appeal-1", status: "pending", attemptId: "a1", userId: "u1" }]);
    // reviewer check — different user, so allowed
    mockSelect([{ reviewerId: "other-mod" }]);
    // update appeal
    mockUpdate();
    // attempt lookup
    mockSelect([{ id: "a1", taskId: "t1", status: "rejected" }]);
    // task lookup
    mockSelect([{ id: "t1", title: "Record Greeting", channelId: "ch-1", status: "active" }]);
    // channel lookup
    mockSelect([{ id: "ch-1", slug: "general", name: "General" }]);
    // appeal user lookup
    mockSelect([{ username: "creator1", displayName: "Creator One" }]);
    // arbitrator user lookup
    mockSelect([{ id: "mod-1", username: "admin1", displayName: "Admin One", avatarUrl: null, role: "admin" }]);
    // update attempt (revert to submitted)
    mockUpdate();
    // insert system message in channel
    mockInsert([{ id: "msg-1", content: "sys", type: "system", createdAt: new Date() }]);
    // insert notification
    mockInsert([{ id: "notif-1", title: "Appeal upheld" }]);
    // appeals channel lookup
    mockSelect([{ id: "ch-appeals" }]);
    // insert resolution message
    mockInsert([{ id: "msg-2", content: "res", type: "system", createdAt: new Date() }]);

    const res = await PATCH(makeReq({ status: "granted", arbitratorNote: "Looks valid" }), { params: paramsPromise });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.status).toBe("granted");
  });

  it("returns 200 when denying an appeal", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "mod-1", role: "mod" });

    // appeal lookup
    mockSelect([{ id: "appeal-1", status: "pending", attemptId: "a1", userId: "u1" }]);
    // reviewer check — different user
    mockSelect([{ reviewerId: "other-mod" }]);
    // update appeal
    mockUpdate();
    // attempt lookup
    mockSelect([{ id: "a1", taskId: "t1", status: "rejected" }]);
    // task lookup
    mockSelect([{ id: "t1", title: "Record Greeting", channelId: "ch-1", status: "active" }]);
    // channel lookup
    mockSelect([{ id: "ch-1", slug: "general", name: "General" }]);
    // appeal user lookup
    mockSelect([{ username: "creator1", displayName: "Creator One" }]);
    // arbitrator user lookup
    mockSelect([{ id: "mod-1", username: "mod1", displayName: "Mod One", avatarUrl: null, role: "mod" }]);
    // insert notification (denied)
    mockInsert([{ id: "notif-1", title: "Appeal denied" }]);
    // appeals channel lookup
    mockSelect([{ id: "ch-appeals" }]);
    // insert resolution message
    mockInsert([{ id: "msg-1", content: "res", type: "system", createdAt: new Date() }]);

    const res = await PATCH(makeReq({ status: "denied" }), { params: paramsPromise });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.status).toBe("denied");
  });
});
