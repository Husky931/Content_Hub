import { NextRequest } from "next/server";

// ── Mocks ──────────────────────────────────────────────────────────────────
jest.mock("@/db", () => ({
  db: { select: jest.fn(), insert: jest.fn(), update: jest.fn() },
}));
jest.mock("@/lib/auth", () => ({
  getAuthFromCookies: jest.fn(),
}));
jest.mock("@/lib/llm", () => ({
  openQuestion: jest.fn(),
  evaluateReply: jest.fn(),
  generateWelcome: jest.fn(),
  generateCongrats: jest.fn(),
}));
jest.mock("@/lib/ws-publish", () => ({
  publishNotification: jest.fn(),
}));

import { POST } from "@/app/api/training/session/route";
import { db } from "@/db";
import { getAuthFromCookies } from "@/lib/auth";
import { openQuestion, evaluateReply, generateWelcome } from "@/lib/llm";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeReq(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/training/session", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function mockSelect(rows: unknown[]) {
  const whereMock = jest.fn().mockResolvedValue(rows);
  const orderByMock = jest.fn().mockResolvedValue(rows);
  const fromResult: any = { where: whereMock, orderBy: orderByMock };
  whereMock.mockReturnValue({ orderBy: orderByMock, limit: jest.fn().mockResolvedValue(rows), then: (cb: any) => Promise.resolve(rows).then(cb) });
  Object.assign(fromResult, Promise.resolve(rows));
  const fromMock = jest.fn().mockReturnValue(fromResult);
  (db.select as jest.Mock).mockReturnValueOnce({ from: fromMock });
}

function mockInsertReturning(rows: unknown[]) {
  const returningMock = jest.fn().mockResolvedValue(rows);
  const valuesMock = jest.fn().mockReturnValue({ returning: returningMock });
  (db.insert as jest.Mock).mockReturnValueOnce({ values: valuesMock });
}

function mockInsert() {
  const valuesMock = jest.fn().mockResolvedValue([]);
  (db.insert as jest.Mock).mockReturnValueOnce({ values: valuesMock });
}

function mockUpdate() {
  const whereMock = jest.fn().mockResolvedValue([]);
  const setMock = jest.fn().mockReturnValue({ where: whereMock });
  (db.update as jest.Mock).mockReturnValueOnce({ set: setMock });
}

