import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  lessons,
  trainerPrompts,
  tests,
  testQuestions,
  userProgress,
  userTags,
  tags,
  uploadSubmissions,
  users,
  notifications,
} from "@/db/schema";
import { getAuthFromCookies } from "@/lib/auth";
import { eq, and, asc, sql, inArray } from "drizzle-orm";
import { publishNotification } from "@/lib/ws-publish";
import {
  openQuestion,
  evaluateReply,
  generateWelcome,
  generateCongrats,
} from "@/lib/llm";

// POST /api/training/session — all learner training actions
export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthFromCookies();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "welcome":
        return handleWelcome(auth.userId);
      case "start-lesson":
        return handleStartLesson(auth, body);
      case "chat-open":
        return handleChatOpen(auth, body);
      case "chat-reply":
        return handleChatReply(auth, body);
      case "get-test-questions":
        return handleGetTestQuestions(auth, body);
      case "test-answer":
        return handleTestAnswer(auth, body);
      case "test-upload":
        return handleTestUpload(auth, body);
      case "review-lesson":
        return handleReviewLesson(auth, body);
      default:
        return NextResponse.json(
          { error: "Unknown action" },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error("POST /api/training/session error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ── Welcome: get lesson list with statuses ──────────────────────────────────

async function handleWelcome(userId: string) {
  // Get user info for welcome message
  const [user] = await db
    .select({ username: users.username, displayName: users.displayName, locale: users.locale })
    .from(users)
    .where(eq(users.id, userId));
  const userName = user?.displayName || user?.username || "learner";
  const userLocale = user?.locale || "en";

  // Get all published lessons
  const publishedLessons = await db
    .select()
    .from(lessons)
    .where(eq(lessons.status, "published"))
    .orderBy(asc(lessons.order));

  // Get user's tags
  const myTags = await db
    .select({ tagId: userTags.tagId })
    .from(userTags)
    .where(eq(userTags.userId, userId));
  const myTagIds = new Set(myTags.map((t) => t.tagId));

  // Get user progress for all lessons
  const myProgress = await db
    .select()
    .from(userProgress)
    .where(eq(userProgress.userId, userId));
  const progressByLesson = new Map(myProgress.map((p) => [p.lessonId, p]));

  // Build lesson list with statuses
  const completedNames: string[] = [];
  const availableNames: string[] = [];

  const lessonList = publishedLessons.map((lesson) => {
    const progress = progressByLesson.get(lesson.id);

    let status: "completed" | "in_progress" | "available" | "locked" | "failed";
    if (progress?.status === "passed") {
      status = "completed";
      completedNames.push(lesson.title);
    } else if (
      progress?.status === "failed" &&
      progress.retryAfter &&
      new Date(progress.retryAfter) > new Date()
    ) {
      status = "failed";
    } else if (
      progress &&
      ["in_training", "in_test", "pending_review"].includes(progress.status)
    ) {
      status = "in_progress";
    } else if (
      !lesson.prerequisiteTagId ||
      myTagIds.has(lesson.prerequisiteTagId)
    ) {
      status = "available";
      availableNames.push(lesson.title);
    } else {
      status = "locked";
    }

    // Find which lesson awards the prerequisite tag (so we can show its name)
    let prerequisiteLessonTitle: string | null = null;
    if (lesson.prerequisiteTagId && status === "locked") {
      const prereqLesson = publishedLessons.find(
        (l) => l.tagId === lesson.prerequisiteTagId
      );
      if (prereqLesson) {
        prerequisiteLessonTitle = prereqLesson.title;
      }
    }

    return {
      id: lesson.id,
      title: lesson.title,
      titleCn: lesson.titleCn,
      description: lesson.description,
      descriptionCn: lesson.descriptionCn,
      order: lesson.order,
      status,
      tagId: lesson.tagId,
      prerequisiteTagId: lesson.prerequisiteTagId,
      prerequisiteLessonTitle,
      progress: progress
        ? {
            id: progress.id,
            status: progress.status,
            currentPromptIndex: progress.currentPromptIndex,
            score: progress.score,
            retryAfter: progress.retryAfter,
          }
        : null,
    };
  });

  // Generate welcome message (non-blocking — fallback if LLM fails)
  let welcomeMessage: string;
  try {
    welcomeMessage = await generateWelcome(
      userName,
      completedNames,
      availableNames,
      userLocale
    );
  } catch {
    welcomeMessage = `Welcome, ${userName}! Ready to start your training?`;
  }

  return NextResponse.json({
    welcomeMessage,
    lessons: lessonList,
  });
}

// ── Start Lesson: create or resume progress ─────────────────────────────────

async function handleStartLesson(
  auth: { userId: string },
  body: { lessonId: string }
) {
  const { lessonId } = body;

  // Verify lesson exists and is published
  const [lesson] = await db
    .select()
    .from(lessons)
    .where(and(eq(lessons.id, lessonId), eq(lessons.status, "published")));

  if (!lesson) {
    return NextResponse.json(
      { error: "Lesson not found or not published" },
      { status: 404 }
    );
  }

  // Check prerequisite
  if (lesson.prerequisiteTagId) {
    const [hasTag] = await db
      .select()
      .from(userTags)
      .where(
        and(
          eq(userTags.userId, auth.userId),
          eq(userTags.tagId, lesson.prerequisiteTagId)
        )
      );
    if (!hasTag) {
      return NextResponse.json(
        { error: "Prerequisite not met" },
        { status: 403 }
      );
    }
  }

  // Check existing progress
  let [progress] = await db
    .select()
    .from(userProgress)
    .where(
      and(
        eq(userProgress.lessonId, lessonId),
        eq(userProgress.userId, auth.userId)
      )
    );

  if (progress?.status === "passed") {
    return NextResponse.json(
      { error: "Already completed this lesson" },
      { status: 400 }
    );
  }

  // Check retry cooldown
  if (
    progress?.status === "failed" &&
    progress.retryAfter &&
    new Date(progress.retryAfter) > new Date()
  ) {
    return NextResponse.json(
      {
        error: `Retry available after ${new Date(progress.retryAfter).toISOString()}`,
        retryAfter: progress.retryAfter,
      },
      { status: 400 }
    );
  }

  // Create or reset progress
  if (!progress || progress.status === "failed") {
    if (progress) {
      // Reset for retry
      await db
        .update(userProgress)
        .set({
          status: "in_training",
          currentPromptIndex: 0,
          attempts: 0,
          cheatingWarnings: 0,
          score: null,
          completedAt: null,
          retryAfter: null,
          conversationHistory: [],
          testAnswers: [],
          updatedAt: new Date(),
        })
        .where(eq(userProgress.id, progress.id));
      [progress] = await db
        .select()
        .from(userProgress)
        .where(eq(userProgress.id, progress.id));
    } else {
      [progress] = await db
        .insert(userProgress)
        .values({
          lessonId,
          userId: auth.userId,
          status: "in_training",
          conversationHistory: [],
          testAnswers: [],
        })
        .returning();
    }
  }

  // Get prompts count for progress bar
  const [promptCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(trainerPrompts)
    .where(eq(trainerPrompts.lessonId, lessonId));

  return NextResponse.json({
    progress,
    totalPrompts: promptCount.count,
    lesson: {
      id: lesson.id,
      title: lesson.title,
      titleCn: lesson.titleCn,
    },
  });
}

// ── Review Lesson: read-only conversation history for completed lessons ─────

async function handleReviewLesson(
  auth: { userId: string },
  body: { lessonId: string }
) {
  const { lessonId } = body;

  // Get progress for this user + lesson
  const [progress] = await db
    .select()
    .from(userProgress)
    .where(
      and(
        eq(userProgress.lessonId, lessonId),
        eq(userProgress.userId, auth.userId)
      )
    );

  if (!progress || !["passed", "in_test", "pending_review"].includes(progress.status)) {
    return NextResponse.json(
      { error: "No reviewable progress found for this lesson" },
      { status: 404 }
    );
  }

  // Get lesson info
  const [lesson] = await db
    .select({ id: lessons.id, title: lessons.title, titleCn: lessons.titleCn })
    .from(lessons)
    .where(eq(lessons.id, lessonId));

  const [promptCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(trainerPrompts)
    .where(eq(trainerPrompts.lessonId, lessonId));

  return NextResponse.json({
    lesson: lesson || { id: lessonId, title: "Lesson" },
    totalPrompts: promptCount?.count || 0,
    conversationHistory: progress.conversationHistory || [],
  });
}

// ── Chat Open: Call Type A ──────────────────────────────────────────────────

async function handleChatOpen(
  auth: { userId: string },
  body: { userProgressId: string; promptIndex: number; previousResult?: { correct: boolean; questionNumber: number } }
) {
  const { userProgressId, promptIndex, previousResult } = body;

  // Validate progress ownership
  const [progress] = await db
    .select()
    .from(userProgress)
    .where(
      and(
        eq(userProgress.id, userProgressId),
        eq(userProgress.userId, auth.userId)
      )
    );

  if (!progress) {
    return NextResponse.json({ error: "Progress not found" }, { status: 404 });
  }
  if (progress.status !== "in_training") {
    return NextResponse.json(
      { error: "Not in training phase" },
      { status: 400 }
    );
  }

  // Get the trainer prompt at the given index
  const prompts = await db
    .select()
    .from(trainerPrompts)
    .where(eq(trainerPrompts.lessonId, progress.lessonId))
    .orderBy(asc(trainerPrompts.order));

  if (promptIndex >= prompts.length) {
    return NextResponse.json(
      { error: "Prompt index out of range" },
      { status: 400 }
    );
  }

  const prompt = prompts[promptIndex];

  // Fetch user locale for localized LLM responses
  const [chatOpenUser] = await db
    .select({ locale: users.locale })
    .from(users)
    .where(eq(users.id, auth.userId));
  const chatOpenLocale = chatOpenUser?.locale || "en";

  try {
    const message = await openQuestion(prompt.content, previousResult, chatOpenLocale);

    // Append to conversation history
    const history = [...(progress.conversationHistory || [])];
    history.push({ role: "system", content: `--- Prompt ${promptIndex + 1} ---` });
    history.push({ role: "teacher", content: message });

    await db
      .update(userProgress)
      .set({
        currentPromptIndex: promptIndex,
        conversationHistory: history,
        attempts: 0, // Reset attempts for new prompt
        updatedAt: new Date(),
      })
      .where(eq(userProgress.id, userProgressId));

    return NextResponse.json({
      message,
      promptIndex,
      totalPrompts: prompts.length,
      resources: prompt.resources || [],
    });
  } catch (err) {
    console.error("Chat open LLM error:", err);
    return NextResponse.json(
      { error: "AI tutor temporarily unavailable. Please try again." },
      { status: 503 }
    );
  }
}

// ── Chat Reply: Call Type B ─────────────────────────────────────────────────

async function handleChatReply(
  auth: { userId: string },
  body: {
    userProgressId: string;
    message: string;
  }
) {
  const { userProgressId, message } = body;

  const [progress] = await db
    .select()
    .from(userProgress)
    .where(
      and(
        eq(userProgress.id, userProgressId),
        eq(userProgress.userId, auth.userId)
      )
    );

  if (!progress) {
    return NextResponse.json({ error: "Progress not found" }, { status: 404 });
  }
  if (progress.status !== "in_training") {
    return NextResponse.json(
      { error: "Not in training phase" },
      { status: 400 }
    );
  }

  // Get current trainer prompt
  const prompts = await db
    .select()
    .from(trainerPrompts)
    .where(eq(trainerPrompts.lessonId, progress.lessonId))
    .orderBy(asc(trainerPrompts.order));

  const currentPrompt = prompts[progress.currentPromptIndex];
  if (!currentPrompt) {
    return NextResponse.json(
      { error: "Current prompt not found" },
      { status: 400 }
    );
  }

  // Build conversation for this prompt only (filter from last prompt marker)
  const fullHistory = progress.conversationHistory || [];
  const lastPromptMarkerIdx = fullHistory.findLastIndex(
    (m) =>
      m.role === "system" &&
      m.content.startsWith(`--- Prompt ${progress.currentPromptIndex + 1}`)
  );
  const currentConversation = fullHistory
    .slice(lastPromptMarkerIdx + 1)
    .filter((m) => m.role === "teacher" || m.role === "student") as {
    role: "teacher" | "student";
    content: string;
  }[];

  // Add the student message
  currentConversation.push({ role: "student", content: message });

  // Fetch user locale for localized LLM responses
  const [chatReplyUser] = await db
    .select({ locale: users.locale })
    .from(users)
    .where(eq(users.id, auth.userId));
  const chatReplyLocale = chatReplyUser?.locale || "en";

  try {
    const result = await evaluateReply(
      currentPrompt.content,
      currentConversation,
      progress.attempts,
      chatReplyLocale
    );

    // Update history
    const history = [...fullHistory];
    history.push({ role: "student", content: message });
    history.push({ role: "teacher", content: result.teacher_response });

    // Update progress
    let newAttempts = progress.attempts;
    let newCheatingWarnings = progress.cheatingWarnings;
    let advanceToNext = false;

    if (result.student_is_attempting_cheating) {
      newCheatingWarnings++;
    } else if (result.last_attempt_correct) {
      advanceToNext = true;
    } else {
      newAttempts++;
      if (newAttempts >= 5) {
        advanceToNext = true; // Forced reveal
      }
    }

    const isLastPrompt =
      progress.currentPromptIndex >= prompts.length - 1;
    const transitionToTest = advanceToNext && isLastPrompt;

    await db
      .update(userProgress)
      .set({
        attempts: advanceToNext ? 0 : newAttempts,
        cheatingWarnings: newCheatingWarnings,
        conversationHistory: history,
        status: transitionToTest ? "in_test" : "in_training",
        currentPromptIndex: advanceToNext && !isLastPrompt
          ? progress.currentPromptIndex + 1
          : progress.currentPromptIndex,
        updatedAt: new Date(),
      })
      .where(eq(userProgress.id, userProgressId));

    return NextResponse.json({
      ...result,
      advanceToNext,
      transitionToTest,
      currentPromptIndex: progress.currentPromptIndex,
      totalPrompts: prompts.length,
      attempts: advanceToNext ? 0 : newAttempts,
      cheatingWarnings: newCheatingWarnings,
    });
  } catch (err) {
    console.error("Chat reply LLM error:", err);
    return NextResponse.json(
      { error: "AI tutor temporarily unavailable. Please try again." },
      { status: 503 }
    );
  }
}

// ── Get Test Questions: load questions for the learner ───────────────────────

async function handleGetTestQuestions(
  auth: { userId: string },
  body: { userProgressId: string }
) {
  const { userProgressId } = body;

  const [progress] = await db
    .select()
    .from(userProgress)
    .where(
      and(
        eq(userProgress.id, userProgressId),
        eq(userProgress.userId, auth.userId)
      )
    );

  if (!progress) {
    return NextResponse.json({ error: "Progress not found" }, { status: 404 });
  }
  if (progress.status !== "in_test") {
    return NextResponse.json({ error: "Not in test phase" }, { status: 400 });
  }

  const [test] = await db
    .select()
    .from(tests)
    .where(eq(tests.lessonId, progress.lessonId));

  if (!test) {
    return NextResponse.json({ error: "Test not found" }, { status: 404 });
  }

  const questions = await db
    .select({
      id: testQuestions.id,
      type: testQuestions.type,
      prompt: testQuestions.prompt,
      promptCn: testQuestions.promptCn,
      options: testQuestions.options,
      points: testQuestions.points,
      sortOrder: testQuestions.sortOrder,
    })
    .from(testQuestions)
    .where(eq(testQuestions.testId, test.id))
    .orderBy(asc(testQuestions.sortOrder));

  // Include which questions are already answered so frontend can skip them
  const answeredIds = (progress.testAnswers || []).map(
    (a: { questionId: string }) => a.questionId
  );

  // Also include upload questions that have submissions
  const existingUploads = await db
    .select({ testQuestionId: uploadSubmissions.testQuestionId })
    .from(uploadSubmissions)
    .where(eq(uploadSubmissions.userProgressId, userProgressId));
  for (const u of existingUploads) {
    if (!answeredIds.includes(u.testQuestionId)) {
      answeredIds.push(u.testQuestionId);
    }
  }

  // Don't send correctAnswers to the learner!
  return NextResponse.json({
    questions,
    answeredIds,
    score: progress.score,
  });
}

// ── Test Answer: deterministic scoring ──────────────────────────────────────

async function handleTestAnswer(
  auth: { userId: string },
  body: { userProgressId: string; questionId: string; answer: unknown }
) {
  const { userProgressId, questionId, answer } = body;

  const [progress] = await db
    .select()
    .from(userProgress)
    .where(
      and(
        eq(userProgress.id, userProgressId),
        eq(userProgress.userId, auth.userId)
      )
    );

  if (!progress) {
    return NextResponse.json({ error: "Progress not found" }, { status: 404 });
  }
  if (progress.status !== "in_test") {
    return NextResponse.json(
      { error: "Not in test phase" },
      { status: 400 }
    );
  }

  // Check not already answered
  const existingAnswers = progress.testAnswers || [];
  if (existingAnswers.some((a) => a.questionId === questionId)) {
    return NextResponse.json(
      { error: "Already answered this question" },
      { status: 400 }
    );
  }

  // Get the question
  const [question] = await db
    .select()
    .from(testQuestions)
    .where(eq(testQuestions.id, questionId));

  if (!question) {
    return NextResponse.json(
      { error: "Question not found" },
      { status: 404 }
    );
  }

  // Evaluate answer deterministically
  const correctAnswers = question.correctAnswers as Record<string, unknown>;
  let isCorrect = false;

  switch (question.type) {
    case "mc": {
      isCorrect =
        (correctAnswers as { correctIndex: number }).correctIndex === answer;
      break;
    }
    case "tf": {
      isCorrect =
        (correctAnswers as { correct: boolean }).correct === answer;
      break;
    }
    case "rating": {
      const ca = correctAnswers as {
        correctRating: string;
        correctReasonIndex?: number;
      };
      const userAnswer = answer as {
        rating: string;
        reasonIndex?: number;
      };
      // Rating must match; reasonIndex only matters when correct answer is "Bad"
      const ratingMatches = ca.correctRating === userAnswer.rating;
      const reasonMatches =
        ca.correctRating !== "Bad" ||
        ca.correctReasonIndex === undefined ||
        ca.correctReasonIndex === userAnswer.reasonIndex;
      isCorrect = ratingMatches && reasonMatches;
      break;
    }
    case "upload": {
      // Upload questions are not auto-scored
      isCorrect = true; // placeholder — reviewed by humans
      break;
    }
  }

  // Save answer
  const updatedAnswers = [
    ...existingAnswers,
    {
      questionId,
      answer,
      correct: isCorrect,
      points: isCorrect ? question.points : 0,
    },
  ];

  // Get all questions to check if test is complete
  const [test] = await db
    .select()
    .from(tests)
    .where(eq(tests.lessonId, progress.lessonId));

  const allQuestions = await db
    .select()
    .from(testQuestions)
    .where(eq(testQuestions.testId, test.id))
    .orderBy(asc(testQuestions.sortOrder));

  // Exclude upload questions from score — they are pass/fail by human review, not points
  const hasUploads = allQuestions.some((q) => q.type === "upload");
  const scoredQuestions = allQuestions.filter((q) => q.type !== "upload");
  const totalPoints = scoredQuestions.reduce((sum, q) => sum + q.points, 0);
  const nonUploadAnswers = updatedAnswers.filter((a) => {
    const q = allQuestions.find((q) => q.id === a.questionId);
    return q?.type !== "upload";
  });
  const earnedPoints = nonUploadAnswers.reduce((sum, a) => sum + a.points, 0);
  const score = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 100;

  // Check completion: non-upload questions are tracked in testAnswers,
  // upload questions are tracked in uploadSubmissions
  const nonUploadQuestions = allQuestions.filter((q) => q.type !== "upload");
  const uploadQuestions = allQuestions.filter((q) => q.type === "upload");
  const answeredNonUpload = updatedAnswers.filter((a) => {
    const q = allQuestions.find((q) => q.id === a.questionId);
    return q?.type !== "upload";
  });
  const allNonUploadDone = answeredNonUpload.length >= nonUploadQuestions.length;

  // Check if all upload questions have submissions
  let allUploadsDone = true;
  if (uploadQuestions.length > 0) {
    const uploadQuestionIds = uploadQuestions.map((q) => q.id);
    const existingUploads = await db
      .select({ testQuestionId: uploadSubmissions.testQuestionId })
      .from(uploadSubmissions)
      .where(eq(uploadSubmissions.userProgressId, userProgressId));
    const uploadedIds = new Set(existingUploads.map((u) => u.testQuestionId));
    allUploadsDone = uploadQuestionIds.every((id) => uploadedIds.has(id));
  }

  const isComplete = allNonUploadDone && allUploadsDone;

  let newStatus: string = progress.status;
  if (isComplete) {
    if (hasUploads) {
      // Has upload questions — go to pending_review regardless
      newStatus = "pending_review";
    } else {
      newStatus = score >= (await getLessonPassingScore(progress.lessonId))
        ? "passed"
        : "failed";
    }
  }

  const updateData: Record<string, unknown> = {
    testAnswers: updatedAnswers,
    score,
    updatedAt: new Date(),
  };

  if (newStatus !== progress.status) {
    updateData.status = newStatus;
    if (newStatus === "passed") {
      updateData.completedAt = new Date();
    }
    if (newStatus === "failed") {
      const [lesson] = await db
        .select({ retryAfterHours: lessons.retryAfterHours })
        .from(lessons)
        .where(eq(lessons.id, progress.lessonId));
      updateData.retryAfter = new Date(
        Date.now() + (lesson.retryAfterHours || 24) * 60 * 60 * 1000
      );
    }
  }

  await db
    .update(userProgress)
    .set(updateData)
    .where(eq(userProgress.id, userProgressId));

  // Award tag if passed
  if (newStatus === "passed") {
    await awardTag(auth.userId, progress.lessonId);
  }

  // Send notification on test completion (immediate — no uploads)
  if (isComplete && (newStatus === "passed" || newStatus === "failed")) {
    const [lessonInfo] = await db
      .select({ title: lessons.title })
      .from(lessons)
      .where(eq(lessons.id, progress.lessonId));

    if (newStatus === "passed") {
      await db.insert(notifications).values({
        userId: auth.userId,
        type: "training_passed",
        title: "Training passed!",
        body: `You passed "${lessonInfo?.title}" with a score of ${score}%. A new tag has been awarded!`,
        data: { lessonId: progress.lessonId, score },
      });
    } else {
      await db.insert(notifications).values({
        userId: auth.userId,
        type: "training_failed",
        title: "Training not passed",
        body: `You scored ${score}% on "${lessonInfo?.title}". You can retry later.`,
        data: { lessonId: progress.lessonId, score },
      });
    }

    publishNotification(auth.userId, {
      type: newStatus === "passed" ? "training_passed" : "training_failed",
      title: newStatus === "passed" ? "Training passed!" : "Training not passed",
      unreadCount: -1,
    });
  }

  return NextResponse.json({
    correct: isCorrect,
    correctAnswers: question.correctAnswers,
    score,
    earnedPoints,
    totalPoints,
    isComplete,
    testStatus: newStatus,
  });
}

// ── Test Upload: submit a file for review ───────────────────────────────────

async function handleTestUpload(
  auth: { userId: string },
  body: {
    userProgressId: string;
    questionId: string;
    fileUrl: string;
    fileName: string;
    fileType: string;
    fileSize: number;
  }
) {
  const { userProgressId, questionId, fileUrl, fileName, fileType, fileSize } =
    body;

  const [progress] = await db
    .select()
    .from(userProgress)
    .where(
      and(
        eq(userProgress.id, userProgressId),
        eq(userProgress.userId, auth.userId)
      )
    );

  if (!progress || progress.status !== "in_test") {
    return NextResponse.json(
      { error: "Not in test phase" },
      { status: 400 }
    );
  }

  const [submission] = await db
    .insert(uploadSubmissions)
    .values({
      testQuestionId: questionId,
      userProgressId,
      userId: auth.userId,
      fileUrl,
      fileName,
      fileType,
      fileSize,
    })
    .returning();

  // Notify admins/supermods/mods that there's a new upload to review
  const [lessonInfo] = await db
    .select({ title: lessons.title })
    .from(lessons)
    .where(eq(lessons.id, progress.lessonId));

  const [userData] = await db
    .select({ username: users.username, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, auth.userId));

  const creatorName = userData?.displayName || userData?.username || "A learner";

  // Get all mods/supermods/admins to notify
  const reviewers = await db
    .select({ id: users.id })
    .from(users)
    .where(
      sql`${users.role} IN ('mod', 'supermod', 'admin') AND ${users.status} = 'verified'`
    );

  if (reviewers.length > 0) {
    await db.insert(notifications).values(
      reviewers.map((r) => ({
        userId: r.id,
        type: "upload_pending_review",
        title: "New upload for review",
        body: `${creatorName} submitted an upload for "${lessonInfo?.title || "Training"}". Review it in Upload Reviews.`,
        data: { submissionId: submission.id, lessonId: progress.lessonId },
      }))
    );

    for (const r of reviewers) {
      publishNotification(r.id, {
        type: "upload_pending_review",
        title: "New upload for review",
        unreadCount: -1,
      });
    }
  }

  // Check if all questions are now done (all uploads submitted + all non-upload answered)
  const [test] = await db
    .select()
    .from(tests)
    .where(eq(tests.lessonId, progress.lessonId));

  let allDone = false;
  if (test) {
    const allQuestions = await db
      .select()
      .from(testQuestions)
      .where(eq(testQuestions.testId, test.id));
    const uploadQuestionIds = allQuestions.filter((q) => q.type === "upload").map((q) => q.id);
    const nonUploadQuestions = allQuestions.filter((q) => q.type !== "upload");

    // Check all uploads have submissions
    const allUploadSubs = await db
      .select({ testQuestionId: uploadSubmissions.testQuestionId })
      .from(uploadSubmissions)
      .where(eq(uploadSubmissions.userProgressId, userProgressId));
    const uploadedIds = new Set(allUploadSubs.map((u) => u.testQuestionId));
    const allUploadsDone = uploadQuestionIds.every((id) => uploadedIds.has(id));

    // Check all non-upload questions answered
    const answeredCount = (progress.testAnswers || []).length;
    const allNonUploadDone = answeredCount >= nonUploadQuestions.length;

    allDone = allUploadsDone && allNonUploadDone;
  }

  if (allDone && progress.status === "in_test") {
    await db
      .update(userProgress)
      .set({ status: "pending_review", updatedAt: new Date() })
      .where(eq(userProgress.id, userProgressId));
  }

  return NextResponse.json({ ...submission, allDone }, { status: 201 });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getLessonPassingScore(lessonId: string): Promise<number> {
  const [lesson] = await db
    .select({ passingScore: lessons.passingScore })
    .from(lessons)
    .where(eq(lessons.id, lessonId));
  return lesson?.passingScore ?? 100;
}

function determineTestResult(
  score: number,
  progress: typeof userProgress.$inferSelect
): string {
  // This is a simplified version — the full check happens after upload review
  return "pending_review";
}

async function awardTag(userId: string, lessonId: string) {
  const [lesson] = await db
    .select({ tagId: lessons.tagId })
    .from(lessons)
    .where(eq(lessons.id, lessonId));

  if (!lesson?.tagId) return;

  // Check if already has the tag
  const [existing] = await db
    .select()
    .from(userTags)
    .where(
      and(eq(userTags.userId, userId), eq(userTags.tagId, lesson.tagId))
    );

  if (existing) return;

  await db.insert(userTags).values({
    userId,
    tagId: lesson.tagId,
    grantedAt: new Date(),
  });

  // Fire webhook (fire-and-forget)
  const webhookUrl = process.env.BACKEND_WEBHOOK_URL;
  if (webhookUrl) {
    fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Event": "tag.awarded",
        "X-API-Key": process.env.BACKEND_API_KEY || "",
      },
      body: JSON.stringify({
        userId,
        tagId: lesson.tagId,
        lessonId,
        passedAt: new Date().toISOString(),
      }),
    }).catch(() => {});
  }
}
