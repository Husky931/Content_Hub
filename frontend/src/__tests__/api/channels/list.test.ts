import { GET } from "@/app/api/channels/route";

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

function mockSelectReturning(rows: any[]) {
  const orderByResult = Object.assign(Promise.resolve(rows), {});
  const orderByMock = jest.fn().mockReturnValue(orderByResult);
  const whereResult = Object.assign(Promise.resolve(rows), { orderBy: orderByMock });
  const whereMock = jest.fn().mockReturnValue(whereResult);
  const fromMock = jest.fn().mockReturnValue({
    orderBy: orderByMock,
    where: whereMock,
  });
  (db.select as jest.Mock).mockReturnValueOnce({ from: fromMock });
}

const specialChannel = {
  id: "ch-announce",
  name: "announcements",
  nameCn: null,
  slug: "announcements",
  type: "special",
  description: "Announcements",
  isFixed: true,
  requiredTagId: null,
  sortOrder: 0,
};

const paymentChannel = {
  id: "ch-payment",
  name: "payment-issues",
  nameCn: null,
  slug: "payment-issues",
  type: "special",
  description: "Payment Issues",
  isFixed: true,
  requiredTagId: null,
  sortOrder: 1,
};

const taskChannel = {
  id: "ch-task1",
  name: "voiceover-basic",
  nameCn: null,
  slug: "voiceover-basic",
  type: "task",
  description: "Voiceover tasks",
  isFixed: false,
  requiredTagId: "tag-1",
  sortOrder: 10,
};

const discussionChannel = {
  id: "ch-general",
  name: "general",
  nameCn: null,
  slug: "general",
  type: "discussion",
  description: "General chat",
  isFixed: false,
  requiredTagId: null,
  sortOrder: 20,
};

const allChannels = [specialChannel, paymentChannel, taskChannel, discussionChannel];

beforeEach(() => jest.clearAllMocks());

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/channels", () => {
  it("returns 401 when not authenticated", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns all non-payment channels for a creator with matching tag", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({
      userId: "u1",
      role: "creator",
    });
    mockSelectReturning(allChannels);    // 1: all channels
    mockSelectReturning([{ tagId: "tag-1" }]); // 2: user tags
    mockSelectReturning([]);              // 3: unread channels query

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    // Creator should see: announcements, voiceover-basic (has tag), general
    // Should NOT see: payment-issues
    expect(json.channels).toHaveLength(3);
    expect(json.channels.map((c: any) => c.slug)).toEqual(
      expect.arrayContaining(["announcements", "voiceover-basic", "general"])
    );
    expect(json.channels.map((c: any) => c.slug)).not.toContain("payment-issues");
  });

  it("hides tag-gated task channels from creators without matching tag", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({
      userId: "u2",
      role: "creator",
    });
    mockSelectReturning(allChannels); // 1: all channels
    mockSelectReturning([]);          // 2: no tags
    mockSelectReturning([]);          // 3: unread channels

    const res = await GET();
    const json = await res.json();
    // Creator sees all non-payment channels (tag-gated ones are visible but marked restricted)
    // announcements + voiceover-basic + general = 3
    expect(json.channels).toHaveLength(3);
    expect(json.channels.map((c: any) => c.slug)).not.toContain("payment-issues");
  });

  it("shows all channels including payment-issues for admin", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({
      userId: "admin-1",
      role: "admin",
    });
    mockSelectReturning(allChannels);  // 1: all channels
    mockSelectReturning([]);           // 2: user tags
    mockSelectReturning([]);           // 3: unread channels
    mockSelectReturning([{ count: 0 }]); // 4: pending appeals count (mod/admin)

    const res = await GET();
    const json = await res.json();
    expect(json.channels).toHaveLength(4);
    expect(json.channels.map((c: any) => c.slug)).toContain("payment-issues");
  });

  it("shows all channels for supermod", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({
      userId: "smod-1",
      role: "supermod",
    });
    mockSelectReturning(allChannels); // 1: all channels
    mockSelectReturning([]);          // 2: user tags
    mockSelectReturning([]);          // 3: unread channels
    mockSelectReturning([{ count: 0 }]); // 4: pending appeals count

    const res = await GET();
    const json = await res.json();
    expect(json.channels).toHaveLength(4);
  });
});
