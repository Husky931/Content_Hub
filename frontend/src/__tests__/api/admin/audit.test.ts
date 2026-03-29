import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/admin/audit/route";

// ── Mocks ──────────────────────────────────────────────────────────────────
jest.mock("@/db", () => ({
  db: { select: jest.fn(), update: jest.fn(), insert: jest.fn(), delete: jest.fn() },
}));
jest.mock("@/lib/auth", () => ({
  getAuthFromCookies: jest.fn(),
}));
jest.mock("@/lib/ws-publish", () => ({
  publishWalletUpdate: jest.fn().mockResolvedValue(undefined),
  publishNotification: jest.fn().mockResolvedValue(undefined),
  publishTaskUpdate: jest.fn().mockResolvedValue(undefined),
  publishSystemMessage: jest.fn().mockResolvedValue(undefined),
}));

import { db } from "@/db";
import { getAuthFromCookies } from "@/lib/auth";

// ── Helpers ────────────────────────────────────────────────────────────────

function makePostReq(body: object) {
  return new NextRequest("http://localhost/api/admin/audit", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function mockSelect(rows: any[]) {
  const limitMock = jest.fn().mockResolvedValue(rows);
  const orderByMock = jest.fn().mockResolvedValue(rows);
  const whereMock = jest.fn().mockReturnValue({ limit: limitMock, orderBy: orderByMock });
  const innerJoinMock3 = jest.fn().mockReturnValue({ where: whereMock, orderBy: orderByMock });
  const innerJoinMock2 = jest.fn().mockReturnValue({
    where: whereMock,
    orderBy: orderByMock,
    innerJoin: innerJoinMock3,
  });
  const innerJoinMock = jest.fn().mockReturnValue({
    where: whereMock,
    orderBy: orderByMock,
    innerJoin: innerJoinMock2,
  });
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

function mockInsert() {
  const returningMock = jest.fn().mockResolvedValue([]);
  const valuesMock = jest.fn().mockReturnValue({ returning: returningMock });
  (db.insert as jest.Mock).mockReturnValueOnce({ values: valuesMock });
}

function mockDelete() {
  const whereMock = jest.fn().mockResolvedValue([]);
  (db.delete as jest.Mock).mockReturnValueOnce({ where: whereMock });
}

const auditItem = {
  taskId: "task-1",
  taskTitle: "Record Greeting",
  taskStatus: "approved",
  channelName: "voiceover-basic",
  channelSlug: "voiceover-basic",
  bountyUsd: "10.00",
  bountyRmb: "70.00",
  attemptId: "attempt-1",
  attemptUserId: "creator-1",
  creatorUsername: "creator1",
  creatorDisplayName: "Creator One",
};

beforeEach(() => jest.clearAllMocks());

// ── GET Tests ──────────────────────────────────────────────────────────────

describe("GET /api/admin/audit", () => {
  it("returns 403 when not admin or supermod", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "m1", role: "mod" });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns 403 for creator", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "c1", role: "creator" });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns audit items for admin", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "a1", role: "admin" });
    mockSelect([auditItem]);

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.auditItems).toHaveLength(1);
    expect(json.auditItems[0].taskTitle).toBe("Record Greeting");
  });

  it("returns audit items for supermod", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "sm1", role: "supermod" });
    mockSelect([]);

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.auditItems).toHaveLength(0);
  });
});

// ── POST Tests (Audit Reversal) ────────────────────────────────────────────

describe("POST /api/admin/audit", () => {
  it("returns 403 when not admin or supermod", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "m1", role: "mod" });
    const res = await POST(makePostReq({ taskId: "t1", attemptId: "a1", reason: "test" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when required fields are missing", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "a1", role: "admin" });
    const res = await POST(makePostReq({ taskId: "t1" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/required/i);
  });

  it("returns 400 when task not in approved state", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "a1", role: "admin" });
    mockSelect([]); // task not found in approved state

    const res = await POST(makePostReq({ taskId: "t1", attemptId: "a1", reason: "Bad quality" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when attempt not approved", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "a1", role: "admin" });
    const task = { id: "t1", channelId: "ch-1", title: "Test", status: "approved" };
    mockSelect([task]); // task found
    mockSelect([]); // attempt not found in approved state

    const res = await POST(makePostReq({ taskId: "t1", attemptId: "a1", reason: "Bad quality" }));
    expect(res.status).toBe(400);
  });

  it("successfully reverses an approval", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "sm1", role: "supermod" });
    const task = { id: "t1", channelId: "ch-1", title: "Record Greeting", status: "approved" };
    const attempt = { id: "a1", userId: "c1", status: "approved" };

    mockSelect([task]); // task lookup
    mockSelect([attempt]); // attempt lookup
    mockUpdate(); // update attempt to rejected
    mockUpdate(); // update task to active
    mockDelete(); // delete ledger entry
    mockSelect([{ username: "supermod1", displayName: "Super Mod" }]); // auditor info
    mockInsert(); // system message
    mockInsert(); // notification
    mockSelect([{ slug: "voiceover-basic" }]); // channel slug for ws broadcasts

    const res = await POST(makePostReq({
      taskId: "t1",
      attemptId: "a1",
      reason: "Quality did not meet standards",
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.message).toMatch(/reversed/i);
  });
});
