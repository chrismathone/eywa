"use server";

import { revalidatePath } from "next/cache";
import { logAction } from "@/features/audit/server/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { describeSlackError } from "../format";
import { slackListMembers } from "./client";
import { slackGate } from "./gate";
import { loadConnection, loadLinks } from "./store";

/**
 * 사람 연결(원장용) — aywa 직원 ↔ 슬랙 사람. codex·grok 합의: **이메일 일치는 후보일 뿐**이다(aywa 이메일은 본인이 바꿀 수
 * 있고 인증 안 된 값, 슬랙 이메일은 워크스페이스 관리자가 바꾼다). 그래서 자동으로 붙이지 않고 **원장이 보고 확인**한
 * 것만 `owner_email`로 연결한다(1:1 알림을 받는 용도). 본인 확인 연결(`code`)은 '내 정보'에서 — 나중에 슬랙 버튼으로
 * aywa를 바꾸는 기능(2단계)은 `code` 연결만 믿는다.
 */
export type SlackPersonRow = {
  userId: string;
  name: string;
  linked: "code" | "owner_email" | null;
  candidate: { slackUserId: string; slackName: string } | null; // 이메일이 같은 슬랙 사람(아직 연결 안 됐을 때만)
};

async function staff(tenantId: string) {
  const { data, error } = await createAdminClient()
    .from("users")
    .select("id, display_name, email")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .neq("system_role", "student")
    .order("display_name")
    .limit(500);
  return error ? null : (data ?? []);
}

export async function loadSlackPeople(): Promise<{ rows?: SlackPersonRow[]; error?: string }> {
  const g = await slackGate();
  if ("error" in g) return g;
  const conn = await loadConnection(g.tenantId);
  if (conn.status !== "ok" || !conn.value?.botToken) return { error: "먼저 봇 토큰을 등록해 주세요" };
  const [people, links, members] = await Promise.all([staff(g.tenantId), loadLinks(g.tenantId), slackListMembers(conn.value.botToken)]);
  if (!people) return { error: "직원 목록을 읽지 못했습니다" };
  if (!members.ok) return { error: describeSlackError(members.error) };
  const byEmail = new Map(members.members.filter((m) => m.email).map((m) => [m.email, m]));
  const taken = new Set([...links.values()].map((l) => l.slackUserId));
  return {
    rows: people.map((p) => {
      const link = links.get(p.id as string);
      const m = byEmail.get(((p.email as string) ?? "").toLowerCase());
      return {
        userId: p.id as string,
        name: p.display_name as string,
        linked: link?.method ?? null,
        candidate: !link && m && !taken.has(m.id) ? { slackUserId: m.id, slackName: m.name } : null,
      };
    }),
  };
}

/** 원장이 확인한 이메일 일치 후보를 연결 — 서버에서 **다시** 슬랙 목록으로 확인한다(화면이 보낸 슬랙 id를 믿지 않는다). */
export async function linkSlackByEmail(userIds: string[]): Promise<{ error?: string; message?: string }> {
  const g = await slackGate();
  if ("error" in g) return g;
  const res = await loadSlackPeople();
  if (res.error || !res.rows) return { error: res.error ?? "사람 목록을 읽지 못했습니다" };
  const want = new Set(userIds);
  const picks = res.rows.filter((r) => want.has(r.userId) && r.candidate);
  if (picks.length === 0) return { error: "연결할 후보가 없습니다" };
  const { error } = await createAdminClient()
    .from("slack_user_links")
    .insert(
      picks.map((p) => ({
        tenant_id: g.tenantId,
        aywa_user_id: p.userId,
        slack_user_id: p.candidate!.slackUserId,
        method: "owner_email",
        linked_by: g.userId,
      })),
    );
  if (error) return { error: "연결하지 못했습니다 — 이미 다른 직원에 연결된 슬랙 계정이 있을 수 있습니다" };
  await logAction({ action: "slack_link_owner", targetType: "integration", targetLabel: `${picks.length}명`, metadata: { count: picks.length } });
  revalidatePath("/owner");
  return { message: `${picks.length}명을 연결했습니다` };
}

export async function unlinkSlackUser(userId: string, name: string): Promise<{ error?: string; message?: string }> {
  const g = await slackGate();
  if ("error" in g) return g;
  const { error } = await createAdminClient().from("slack_user_links").delete().eq("tenant_id", g.tenantId).eq("aywa_user_id", userId);
  if (error) return { error: "연결을 해제하지 못했습니다" };
  await logAction({ action: "slack_unlink", targetType: "integration", targetLabel: name.slice(0, 40) });
  revalidatePath("/owner");
  return { message: `${name} 연결을 해제했습니다` };
}
