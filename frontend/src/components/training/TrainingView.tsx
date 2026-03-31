"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { useLocale } from "next-intl";
import { localized } from "@/lib/localize";
import { SignedMedia } from "@/components/ui/SignedMedia";
import { FileUpload, type UploadedFile } from "@/components/ui/FileUpload";

interface LessonInfo {
  id: string;
  title: string;
  titleCn?: string | null;
  description?: string | null;
  status: "completed" | "in_progress" | "available" | "locked" | "failed";
  tagId?: string | null;
  prerequisiteTagId?: string | null;
  prerequisiteLessonTitle?: string | null;
  progress?: {
    id: string;
    status: string;
    currentPromptIndex: number;
    score?: number | null;
    retryAfter?: string | null;
  } | null;
}

interface ChatMessage {
  role: "teacher" | "student" | "system";
  content: string;
}

interface TestQuestionData {
  id: string;
  type: "mc" | "tf" | "rating" | "upload";
  prompt: string;
  options: unknown;
  points: number;
  sortOrder: number;
}

type Stage = "welcome" | "training" | "test" | "result" | "review";

export function TrainingView() {
  const [stage, setStage] = useState<Stage>("welcome");
  const [loading, setLoading] = useState(true);
  const locale = useLocale();
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [lessons, setLessons] = useState<LessonInfo[]>([]);

  // Training state
  const [activeLesson, setActiveLesson] = useState<{
    id: string;
    title: string;
    titleCn?: string | null;
  } | null>(null);
  const [progressId, setProgressId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [promptIndex, setPromptIndex] = useState(0);
  const [totalPrompts, setTotalPrompts] = useState(0);
  const [attempts, setAttempts] = useState(0);

  // Test state
  const [testQuestions, setTestQuestions] = useState<TestQuestionData[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<unknown>(null);
  const [answerResult, setAnswerResult] = useState<{
    correct: boolean;
    correctAnswers: unknown;
  } | null>(null);
  const [testScore, setTestScore] = useState(0);
  const [testStatus, setTestStatus] = useState("");
  const [uploadFiles, setUploadFiles] = useState<UploadedFile[]>([]);
  const [uploadSubmitted, setUploadSubmitted] = useState(false);

  // Transition state (training → test)
  const [showTestTransition, setShowTestTransition] = useState(false);

  // Review state (read-only lesson replay)
  const [reviewMessages, setReviewMessages] = useState<ChatMessage[]>([]);
  const [reviewingFromTest, setReviewingFromTest] = useState(false);
  const [reviewTotalPrompts, setReviewTotalPrompts] = useState(0);

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadWelcome();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function loadWelcome() {
    setLoading(true);
    try {
      const res = await fetch("/api/training/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "welcome" }),
      });
      if (res.ok) {
        const data = await res.json();
        setWelcomeMessage(data.welcomeMessage);
        setLessons(data.lessons);
      }
    } catch (err) {
      console.error("Failed to load welcome:", err);
    } finally {
      setLoading(false);
    }
  }

  async function startLesson(lessonId: string) {
    setSending(true);
    try {
      const res = await fetch("/api/training/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start-lesson", lessonId }),
      });
      if (res.ok) {
        const data = await res.json();
        setActiveLesson(data.lesson);
        setProgressId(data.progress.id);
        setTotalPrompts(data.totalPrompts);
        setPromptIndex(0);
        setAttempts(0);
        setMessages([]);

        // Check if resuming into test phase
        if (data.progress.status === "in_test") {
          setStage("test");
          await loadTestQuestions(data.progress.id);
        } else if (data.progress.status === "pending_review") {
          // Uploads pending review — show result screen
          setTestScore(data.progress.score || 0);
          setTestStatus("pending_review");
          setStage("result");
        } else {
          setStage("training");
          // Load the prompt at the current index (resume support)
          await loadOpeningMessage(data.progress.id, data.progress.currentPromptIndex || 0);
        }
      } else {
        const err = await res.json();
        alert(err.error || "Failed to start lesson");
      }
    } catch (err) {
      console.error("Failed to start lesson:", err);
    } finally {
      setSending(false);
    }
  }

  async function reviewLesson(lessonId: string, fromTest: boolean) {
    setSending(true);
    try {
      const res = await fetch("/api/training/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "review-lesson", lessonId }),
      });
      if (res.ok) {
        const data = await res.json();
        setActiveLesson({ id: data.lesson.id, title: data.lesson.title, titleCn: data.lesson.titleCn });
        setReviewTotalPrompts(data.totalPrompts);
        setReviewingFromTest(fromTest);
        // Convert saved history to ChatMessage format
        const history: ChatMessage[] = (data.conversationHistory || []).map(
          (m: { role: string; content: string }) => ({
            role: m.role === "teacher" ? "teacher" : m.role === "system" ? "system" : "student",
            content: m.content,
          })
        );
        setReviewMessages(history);
        setStage("review");
      }
    } catch (err) {
      console.error("Failed to load lesson review:", err);
    } finally {
      setSending(false);
    }
  }

  async function loadOpeningMessage(
    pId: string,
    pIndex: number,
    previousResult?: { correct: boolean; questionNumber: number }
  ) {
    setSending(true);
    try {
      const res = await fetch("/api/training/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat-open",
          userProgressId: pId,
          promptIndex: pIndex,
          previousResult,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [
          ...prev,
          { role: "system", content: `--- Question ${pIndex + 1} of ${data.totalPrompts} ---` },
          { role: "teacher", content: data.message },
        ]);
        setPromptIndex(pIndex);
        setTotalPrompts(data.totalPrompts);
        setAttempts(0);
      }
    } catch (err) {
      console.error("Failed to open question:", err);
    } finally {
      setSending(false);
    }
  }

  async function sendReply() {
    if (!inputText.trim() || !progressId || sending) return;

    const userMessage = inputText.trim();
    setInputText("");
    setMessages((prev) => [...prev, { role: "student", content: userMessage }]);
    setSending(true);

    try {
      const res = await fetch("/api/training/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat-reply",
          userProgressId: progressId,
          message: userMessage,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [
          ...prev,
          { role: "teacher", content: data.teacher_response },
        ]);
        setAttempts(data.attempts);

        if (data.transitionToTest) {
          // Show congratulations banner instead of auto-transitioning
          setShowTestTransition(true);
        } else if (data.advanceToNext) {
          // Load next prompt
          setTimeout(() => {
            loadOpeningMessage(progressId!, data.currentPromptIndex + 1, {
              correct: data.last_attempt_correct,
              questionNumber: data.currentPromptIndex + 1,
            });
          }, 1500);
        }
      } else if (res.status === 503) {
        setMessages((prev) => [
          ...prev,
          {
            role: "system",
            content: "AI tutor temporarily unavailable. Please try again.",
          },
        ]);
      }
    } catch (err) {
      console.error("Reply failed:", err);
    } finally {
      setSending(false);
    }
  }

  async function loadTestQuestions(explicitProgressId?: string) {
    const pid = explicitProgressId || progressId;
    if (!pid) return;
    try {
      const res = await fetch("/api/training/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "get-test-questions",
          userProgressId: pid,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const allQuestions: TestQuestionData[] = data.questions || [];
        const answeredSet = new Set<string>(data.answeredIds || []);

        setTestQuestions(allQuestions);
        setTestScore(data.score || 0);
        setSelectedAnswer(null);
        setAnswerResult(null);

        // Skip to first unanswered question
        const firstUnanswered = allQuestions.findIndex(
          (q) => !answeredSet.has(q.id)
        );
        if (firstUnanswered === -1) {
          // All questions answered — go to result
          setStage("result");
        } else {
          setCurrentQuestionIndex(firstUnanswered);
        }
      }
    } catch (err) {
      console.error("Failed to load test questions:", err);
    }
  }

  async function submitTestAnswer() {
    if (!progressId || selectedAnswer === null) return;
    const question = testQuestions[currentQuestionIndex];
    if (!question) return;

    setSending(true);
    try {
      const res = await fetch("/api/training/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test-answer",
          userProgressId: progressId,
          questionId: question.id,
          answer: selectedAnswer,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setAnswerResult({
          correct: data.correct,
          correctAnswers: data.correctAnswers,
        });
        setTestScore(data.score);

        if (data.isComplete) {
          setTestStatus(data.testStatus);
          setTimeout(() => setStage("result"), 2000);
        }
      }
    } catch (err) {
      console.error("Failed to submit answer:", err);
    } finally {
      setSending(false);
    }
  }

  function nextQuestion() {
    setCurrentQuestionIndex((i) => i + 1);
    setSelectedAnswer(null);
    setAnswerResult(null);
    setUploadFiles([]);
    setUploadSubmitted(false);
  }

  // ── Welcome Stage ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner />
      </div>
    );
  }

  if (stage === "welcome") {
    return (
      <div className="flex flex-col h-full bg-discord-bg">
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Bot welcome */}
          <div className="flex gap-3 items-start">
            <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm shrink-0">
              🤖
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-discord-text">
                  Training Bot
                </span>
                <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/20 text-blue-300 rounded font-semibold">
                  BOT
                </span>
              </div>
              <div className="text-sm text-discord-text leading-relaxed">
                {welcomeMessage}
              </div>
            </div>
          </div>

          {/* Lesson list */}
          <div className="ml-[52px] space-y-2">
            {lessons.length === 0 ? (
              <p className="text-sm text-discord-text-muted">
                No training available yet. Check back later!
              </p>
            ) : (
              lessons.map((lesson) => (
                <div
                  key={lesson.id}
                  onClick={() => {
                    if (
                      lesson.status === "available" ||
                      lesson.status === "in_progress"
                    ) {
                      startLesson(lesson.id);
                    } else if (lesson.status === "completed") {
                      reviewLesson(lesson.id, false);
                    }
                  }}
                  className={`p-3 rounded-lg border transition ${
                    lesson.status === "available" || lesson.status === "in_progress"
                      ? "bg-discord-bg-dark border-discord-accent/30 hover:border-discord-accent cursor-pointer"
                      : lesson.status === "completed"
                      ? "bg-discord-bg-dark border-green-500/20 hover:border-green-500/50 cursor-pointer"
                      : "bg-discord-bg-dark border-discord-bg-darker/60 opacity-50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg">
                      {lesson.status === "completed"
                        ? "✅"
                        : lesson.status === "in_progress"
                        ? "🔄"
                        : lesson.status === "available"
                        ? "🆕"
                        : lesson.status === "failed"
                        ? "❌"
                        : "🔒"}
                    </span>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-discord-text">
                        {localized(locale, lesson.title, lesson.titleCn)}
                      </div>
                      {lesson.description && (
                        <div className="text-[11px] text-discord-text-muted">
                          {lesson.description}
                        </div>
                      )}
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        lesson.status === "completed"
                          ? "bg-green-500/20 text-green-300"
                          : lesson.status === "in_progress"
                          ? "bg-blue-500/20 text-blue-300"
                          : lesson.status === "available"
                          ? "bg-blue-500/20 text-blue-300"
                          : lesson.status === "failed"
                          ? "bg-red-500/20 text-red-300"
                          : "bg-discord-bg-darker text-discord-text-muted"
                      }`}
                    >
                      {lesson.status === "completed"
                        ? "COMPLETED"
                        : lesson.status === "in_progress"
                        ? "IN PROGRESS"
                        : lesson.status === "available"
                        ? "START"
                        : lesson.status === "failed"
                        ? (() => {
                            const retryAt = lesson.progress?.retryAfter ? new Date(lesson.progress.retryAfter) : null;
                            if (retryAt && retryAt.getTime() > Date.now()) {
                              const hoursLeft = Math.ceil((retryAt.getTime() - Date.now()) / (1000 * 60 * 60));
                              return hoursLeft >= 1 ? `RETRY IN ${hoursLeft}H` : `RETRY IN <1H`;
                            }
                            return "RETRY NOW";
                          })()
                        : "LOCKED"}
                    </span>
                  </div>
                  {lesson.status === "locked" && lesson.prerequisiteTagId && (
                    <div className="mt-1 ml-8 text-[10px] text-discord-text-muted">
                      🔒 Complete the {lesson.prerequisiteLessonTitle ? `"${lesson.prerequisiteLessonTitle}"` : "prerequisite"} lesson first
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Disabled input */}
        <div className="px-6 py-4 border-t border-discord-bg-darker/60">
          <div className="bg-discord-bg-dark rounded-lg px-4 py-3 text-sm text-discord-text-muted">
            Click a lesson above to begin...
          </div>
        </div>
      </div>
    );
  }

  // ── Training Stage (AI Chat) ──────────────────────────────────────────────

  if (stage === "training") {
    return (
      <div className="flex flex-col h-full bg-discord-bg">
        {/* Progress bar */}
        <div className="px-6 py-2 bg-discord-bg-dark border-b border-discord-bg-darker/60 flex items-center gap-3">
          <button
            onClick={() => {
              setStage("welcome");
              loadWelcome();
            }}
            className="text-discord-text-muted hover:text-discord-text text-xs cursor-pointer"
          >
            ← Exit
          </button>
          <span className="text-xs text-discord-text font-medium">
            {activeLesson ? localized(locale, activeLesson.title, activeLesson.titleCn) : ""}
          </span>
          <div className="flex-1 h-1.5 bg-discord-bg-darker rounded-full overflow-hidden">
            <div
              className="h-full bg-discord-accent rounded-full transition-all"
              style={{
                width: `${totalPrompts > 0 ? ((promptIndex + 1) / totalPrompts) * 100 : 0}%`,
              }}
            />
          </div>
          <span className="text-[10px] text-discord-text-muted">
            Q {promptIndex + 1} / {totalPrompts}
          </span>
          {attempts > 0 && (
            <span className="text-[10px] text-yellow-400">
              Attempt {attempts}/5
            </span>
          )}
        </div>

        {/* Chat messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((msg, i) => {
            if (msg.role === "system") {
              return (
                <div
                  key={i}
                  className="text-center text-[11px] text-discord-text-muted py-2"
                >
                  {msg.content}
                </div>
              );
            }
            if (msg.role === "teacher") {
              return (
                <div key={i} className="flex gap-3 items-start">
                  <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm shrink-0">
                    🤖
                  </div>
                  <div className="max-w-[80%]">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-discord-text">
                        Training Bot
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/20 text-blue-300 rounded font-semibold">
                        BOT
                      </span>
                    </div>
                    <div className="text-sm text-discord-text leading-relaxed whitespace-pre-wrap">
                      {msg.content}
                    </div>
                  </div>
                </div>
              );
            }
            return (
              <div key={i} className="flex gap-3 items-start justify-end">
                <div className="max-w-[80%] bg-discord-accent/20 rounded-lg px-4 py-2">
                  <div className="text-sm text-discord-text">
                    {msg.content}
                  </div>
                </div>
              </div>
            );
          })}
          {sending && (
            <div className="flex gap-3 items-start">
              <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm shrink-0">
                🤖
              </div>
              <div className="text-sm text-discord-text-muted animate-pulse">
                Thinking...
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input or transition banner */}
        <div className="px-6 py-4 border-t border-discord-bg-darker/60">
          {showTestTransition ? (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 text-center">
              <div className="text-lg mb-1">🎉</div>
              <div className="text-sm font-semibold text-green-300 mb-1">
                Training Complete!
              </div>
              <div className="text-[11px] text-discord-text-muted mb-3">
                Great job finishing the lesson. Ready to test your knowledge?
              </div>
              <button
                onClick={async () => {
                  setShowTestTransition(false);
                  setStage("test");
                  await loadTestQuestions();
                }}
                className="px-6 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 cursor-pointer"
              >
                Continue to Test
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendReply();
                  }
                }}
                disabled={sending}
                className="flex-1 bg-discord-bg-dark rounded-lg px-4 py-3 text-sm text-discord-text placeholder-discord-text-muted disabled:opacity-50"
                placeholder="Type your answer..."
              />
              <button
                onClick={sendReply}
                disabled={sending || !inputText.trim()}
                className="px-4 py-3 bg-discord-accent text-white rounded-lg text-sm font-medium hover:bg-discord-accent/80 disabled:opacity-50 flex items-center gap-1 cursor-pointer"
              >
                {sending && <Spinner className="w-3 h-3" />}
                Send
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Test Stage ────────────────────────────────────────────────────────────

  if (stage === "test") {
    const question = testQuestions[currentQuestionIndex];

    if (!question) {
      return (
        <div className="flex items-center justify-center h-full">
          <Spinner />
        </div>
      );
    }

    return (
      <div className="flex flex-col h-full min-h-0 bg-discord-bg">
        {/* Header */}
        <div className="px-6 py-2 bg-discord-bg-dark border-b border-discord-bg-darker/60 flex items-center gap-3 shrink-0">
          <span className="text-xs text-discord-text font-medium">
            Test — {activeLesson ? localized(locale, activeLesson.title, activeLesson.titleCn) : ""}
          </span>
          <div className="flex-1" />
          <span className="text-[10px] text-discord-text-muted">
            Q {currentQuestionIndex + 1} / {testQuestions.length}
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          {/* System banner */}
          <div className="flex items-center gap-2.5 px-4 py-3 mb-6 rounded-lg bg-purple-500/10 border border-purple-500/30">
            <svg className="w-5 h-5 text-purple-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs text-purple-300">
              Lesson completed — Test started. No AI involved, answers are evaluated deterministically.
            </span>
            <button
              onClick={() => {
                if (activeLesson) {
                  reviewLesson(activeLesson.id, true);
                }
              }}
              disabled={sending}
              className="ml-auto px-3 py-1 bg-green-600 text-white rounded text-[11px] font-medium hover:bg-green-700 disabled:opacity-50 shrink-0 cursor-pointer flex items-center gap-1"
            >
              {sending && <Spinner className="w-3 h-3" />}
              View Lesson
            </button>
          </div>

          {/* Question */}
          <div className="flex gap-3 items-start mb-6">
            <div className="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center text-white text-sm shrink-0">
              📋
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-discord-text">
                  Test System
                </span>
                <span className="text-[10px] px-1.5 py-0.5 bg-purple-500/20 text-purple-300 rounded font-semibold">
                  TEST
                </span>
              </div>
              <div className="text-sm text-discord-text leading-relaxed mb-4">
                {question.prompt}
              </div>

              {/* MC Options */}
              {question.type === "mc" && (
                <div className="space-y-2">
                  {(
                    (question.options as { options?: string[] })?.options || []
                  ).map((opt, i) => (
                    <button
                      key={i}
                      onClick={() =>
                        !answerResult && setSelectedAnswer(i)
                      }
                      disabled={!!answerResult}
                      className={`w-full text-left px-4 py-3 rounded-lg text-sm border transition cursor-pointer ${
                        answerResult
                          ? (answerResult.correctAnswers as { correctIndex: number })
                              .correctIndex === i
                            ? "border-green-500 bg-green-500/10 text-green-300"
                            : selectedAnswer === i
                            ? "border-red-500 bg-red-500/10 text-red-300"
                            : "border-discord-bg-darker/60 bg-discord-bg-dark text-discord-text-muted"
                          : selectedAnswer === i
                          ? "border-discord-accent bg-discord-accent/10 text-discord-text"
                          : "border-discord-bg-darker/60 bg-discord-bg-dark text-discord-text hover:border-discord-accent/50 hover:bg-discord-bg-dark/80"
                      }`}
                    >
                      <span className="font-mono mr-2">
                        {String.fromCharCode(65 + i)}.
                      </span>
                      {opt}
                      {answerResult &&
                        (answerResult.correctAnswers as { correctIndex: number })
                          .correctIndex === i && " ✓"}
                      {answerResult &&
                        selectedAnswer === i &&
                        (answerResult.correctAnswers as { correctIndex: number })
                          .correctIndex !== i && " ✕"}
                    </button>
                  ))}
                </div>
              )}

              {/* TF Options */}
              {question.type === "tf" && (
                <div className="flex gap-3">
                  {[true, false].map((val) => (
                    <button
                      key={String(val)}
                      onClick={() => !answerResult && setSelectedAnswer(val)}
                      disabled={!!answerResult}
                      className={`px-8 py-3 rounded-lg text-sm font-medium border transition cursor-pointer ${
                        answerResult
                          ? (answerResult.correctAnswers as { correct: boolean })
                              .correct === val
                            ? "border-green-500 bg-green-500/10 text-green-300"
                            : selectedAnswer === val
                            ? "border-red-500 bg-red-500/10 text-red-300"
                            : "border-discord-bg-darker/60 bg-discord-bg-dark text-discord-text-muted"
                          : selectedAnswer === val
                          ? "border-discord-accent bg-discord-accent/10 text-discord-text"
                          : "border-discord-bg-darker/60 bg-discord-bg-dark text-discord-text hover:border-discord-accent/50 hover:bg-discord-bg-dark/80"
                      }`}
                    >
                      {val ? "True" : "False"}
                    </button>
                  ))}
                </div>
              )}

              {/* Rating Options */}
              {question.type === "rating" && (() => {
                const opts = question.options as {
                  ratingOptions?: string[];
                  reasonOptions?: string[];
                  sampleFile?: { name: string; url: string; type: string };
                };
                const userRating = (selectedAnswer as { rating?: string; reasonIndex?: number })?.rating;
                const userReasonIndex = (selectedAnswer as { rating?: string; reasonIndex?: number })?.reasonIndex;
                const hasReasons = (opts.reasonOptions || []).length > 0;

                return (
                  <div className="space-y-3">
                    {/* Sample content (audio/video/image) */}
                    {opts.sampleFile && (
                      <div className="bg-discord-bg-dark rounded-lg p-4 border border-discord-bg-darker/60 mb-2">
                        <div className="text-[10px] text-discord-text-muted uppercase mb-2">Sample Content</div>
                        <SignedMedia url={opts.sampleFile.url} type={opts.sampleFile.type} name={opts.sampleFile.name} />
                        <div className="text-[10px] text-discord-text-muted mt-1">{opts.sampleFile.name}</div>
                      </div>
                    )}

                    {/* Rating buttons */}
                    <div className="flex gap-3">
                      {(opts.ratingOptions || ["Good", "OK", "Bad"]).map((rating) => (
                        <button
                          key={rating}
                          onClick={() => {
                            if (!answerResult) {
                              setSelectedAnswer({ rating, reasonIndex: undefined });
                            }
                          }}
                          disabled={!!answerResult}
                          className={`px-6 py-3 rounded-lg text-sm font-medium border transition cursor-pointer ${
                            userRating === rating
                              ? "border-discord-accent bg-discord-accent/10 text-discord-text"
                              : "border-discord-bg-darker/60 bg-discord-bg-dark text-discord-text hover:border-discord-accent/50 hover:bg-discord-bg-dark/80"
                          }`}
                        >
                          {rating}
                        </button>
                      ))}
                    </div>

                    {/* Reason options — shown when "Bad" is selected and reasons exist */}
                    {userRating === "Bad" && hasReasons && !answerResult && (
                      <div>
                        <div className="text-[10px] text-discord-text-muted uppercase mb-2">
                          Why is it bad?
                        </div>
                        <div className="space-y-2">
                          {(opts.reasonOptions || []).map((reason, i) => (
                            <button
                              key={i}
                              onClick={() => {
                                setSelectedAnswer({ rating: "Bad", reasonIndex: i });
                              }}
                              className={`w-full text-left px-4 py-3 rounded-lg text-sm border transition cursor-pointer flex items-center gap-3 ${
                                userReasonIndex === i
                                  ? "border-discord-accent bg-discord-accent/10 text-discord-text"
                                  : "border-discord-bg-darker/60 bg-discord-bg-dark text-discord-text hover:border-discord-accent/50 hover:bg-discord-bg-dark/80"
                              }`}
                            >
                              <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                                userReasonIndex === i
                                  ? "border-discord-accent bg-discord-accent"
                                  : "border-discord-text-muted/40"
                              }`}>
                                {userReasonIndex === i && (
                                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </span>
                              {reason}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Upload question */}
              {question.type === "upload" && (
                <div className="space-y-3">
                  {!uploadSubmitted ? (
                    <>
                      {/* File type/size info */}
                      {(() => {
                        const uploadOpts = question.options as { acceptedTypes?: string[]; maxSize?: number } | null;
                        const types = uploadOpts?.acceptedTypes || [];
                        const maxMB = uploadOpts?.maxSize ? Math.round(uploadOpts.maxSize / (1024 * 1024)) : 200;
                        return (
                          <div className="text-[10px] text-discord-text-muted mb-1">
                            Accepted: {types.length > 0 ? types.map(t => t.toUpperCase()).join(", ") : "All files"} · Max {maxMB} MB
                          </div>
                        );
                      })()}

                      <FileUpload
                        files={uploadFiles}
                        onFilesChange={setUploadFiles}
                        context="attempt-deliverable"
                        maxFiles={1}
                        maxSizeMb={(() => {
                          const uploadOpts = question.options as { maxSize?: number } | null;
                          return uploadOpts?.maxSize ? Math.round(uploadOpts.maxSize / (1024 * 1024)) : 200;
                        })()}
                        accept={(() => {
                          const uploadOpts = question.options as { acceptedTypes?: string[] } | null;
                          const types = uploadOpts?.acceptedTypes || [];
                          return types.length > 0 ? types.map(t => `.${t}`).join(",") : undefined;
                        })()}
                        label="Upload your deliverable"
                      />

                      {uploadFiles.length > 0 && (
                        <button
                          onClick={async () => {
                            if (!progressId || uploadFiles.length === 0) return;
                            setSending(true);
                            try {
                              const file = uploadFiles[0];
                              const res = await fetch("/api/training/session", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  action: "test-upload",
                                  userProgressId: progressId,
                                  questionId: question.id,
                                  fileUrl: file.url,
                                  fileName: file.name,
                                  fileType: file.type,
                                  fileSize: file.size,
                                }),
                              });
                              if (res.ok) {
                                const data = await res.json();
                                setUploadSubmitted(true);
                                // If all questions are done, go to pending review
                                if (data.allDone) {
                                  setTestStatus("pending_review");
                                  setTimeout(() => setStage("result"), 1500);
                                }
                              }
                            } catch (err) {
                              console.error("Upload submission failed:", err);
                            } finally {
                              setSending(false);
                            }
                          }}
                          disabled={sending}
                          className="px-6 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex items-center gap-1 cursor-pointer"
                        >
                          {sending && <Spinner className="w-3 h-3" />}
                          Submit for Review
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="bg-discord-bg-dark rounded-lg p-6 border border-orange-500/20 text-center">
                      <span className="text-2xl mb-2 block">📤</span>
                      <p className="text-sm text-orange-300 font-medium mb-1">Submitted for review</p>
                      <p className="text-[10px] text-discord-text-muted">
                        A moderator will review your upload. The test is held as pending until they approve or reject it.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Submit / Next buttons */}
          <div className="ml-[52px]">
            {/* Submit button for MC/TF/Rating */}
            {!answerResult && question.type !== "upload" && (
              <button
                onClick={submitTestAnswer}
                disabled={
                  sending || selectedAnswer === null || selectedAnswer === undefined
                }
                className="px-6 py-2.5 bg-discord-accent text-white rounded-lg text-sm font-medium hover:bg-discord-accent/80 disabled:opacity-50 flex items-center gap-1 cursor-pointer"
              >
                {sending && <Spinner className="w-3 h-3" />}
                Submit Answer
              </button>
            )}

            {/* Next button — after answering OR after upload submitted */}
            {((answerResult || (question.type === "upload" && uploadSubmitted)) && currentQuestionIndex < testQuestions.length - 1) && (
              <button
                onClick={nextQuestion}
                className="px-6 py-2.5 bg-discord-accent text-white rounded-lg text-sm font-medium hover:bg-discord-accent/80 cursor-pointer"
              >
                Next Question →
              </button>
            )}

            {/* See Results — last question answered or upload submitted */}
            {((answerResult || (question.type === "upload" && uploadSubmitted)) && currentQuestionIndex >= testQuestions.length - 1) && (
              <button
                onClick={() => {
                  const hasUploads = testQuestions.some((q) => q.type === "upload");
                  if (hasUploads && !testStatus) {
                    setTestStatus("pending_review");
                  }
                  setStage("result");
                }}
                className="px-6 py-2.5 bg-discord-accent text-white rounded-lg text-sm font-medium hover:bg-discord-accent/80 cursor-pointer"
              >
                See Results
              </button>
            )}

            {answerResult && (
              <div
                className={`mt-3 text-sm font-medium ${
                  answerResult.correct ? "text-green-400" : "text-red-400"
                }`}
              >
                {answerResult.correct ? "✓ Correct!" : "✕ Wrong"}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Review Stage (read-only lesson replay) ────────────────────────────────

  if (stage === "review") {
    return (
      <div className="flex flex-col h-full bg-discord-bg">
        {/* Header */}
        <div className="px-6 py-2 bg-discord-bg-dark border-b border-discord-bg-darker/60 flex items-center gap-3">
          <button
            onClick={() => {
              if (reviewingFromTest) {
                setStage("test");
              } else {
                setStage("welcome");
                loadWelcome();
              }
            }}
            className="text-discord-text-muted hover:text-discord-text text-xs cursor-pointer"
          >
            ← {reviewingFromTest ? "Back to Test" : "Back to Training"}
          </button>
          <span className="text-xs text-discord-text font-medium">
            {activeLesson ? localized(locale, activeLesson.title, activeLesson.titleCn) : ""} — Review
          </span>
          <div className="flex-1" />
          <span className="text-[10px] text-green-400 font-medium">
            READ-ONLY
          </span>
        </div>

        {/* Chat messages (read-only) */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {reviewMessages.length === 0 ? (
            <div className="text-center text-sm text-discord-text-muted py-8">
              No conversation history saved for this lesson.
            </div>
          ) : (
            reviewMessages.map((msg, i) => {
              if (msg.role === "system") {
                return (
                  <div
                    key={i}
                    className="text-center text-[11px] text-discord-text-muted py-2"
                  >
                    {msg.content}
                  </div>
                );
              }
              if (msg.role === "teacher") {
                return (
                  <div key={i} className="flex gap-3 items-start">
                    <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm shrink-0">
                      🤖
                    </div>
                    <div className="max-w-[80%]">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-discord-text">
                          Training Bot
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/20 text-blue-300 rounded font-semibold">
                          BOT
                        </span>
                      </div>
                      <div className="text-sm text-discord-text leading-relaxed whitespace-pre-wrap">
                        {msg.content}
                      </div>
                    </div>
                  </div>
                );
              }
              return (
                <div key={i} className="flex gap-3 items-start justify-end">
                  <div className="max-w-[80%] bg-discord-accent/20 rounded-lg px-4 py-2">
                    <div className="text-sm text-discord-text">
                      {msg.content}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Bottom bar */}
        <div className="px-6 py-4 border-t border-discord-bg-darker/60">
          <div className="bg-discord-bg-dark rounded-lg px-4 py-3 text-sm text-discord-text-muted text-center">
            This is a read-only review of your completed lesson.
          </div>
        </div>
      </div>
    );
  }

  // ── Result Stage ──────────────────────────────────────────────────────────

  if (stage === "result") {
    const passed = testStatus === "passed";
    const pendingReview = testStatus === "pending_review";

    return (
      <div className="flex flex-col h-full bg-discord-bg items-center justify-center p-6">
        <div className="bg-discord-bg-dark rounded-xl p-8 border border-discord-bg-darker/60 text-center max-w-md w-full">
          <div className="text-5xl mb-4">
            {passed ? "🏅" : pendingReview ? "⏳" : "❌"}
          </div>
          <h2 className="text-2xl font-bold text-discord-text mb-2">
            {passed
              ? "Congratulations!"
              : pendingReview
              ? "Awaiting Review"
              : "Test Failed"}
          </h2>
          {!pendingReview && (
            <div
              className={`text-3xl font-bold mb-4 ${
                passed ? "text-green-400" : "text-red-400"
              }`}
            >
              {testScore}%
            </div>
          )}
          <p className="text-sm text-discord-text-muted mb-6">
            {passed
              ? "You've earned a new tag! New channels may now be available."
              : pendingReview
              ? "Your upload submissions are being reviewed. You'll be notified when complete."
              : "You can retry this lesson later."}
          </p>
          <button
            onClick={() => {
              setStage("welcome");
              loadWelcome();
            }}
            className="px-6 py-2.5 bg-discord-accent text-white rounded-lg text-sm font-medium hover:bg-discord-accent/80 cursor-pointer"
          >
            Back to Training
          </button>
        </div>
      </div>
    );
  }

  return null;
}
