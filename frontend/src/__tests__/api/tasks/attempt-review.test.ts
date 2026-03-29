import { NextRequest } from "next/server";
import { PATCH, PUT, DELETE } from "@/app/api/tasks/[taskId]/attempts/[attemptId]/route";

// ── Mocks ──────────────────────────────────────────────────────────────────
jest.mock("@/db", () => {
  const mockDb = {
    select: jest.fn(),
    update: jest.fn(),
    insert: jest.fn(),
    delete: jest.fn(),
    transaction: jest.fn(),
  };
  // transaction mock: calls the callback with the same db object
  mockDb.transaction.mockImplementation(async (cb: (tx: typeof mockDb) => Promise<unknown>) => cb(mockDb));
  return { db: mockDb };
});
jest.mock("@/lib/auth", () => ({
  getAuthFromCookies: jest.fn(),
}));
jest.mock("@/lib/ws-publish", () => ({
  publishSystemMessage: jest.fn().mockResolvedValue(undefined),
  publishTaskUpdate: jest.fn().mockResolvedValue(undefined),
  publishNotification: jest.fn().mockResolvedValue(undefined),
  publishWalletUpdate: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/backend-webhook", () => ({
  webhookTaskCompleted: jest.fn().mockResolvedValue(undefined),
}));

import { db } from "@/db";
import { getAuthFromCookies } from "@/lib/auth";

// ── Helpers ────────────────────────────────────────────────────────────────

const url = "http://localhost/api/tasks/task-1/attempts/attempt-1";
const paramsPromise = Promise.resolve({ taskId: "task-1", attemptId: "attempt-1" });

function makePatchReq(body: object) {
  return new NextRequest(url, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function makePutReq(body: object) {
  return new NextRequest(url, {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function makeDeleteReq() {
  return new NextRequest(url, { method: "DELETE" });
}

function mockSelect(rows: any[]) {
  const limitMock = jest.fn().mockResolvedValue(rows);
  const whereResult = Object.assign(Promise.resolve(rows), { limit: limitMock });
  const whereMock = jest.fn().mockReturnValue(whereResult);
  const innerJoinMock = jest.fn().mockReturnValue({ where: whereMock, orderBy: jest.fn().mockResolvedValue(rows) });
  const fromMock = jest.fn().mockReturnValue({
    where: whereMock,
    limit: limitMock,
    innerJoin: innerJoinMock,
  });
  (db.select as jest.Mock).mockReturnValueOnce({ from: fromMock });
}

function mockUpdate(returned: any[] = []) {
  const returningMock = jest.fn().mockResolvedValue(returned);
  const whereMock = jest.fn().mockReturnValue({ returning: returningMock });
  const setMock = jest.fn().mockReturnValue({ where: whereMock });
  (db.update as jest.Mock).mockReturnValueOnce({ set: setMock });
}

function mockInsert(returned: any[] = []) {
  const returningMock = jest.fn().mockResolvedValue(returned);
  const valuesMock = jest.fn().mockReturnValue({ returning: returningMock });
  (db.insert as jest.Mock).mockReturnValueOnce({ values: valuesMock });
}

function mockDelete() {
  const whereMock = jest.fn().mockResolvedValue([]);
  (db.delete as jest.Mock).mockReturnValueOnce({ where: whereMock });
}

const submittedAttempt = {
  id: "attempt-1",
  taskId: "task-1",
  userId: "creator-1",
  status: "submitted",
  deliverables: { text: "My work" },
};

const activeTask = {
  id: "task-1",
  channelId: "ch-1",
  createdById: "admin-1",
  title: "Record Greeting",
  status: "active",
  bountyUsd: "10.00",
  bountyRmb: "70.00",
  reviewClaimedById: "mod-1",
};

beforeEach(() => {
  jest.resetAllMocks();
  // Re-apply transaction mock after reset (resetAllMocks clears implementations)
  (db as any).transaction.mockImplementation(async (cb: (tx: typeof db) => Promise<unknown>) => cb(db));
});

// ── PATCH (Review) Tests ───────────────────────────────────────────────────

describe("PATCH /api/tasks/[taskId]/attempts/[attemptId]", () => {
  it("returns 401 when not authenticated", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue(null);
    const res = await PATCH(makePatchReq({ status: "approved" }), { params: paramsPromise });
    expect(res.status).toBe(401);
  });

  it("returns 403 for creator role", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "c1", role: "creator" });
    const res = await PATCH(makePatchReq({ status: "approved" }), { params: paramsPromise });
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid status", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "m1", role: "mod" });
    const res = await PATCH(makePatchReq({ status: "invalid" }), { params: paramsPromise });
    expect(res.status).toBe(400);
  });

  it("returns 404 when attempt not found", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "m1", role: "mod" });
    mockSelect([]); // attempt lookup

    const res = await PATCH(makePatchReq({ status: "approved" }), { params: paramsPromise });
    expect(res.status).toBe(404);
  });

  it("returns 400 when attempt is not in submitted state", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "m1", role: "mod" });
    mockSelect([{ ...submittedAttempt, status: "approved" }]);

    const res = await PATCH(makePatchReq({ status: "approved" }), { params: paramsPromise });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/cannot review/i);
  });

  it("returns 403 when reviewer is the submitter", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "creator-1", role: "mod" });
    mockSelect([submittedAttempt]); // attempt found
    mockSelect([activeTask]); // task found

    const res = await PATCH(makePatchReq({ status: "approved" }), { params: paramsPromise });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/own submission/i);
  });

  it("returns 400 when review not claimed", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "mod-1", role: "mod" });
    mockSelect([submittedAttempt]);
    mockSelect([{ ...activeTask, reviewClaimedById: null }]);

    const res = await PATCH(makePatchReq({ status: "approved" }), { params: paramsPromise });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/claim/i);
  });

  it("returns 409 when review claimed by someone else", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "mod-2", role: "mod" });
    mockSelect([submittedAttempt]);
    mockSelect([{ ...activeTask, reviewClaimedById: "mod-1" }]);

    const res = await PATCH(makePatchReq({ status: "approved" }), { params: paramsPromise });
    expect(res.status).toBe(409);
  });

  it("successfully approves attempt (with auto-reject, ledger, notifications)", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "mod-1", role: "admin" });
    mockSelect([submittedAttempt]); // attempt lookup (pre-check)
    mockSelect([activeTask]); // task lookup
    // --- inside transaction ---
    mockUpdate([{ ...submittedAttempt, status: "approved" }]); // optimistic lock update attempt
    mockSelect([]); // other submitted attempts
    mockUpdate([]); // update task to approved
    mockInsert([]); // create ledger entry
    // --- after transaction ---
    mockSelect([{ username: "creator1", displayName: "Creator One", email: "c1@test.com" }]); // submitter
    mockSelect([{ username: "mod_admin" }]); // reviewer
    mockSelect([{ slug: "voiceover-basic" }]); // channel
    // Post system message + notify creator
    mockInsert([{ id: "msg-1", createdAt: new Date() }]);
    mockInsert([]);

    const res = await PATCH(
      makePatchReq({ status: "approved", reviewNote: "Great work!" }),
      { params: paramsPromise }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.attempt.status).toBe("approved");
  });

  it("returns 409 when attempt already reviewed (optimistic lock)", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "mod-1", role: "admin" });
    mockSelect([submittedAttempt]); // attempt lookup (pre-check)
    mockSelect([activeTask]); // task lookup
    // --- inside transaction: optimistic lock returns no rows ---
    mockUpdate([]); // no rows matched WHERE status='submitted'

    const res = await PATCH(
      makePatchReq({ status: "approved" }),
      { params: paramsPromise }
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/already been reviewed/i);
  });

  it("successfully rejects attempt with reason", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "mod-1", role: "admin" });
    mockSelect([submittedAttempt]); // attempt lookup (pre-check)
    mockSelect([activeTask]); // task lookup
    // --- inside transaction ---
    mockUpdate([{ ...submittedAttempt, status: "rejected" }]); // optimistic lock update attempt
    // --- after transaction ---
    mockSelect([{ username: "creator1", displayName: "Creator One", email: "c1@test.com" }]); // submitter
    mockSelect([{ username: "mod_admin" }]); // reviewer
    mockSelect([{ slug: "voiceover-basic" }]); // channel
    // System message + notification
    mockInsert([{ id: "msg-2", createdAt: new Date() }]);
    mockInsert([]);

    const res = await PATCH(
      makePatchReq({ status: "rejected", rejectionReason: "Low quality" }),
      { params: paramsPromise }
    );
    expect(res.status).toBe(200);
  });
});

