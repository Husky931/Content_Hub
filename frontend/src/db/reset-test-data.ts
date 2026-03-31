import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, inArray, ne, notInArray } from "drizzle-orm";
import {
  appeals,
  ledgerEntries,
  notifications,
  attempts,
  tasks,
  messages,
  channelMods,
  channels,
  userTags,
  tags,
  users,
  taskTemplates,
  sessions,
  inviteCodes,
  verificationTokens,
  channelReads,
  uploadSubmissions,
  userProgress,
  testQuestions,
  tests,
  trainerPrompts,
  lessons,
} from "./schema";

async function resetTestData() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const sql = postgres(DATABASE_URL);
  const db = drizzle(sql);

  console.log("Clearing task-channel test data...\n");

  // 1. Find all task-type channel IDs
  const taskChannels = await db
    .select({ id: channels.id, name: channels.name })
    .from(channels)
    .where(eq(channels.type, "task"));

  const taskChannelIds = taskChannels.map((c) => c.id);
  console.log(
    `  Found ${taskChannels.length} task channel(s): ${taskChannels.map((c) => `#${c.name}`).join(", ") || "(none)"}`
  );

  // 2. Delete in FK-safe order (all tables, since tasks/attempts always belong to task channels)
  console.log("  Deleting appeals...");
  const d1 = await db.delete(appeals).returning({ id: appeals.id });
  console.log(`    ${d1.length} rows deleted`);

  console.log("  Deleting ledger entries...");
  const d2 = await db.delete(ledgerEntries).returning({ id: ledgerEntries.id });
  console.log(`    ${d2.length} rows deleted`);

  console.log("  Deleting notifications...");
  const d3 = await db.delete(notifications).returning({ id: notifications.id });
  console.log(`    ${d3.length} rows deleted`);

  console.log("  Deleting attempts...");
  const d4 = await db.delete(attempts).returning({ id: attempts.id });
  console.log(`    ${d4.length} rows deleted`);

  console.log("  Deleting tasks...");
  const d5 = await db.delete(tasks).returning({ id: tasks.id });
  console.log(`    ${d5.length} rows deleted`);

  // 2b. Clear messages in #appeals channel
  const [appealsChannel] = await db
    .select({ id: channels.id })
    .from(channels)
    .where(eq(channels.slug, "appeals"));

  if (appealsChannel) {
    console.log("  Deleting messages in #appeals...");
    const dA = await db
      .delete(messages)
      .where(eq(messages.channelId, appealsChannel.id))
      .returning({ id: messages.id });
    console.log(`    ${dA.length} rows deleted`);
  }

  // 3. Delete messages & mods only for task channels
  if (taskChannelIds.length > 0) {
    console.log("  Deleting messages in task channels...");
    const d6 = await db
      .delete(messages)
      .where(inArray(messages.channelId, taskChannelIds))
      .returning({ id: messages.id });
    console.log(`    ${d6.length} rows deleted`);

    console.log("  Deleting channel mods for task channels...");
    const d7 = await db
      .delete(channelMods)
      .where(inArray(channelMods.channelId, taskChannelIds))
      .returning({ channelId: channelMods.channelId });
    console.log(`    ${d7.length} rows deleted`);

    console.log("  Deleting task channels...");
    const d8 = await db
      .delete(channels)
      .where(eq(channels.type, "task"))
      .returning({ id: channels.id });
    console.log(`    ${d8.length} rows deleted`);
  }

  // 4. Delete lesson / training data (FK-safe order: submissions → progress → questions → tests → prompts → lessons)
  console.log("  Deleting upload submissions...");
  const dL1 = await db.delete(uploadSubmissions).returning({ id: uploadSubmissions.id });
  console.log(`    ${dL1.length} rows deleted`);

  console.log("  Deleting user progress...");
  const dL2 = await db.delete(userProgress).returning({ id: userProgress.id });
  console.log(`    ${dL2.length} rows deleted`);

  console.log("  Deleting test questions...");
  const dL3 = await db.delete(testQuestions).returning({ id: testQuestions.id });
  console.log(`    ${dL3.length} rows deleted`);

  console.log("  Deleting tests...");
  const dL4 = await db.delete(tests).returning({ id: tests.id });
  console.log(`    ${dL4.length} rows deleted`);

  console.log("  Deleting trainer prompts...");
  const dL5 = await db.delete(trainerPrompts).returning({ id: trainerPrompts.id });
  console.log(`    ${dL5.length} rows deleted`);

  console.log("  Deleting lessons...");
  const dL6 = await db.delete(lessons).returning({ id: lessons.id });
  console.log(`    ${dL6.length} rows deleted`);

  // 5. Delete tags (clear userTags first due to FK)
  console.log("  Deleting user-tag assignments...");
  const d9 = await db.delete(userTags).returning({ id: userTags.id });
  console.log(`    ${d9.length} rows deleted`);

  console.log("  Deleting tags...");
  const d10 = await db.delete(tags).returning({ id: tags.id });
  console.log(`    ${d10.length} rows deleted`);

  // 6. Delete custom task templates (keep audio, video, image)
  const coreCategories = ["audio", "video", "image"];
  console.log("  Deleting custom task templates...");
  const d11 = await db
    .delete(taskTemplates)
    .where(notInArray(taskTemplates.category, coreCategories))
    .returning({ id: taskTemplates.id });
  console.log(`    ${d11.length} rows deleted`);

  // 7. Delete all non-admin users and their dependent data
  const ADMIN_EMAIL = "admin@creatorhub.local";

  // Find admin user ID
  const [adminUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, ADMIN_EMAIL));

  if (!adminUser) {
    console.log("  WARNING: Admin user not found! Skipping user deletion.");
  } else {
    const adminId = adminUser.id;

    console.log("  Deleting sessions for non-admin users...");
    const d12 = await db
      .delete(sessions)
      .where(ne(sessions.userId, adminId))
      .returning({ id: sessions.id });
    console.log(`    ${d12.length} rows deleted`);

    console.log("  Deleting verification tokens for non-admin users...");
    const d13 = await db
      .delete(verificationTokens)
      .where(ne(verificationTokens.userId, adminId))
      .returning({ id: verificationTokens.id });
    console.log(`    ${d13.length} rows deleted`);

    console.log("  Deleting invite codes...");
    const d14 = await db.delete(inviteCodes).returning({ id: inviteCodes.id });
    console.log(`    ${d14.length} rows deleted`);

    console.log("  Deleting channel reads for non-admin users...");
    const d15 = await db
      .delete(channelReads)
      .where(ne(channelReads.userId, adminId))
      .returning({ id: channelReads.id });
    console.log(`    ${d15.length} rows deleted`);

    console.log("  Deleting all remaining messages...");
    const d16a = await db
      .delete(messages)
      .returning({ id: messages.id });
    console.log(`    ${d16a.length} rows deleted`);

    console.log("  Deleting channel mods for non-admin users...");
    const d16 = await db
      .delete(channelMods)
      .where(ne(channelMods.userId, adminId))
      .returning({ channelId: channelMods.channelId });
    console.log(`    ${d16.length} rows deleted`);

    console.log("  Deleting non-admin users...");
    const d17 = await db
      .delete(users)
      .where(ne(users.email, ADMIN_EMAIL))
      .returning({ id: users.id });
    console.log(`    ${d17.length} rows deleted`);

    console.log("  Clearing admin user's phone number...");
    await db
      .update(users)
      .set({ phone: null })
      .where(eq(users.email, ADMIN_EMAIL));
    console.log("    done");
  }

  // 8. Re-seed the standard special & discussion channels if missing
  console.log("\n  Re-seeding standard channels if missing...");

  const standardChannels = [
    // Special channels
    { name: "announcements", nameCn: "公告", slug: "announcements", type: "special" as const, description: "System-wide updates, read-only for creators", descriptionCn: "系统公告，创作者只读", isFixed: true, sortOrder: 0 },
    { name: "beginner-training", nameCn: "新手训练", slug: "beginner-training", type: "special" as const, description: "New user training and orientation", descriptionCn: "新用户培训和入门", isFixed: true, sortOrder: 1 },
    { name: "appeals", nameCn: "申诉", slug: "appeals", type: "special" as const, description: "Dispute resolution for rejected tasks", descriptionCn: "被拒任务的争议解决", isFixed: true, sortOrder: 2 },
    { name: "payment-issues", nameCn: "支付问题", slug: "payment-issues", type: "special" as const, description: "Private payment discussions - only visible to supermods and admins", descriptionCn: "私密支付讨论 - 仅超级管理员和管理员可见", isFixed: true, sortOrder: 3 },
    // Discussion channels
    { name: "general", nameCn: "综合讨论", slug: "general", type: "discussion" as const, description: "Open discussion for all users", descriptionCn: "所有用户的开放讨论", sortOrder: 20 },
    { name: "feedback", nameCn: "反馈", slug: "feedback", type: "discussion" as const, description: "Product feedback and suggestions", descriptionCn: "产品反馈和建议", sortOrder: 21 },
    { name: "tips", nameCn: "技巧分享", slug: "tips", type: "discussion" as const, description: "Best practices and creator tips", descriptionCn: "最佳实践和创作者技巧", sortOrder: 22 },
    { name: "off-topic", nameCn: "闲聊", slug: "off-topic", type: "discussion" as const, description: "Casual chat", descriptionCn: "休闲聊天", sortOrder: 23 },
  ];

  const existing = await db.select({ slug: channels.slug }).from(channels);
  const existingSlugs = new Set(existing.map((c) => c.slug));

  const toInsert = standardChannels.filter((c) => !existingSlugs.has(c.slug));
  if (toInsert.length > 0) {
    const inserted = await db.insert(channels).values(toInsert).returning();
    for (const ch of inserted) {
      console.log(`    Re-created: #${ch.name} (${ch.type})`);
    }
  } else {
    console.log("    All standard channels already exist.");
  }

  console.log("\nDone! Task channels, tasks, attempts, appeals, ledger entries, notifications, lessons, training progress, tags, custom templates, and non-admin users cleared.");
  console.log("Admin user (admin@creatorhub.local), core templates (audio/video/image), and standard channels are preserved.");
}

resetTestData().catch((err) => {
  console.error("Reset failed:", err);
  process.exit(1);
});