beforeEach(() => jest.clearAllMocks());

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/training/session", () => {
  it("returns 401 when not authenticated", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue(null);

    const res = await POST(makeReq({ action: "welcome" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for unknown action", async () => {
    (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "u1", role: "creator" });

    const res = await POST(makeReq({ action: "does-not-exist" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/unknown/i);
  });

  // ── welcome ────────────────────────────────────────────────────────────

  describe("action: welcome", () => {
    it("returns 200 with welcome message and lesson list", async () => {
      (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "u1", role: "creator" });

      // 1. select user (with locale)
      mockSelect([{ username: "alice", displayName: "Alice", locale: "en" }]);
      // 2. select published lessons
      mockSelect([
        { id: "les-1", title: "Lesson 1", titleCn: null, description: "desc", descriptionCn: null, order: 1, status: "published", tagId: "tag-1", prerequisiteTagId: null },
      ]);
      // 3. select userTags
      mockSelect([]);
      // 4. select userProgress
      mockSelect([]);

      (generateWelcome as jest.Mock).mockResolvedValue("Welcome, Alice!");

      const res = await POST(makeReq({ action: "welcome" }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.welcomeMessage).toBe("Welcome, Alice!");
      expect(json.lessons).toHaveLength(1);
      expect(json.lessons[0].status).toBe("available");
    });
  });

  // ── start-lesson ──────────────────────────────────────────────────────

  describe("action: start-lesson", () => {
    it("returns 404 when lesson not found", async () => {
      (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "u1", role: "creator" });

      // 1. select lesson -> not found
      mockSelect([]);

      const res = await POST(makeReq({ action: "start-lesson", lessonId: "les-999" }));
      expect(res.status).toBe(404);
    });

    it("returns 200 and creates new progress", async () => {
      (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "u1", role: "creator" });

      // 1. select lesson (published, no prerequisite)
      mockSelect([{ id: "les-1", title: "Lesson 1", titleCn: "L1", status: "published", prerequisiteTagId: null, tagId: "tag-1", passingScore: 80 }]);
      // 2. select existing progress -> none
      mockSelect([]);
      // 3. insert progress returning
      mockInsertReturning([{
        id: "prog-1",
        lessonId: "les-1",
        userId: "u1",
        status: "in_training",
        currentPromptIndex: 0,
        attempts: 0,
        cheatingWarnings: 0,
        conversationHistory: [],
        testAnswers: [],
        score: null,
      }]);
      // 4. select prompt count
      mockSelect([{ count: 3 }]);

      const res = await POST(makeReq({ action: "start-lesson", lessonId: "les-1" }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.progress.id).toBe("prog-1");
      expect(json.totalPrompts).toBe(3);
      expect(json.lesson.id).toBe("les-1");
    });
  });

  // ── chat-open ─────────────────────────────────────────────────────────

  describe("action: chat-open", () => {
    it("returns 404 when progress not found", async () => {
      (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "u1", role: "creator" });

      // 1. select progress -> not found
      mockSelect([]);

      const res = await POST(makeReq({ action: "chat-open", userProgressId: "prog-x", promptIndex: 0 }));
      expect(res.status).toBe(404);
    });

    it("returns 200 with teacher message", async () => {
      (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "u1", role: "creator" });

      // 1. select progress
      mockSelect([{ id: "prog-1", userId: "u1", lessonId: "les-1", status: "in_training", currentPromptIndex: 0, conversationHistory: [], attempts: 0 }]);
      // 2. select prompts for lesson (ordered)
      mockSelect([{ id: "pr-1", content: "Explain X", order: 0, resources: ["link1"], lessonId: "les-1" }]);
      // 3. select user locale
      mockSelect([{ locale: "en" }]);

      (openQuestion as jest.Mock).mockResolvedValue("Teacher says: Let me explain X.");

      // 4. update progress
      mockUpdate();

      const res = await POST(makeReq({ action: "chat-open", userProgressId: "prog-1", promptIndex: 0 }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.message).toBe("Teacher says: Let me explain X.");
      expect(json.promptIndex).toBe(0);
      expect(json.totalPrompts).toBe(1);
    });
  });

  // ── chat-reply ────────────────────────────────────────────────────────

  describe("action: chat-reply", () => {
    it("returns 200 with evaluation", async () => {
      (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "u1", role: "creator" });

      // 1. select progress
      mockSelect([{
        id: "prog-1",
        userId: "u1",
        lessonId: "les-1",
        status: "in_training",
        currentPromptIndex: 0,
        conversationHistory: [
          { role: "system", content: "--- Prompt 1 ---" },
          { role: "teacher", content: "What is X?" },
        ],
        attempts: 0,
        cheatingWarnings: 0,
      }]);
      // 2. select prompts
      mockSelect([{ id: "pr-1", content: "Explain X", order: 0, lessonId: "les-1" }]);
      // 3. select user locale
      mockSelect([{ locale: "en" }]);

      (evaluateReply as jest.Mock).mockResolvedValue({
        teacher_response: "Correct!",
        last_attempt_correct: true,
        student_is_attempting_cheating: false,
      });

      // 4. update progress
      mockUpdate();

      const res = await POST(makeReq({ action: "chat-reply", userProgressId: "prog-1", message: "X is something" }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.teacher_response).toBe("Correct!");
      expect(json.last_attempt_correct).toBe(true);
      expect(json.advanceToNext).toBe(true);
    });
  });

  // ── get-test-questions ────────────────────────────────────────────────

  describe("action: get-test-questions", () => {
    it("returns 200 with questions", async () => {
      (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "u1", role: "creator" });

      // 1. select progress (in_test)
      mockSelect([{ id: "prog-1", userId: "u1", lessonId: "les-1", status: "in_test", testAnswers: [] }]);
      // 2. select test
      mockSelect([{ id: "test-1", lessonId: "les-1" }]);
      // 3. select questions
      mockSelect([
        { id: "q-1", type: "mc", prompt: "What?", promptCn: null, options: ["A", "B"], points: 10, sortOrder: 1 },
      ]);
      // 4. select existing upload submissions
      mockSelect([]);

      const res = await POST(makeReq({ action: "get-test-questions", userProgressId: "prog-1" }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.questions).toHaveLength(1);
      expect(json.questions[0].id).toBe("q-1");
      expect(json.answeredIds).toEqual([]);
    });
  });

  // ── test-answer ───────────────────────────────────────────────────────

  describe("action: test-answer", () => {
    it("returns 200 and scores a correct MC answer", async () => {
      (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "u1", role: "creator" });

      // 1. select progress (in_test, no existing answers)
      mockSelect([{
        id: "prog-1",
        userId: "u1",
        lessonId: "les-1",
        status: "in_test",
        testAnswers: [],
        score: 0,
      }]);
      // 2. select question
      mockSelect([{
        id: "q-1",
        type: "mc",
        prompt: "What?",
        points: 10,
        correctAnswers: { correctIndex: 1 },
      }]);
      // 3. select test
      mockSelect([{ id: "test-1", lessonId: "les-1" }]);
      // 4. select all questions in test (only 1 non-upload)
      mockSelect([{
        id: "q-1",
        type: "mc",
        prompt: "What?",
        points: 10,
        correctAnswers: { correctIndex: 1 },
      }]);
      // NOTE: isComplete=true, no upload questions, so it checks passing score.
      // 5. getLessonPassingScore: select lesson
      mockSelect([{ passingScore: 80 }]);
      // 6. update progress
      mockUpdate();
      // 7. awardTag: select lesson tagId
      mockSelect([{ tagId: "tag-1" }]);
      // 8. awardTag: select existing userTag -> none
      mockSelect([]);
      // 9. awardTag: insert userTag
      mockInsert();
      // 10. notification: select lesson title
      mockSelect([{ title: "Lesson 1" }]);
      // 11. insert notification
      mockInsert();

      const res = await POST(makeReq({ action: "test-answer", userProgressId: "prog-1", questionId: "q-1", answer: 1 }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.correct).toBe(true);
      expect(json.score).toBe(100);
      expect(json.isComplete).toBe(true);
      expect(json.testStatus).toBe("passed");
    });
  });

  // ── review-lesson ─────────────────────────────────────────────────────

  describe("action: review-lesson", () => {
    it("returns 404 when no reviewable progress found", async () => {
      (getAuthFromCookies as jest.Mock).mockResolvedValue({ userId: "u1", role: "creator" });

      // 1. select progress -> none
      mockSelect([]);

      const res = await POST(makeReq({ action: "review-lesson", lessonId: "les-1" }));
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toMatch(/reviewable/i);
    });
  });
});
