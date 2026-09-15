import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyUsers } from "@/features/notifications/server/notify";
import { reportError } from "@/lib/observability/report-error";

const QUESTION_TYPE = "help_question" as const;
const ANSWER_TYPE = "help_answer" as const;

/** 새 질문 → 이 학원 master·admin. 답변 → 질문자. best-effort. */
export async function notifyHelpQuestion(args: {
  tenantId: string;
  actorId: string;
  postId: string;
  title: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("users")
      .select("id")
      .eq("tenant_id", args.tenantId)
      .eq("status", "active")
      .in("system_role", ["master", "admin"]);
    if (error) {
      reportError(error, { scope: "help.board.notify.recipients" });
      return;
    }
    const targets = (data ?? []).map((r) => r.id as string).filter((id) => id !== args.actorId);
    await notifyUsers(
      targets.map((recipientId) => ({
        tenantId: args.tenantId,
        recipientId,
        type: QUESTION_TYPE,
        title: "도움말 새 질문",
        body: args.title,
        link: `/help/posts/${args.postId}`,
        actorId: args.actorId,
      })),
    );
  } catch (e) {
    reportError(e, { scope: "help.board.notify.question" });
  }
}

export async function notifyHelpAnswer(args: {
  tenantId: string;
  actorId: string;
  postId: string;
  authorId: string;
  title: string;
}): Promise<void> {
  if (args.actorId === args.authorId) return;
  try {
    await notifyUsers([
      {
        tenantId: args.tenantId,
        recipientId: args.authorId,
        type: ANSWER_TYPE,
        title: "도움말 질문에 답변이 달렸습니다",
        body: args.title,
        link: `/help/posts/${args.postId}`,
        actorId: args.actorId,
      },
    ]);
  } catch (e) {
    reportError(e, { scope: "help.board.notify.answer" });
  }
}