// ── PUT (Edit) Tests ───────────────────────────────────────────────────────

describe("PUT /api/tasks/[taskId]/attempts/[attemptId]", () => {
  it("returns 401 when not authenticated", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue(null);
    const res = await PUT(makePutReq({ deliverables: { text: "updated" } }), { params: paramsPromise });
    expect(res.status).toBe(401);
  });

  it("returns 400 when deliverables are empty", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "c1", role: "creator" });
    const res = await PUT(makePutReq({ deliverables: {} }), { params: paramsPromise });
    expect(res.status).toBe(400);
  });

  it("returns 404 when attempt not found or not owned", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "c1", role: "creator" });
    mockSelect([]); // not found

    const res = await PUT(makePutReq({ deliverables: { text: "update" } }), { params: paramsPromise });
    expect(res.status).toBe(404);
  });

  it("successfully edits own submitted attempt", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "creator-1", role: "creator" });
    mockSelect([submittedAttempt]); // attempt found
    mockUpdate([{ ...submittedAttempt, deliverables: { text: "updated" } }]);

    const res = await PUT(
      makePutReq({ deliverables: { text: "updated" } }),
      { params: paramsPromise }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.attempt.deliverables.text).toBe("updated");
  });
});

// ── DELETE Tests ────────────────────────────────────────────────────────────

describe("DELETE /api/tasks/[taskId]/attempts/[attemptId]", () => {
  it("returns 401 when not authenticated", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue(null);
    const res = await DELETE(makeDeleteReq(), { params: paramsPromise });
    expect(res.status).toBe(401);
  });

  it("returns 404 when attempt not found or not owned", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "c1", role: "creator" });
    mockSelect([]);

    const res = await DELETE(makeDeleteReq(), { params: paramsPromise });
    expect(res.status).toBe(404);
  });

  it("successfully deletes own submitted attempt", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "creator-1", role: "creator" });
    mockSelect([submittedAttempt]);
    mockDelete();

    const res = await DELETE(makeDeleteReq(), { params: paramsPromise });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });
});
