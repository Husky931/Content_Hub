import { NextRequest } from "next/server";
import { GET } from "@/app/api/channels/[slug]/route";

// ── Mocks ──────────────────────────────────────────────────────────────────
jest.mock("@/db", () => ({
  db: { select: jest.fn() },
}));
jest.mock("@/lib/auth", () => ({
  getAuthFromCookies: jest.fn(),
}));

import { db } from "@/db";
import { getAuthFromCookies } from "@/lib/auth";

// ── Helpers ────────────────────────────────────────────────────────────────

const paramsPromise = Promise.resolve({ slug: "general" });

function makeReq() {
  return new NextRequest("http://localhost/api/channels/general");
}

function mockSelect(rows: any[]) {
  const limitMock = jest.fn().mockResolvedValue(rows);
  const groupByMock = jest.fn().mockResolvedValue(rows);
  const orderByResult = Object.assign(Promise.resolve(rows), { limit: limitMock });
  const orderByMock = jest.fn().mockReturnValue(orderByResult);
  const whereResult = Object.assign(Promise.resolve(rows), {
    limit: limitMock,
    orderBy: orderByMock,
    groupBy: groupByMock,
  });
  const whereMock = jest.fn().mockReturnValue(whereResult);
  const innerJoinMock = jest.fn().mockReturnValue({
    where: whereMock,
    orderBy: orderByMock,
    groupBy: groupByMock,
  });
  const fromMock = jest.fn().mockReturnValue({
    where: whereMock,
    innerJoin: innerJoinMock,
    orderBy: orderByMock,
    limit: limitMock,
    groupBy: groupByMock,
  });
  (db.select as jest.Mock).mockReturnValueOnce({ from: fromMock });
}

const sampleChannel = {
  id: "ch-1",
  name: "general",
  nameCn: null,
  type: "discussion",
  description: "General chat",
  descriptionCn: null,
  slug: "general",
  isFixed: false,
  requiredTagId: null,
  sortOrder: 0,
  createdAt: new Date(),
};

const sampleMessage = {
  id: "msg-1",
  content: "Hello world",
  type: "text",
  replyToId: null,
  privateToUserId: null,
  createdAt: new Date(),
  updatedAt: null,
  userId: "u1",
  username: "user1",
  displayName: "User One",
  avatarUrl: null,
  role: "creator",
};

beforeEach(() => jest.clearAllMocks());

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/channels/[slug]", () => {
  it("returns 404 when channel not found", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "u1", role: "creator" });
    mockSelect([]); // channel lookup — not found

    const res = await GET(makeReq(), { params: paramsPromise });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not found/i);
  });

  it("returns channel with messages", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "u1", role: "creator" });
    mockSelect([sampleChannel]);   // 1: channel found
    mockSelect([sampleMessage]);   // 2: messages
    mockSelect([]);                // 3: reply counts

    const res = await GET(makeReq(), { params: paramsPromise });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.channel.name).toBe("general");
    expect(json.messages).toHaveLength(1);
    expect(json.messages[0].content).toBe("Hello world");
    expect(json.messages[0].user.username).toBe("user1");
  });

  it("returns channel with empty messages", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "u1", role: "creator" });
    mockSelect([sampleChannel]); // 1: channel found
    mockSelect([]);              // 2: no messages
    mockSelect([]);              // 3: reply counts

    const res = await GET(makeReq(), { params: paramsPromise });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.channel.name).toBe("general");
    expect(json.messages).toHaveLength(0);
  });
});
