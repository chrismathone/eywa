"use server";

import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { logAction } from "@/features/audit/server/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { describeSlackError } from "../format";
import { slackLookupByEmail, slackPostDm } from "./client";
import { slackSelfGate } from "./gate";

/**
 * 본인 슬랙 연결(내 정보) — 슬랙 봇이 **그 슬랙 계정의 1:1로 6자리 코드**를 보내고, aywa에 로그인한 본인이 입력해야 연결된다.
 * = "aywa 세션을 가진 사람"과 "슬랙 계정을 가진 사람"이 같다는 증명(codex·grok 합의 — 이메일 일치만으로는 안 된다).
 * 코드: 10분 · 5번 틀리면 다시 받기 · 해시로만 저장.
 */
const CODE_TTL_MS = 10 * 60 * 1000;
/** 코드 다시 받기 간격 — 남의 슬랙 1:1로 코드를 연달아 보내는 스팸을 막는다. */
const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_ATTEMPTS = 5;
const hash = (tenantId: string, userId: string, code: string) =>
  createHash("sha256").update(`${tenantId}:${userId}:${code}`).digest("hex");

export async function startSlackSelfLink(slackEmail: string): Promise<{ error?: string; message?: string }> {
  const g = await slackSelfGate();
  if ("error" in g) return g;
  const email = (slackEmail || g.email).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "슬랙에 가입한 이메일을 넣어 주세요" };
  const who = await slackLookupByEmail(g.token, email);
  if (!who.ok) return { error: describeSlackError(who.error) };

  const admin = createAdminClient();
  const { data: prev } = await admin
    .from("slack_link_codes")
    .select("expires_at")
    .eq("tenant_id", g.tenantId)
    .eq("aywa_user_id", g.userId)
    .maybeSingle();
  if (prev && new Date(prev.expires_at as string).getTime() - CODE_TTL_MS + RESEND_COOLDOWN_MS > Date.now()) {
    return { error: "방금 코드를 보냈습니다 — 30초 뒤에 다시 받을 수 있습니다" };
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const { error } = await admin.from("slack_link_codes").upsert(
    {
      tenant_id: g.tenantId,
      aywa_user_id: g.userId,
      slack_user_id: who.userId,
      code_hash: hash(g.tenantId, g.userId, code),
      attempts: 0,
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    },
    { onConflict: "tenant_id,aywa_user_id" },
  );
  if (error) return { error: "코드를 만들지 못했습니다" };
  const sent = await slackPostDm(
    g.token,
    who.userId,
    `*aywa 계정 연결 코드: ${code}*\n10분 안에 aywa '내 정보'의 슬랙 연결 칸에 넣어 주세요. 직접 요청하지 않았다면 무시하세요.`,
  );
  if (!sent.ok) return { error: describeSlackError(sent.error) };
  return { message: "슬랙 1:1(aywa 앱)로 6자리 코드를 보냈습니다" };
}

export async function confirmSlackSelfLink(rawCode: string): Promise<{ error?: string; message?: string }> {
  const g = await slackSelfGate();
  if ("error" in g) return g;
  const code = (rawCode ?? "").replace(/\D/g, "");
  if (code.length !== 6) return { error: "6자리 숫자를 넣어 주세요" };
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("slack_link_codes")
    .select("slack_user_id, code_hash, attempts, expires_at")
    .eq("tenant_id", g.tenantId)
    .eq("aywa_user_id", g.userId)
    .maybeSingle();
  if (!row) return { error: "먼저 코드를 받아 주세요" };
  if (new Date(row.expires_at as string).getTime() < Date.now() || (row.attempts as number) >= MAX_ATTEMPTS) {
    await admin.from("slack_link_codes").delete().eq("tenant_id", g.tenantId).eq("aywa_user_id", g.userId);
    return { error: "코드가 만료됐습니다 — 다시 받아 주세요" };
  }
  const a = Buffer.from(hash(g.tenantId, g.userId, code));
  const b = Buffer.from(row.code_hash as string);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    await admin.from("slack_link_codes").update({ attempts: (row.attempts as number) + 1 }).eq("tenant_id", g.tenantId).eq("aywa_user_id", g.userId);
    return { error: "코드가 맞지 않습니다" };
  }
  const slackUserId = row.slack_user_id as string;
  // 본인 확인이 끝났으니 이 슬랙 계정이 다른 직원에 붙어 있었다면 떼고(잘못 붙은 연결), 내 연결을 새로 만든다.
  await admin.from("slack_user_links").delete().eq("tenant_id", g.tenantId).or(`aywa_user_id.eq.${g.userId},slack_user_id.eq.${slackUserId}`);
  const { error } = await admin
    .from("slack_user_links")
    .insert({ tenant_id: g.tenantId, aywa_user_id: g.userId, slack_user_id: slackUserId, method: "code", linked_by: g.userId });
  await admin.from("slack_link_codes").delete().eq("tenant_id", g.tenantId).eq("aywa_user_id", g.userId);
  if (error) return { error: "연결하지 못했습니다" };
  await logAction({ action: "slack_link_self", targetType: "integration", targetLabel: "내 슬랙 계정" });
  revalidatePath("/me");
  return { message: "슬랙 계정을 연결했습니다" };
}

export async function unlinkMySlack(): Promise<{ error?: string; message?: string }> {
  const g = await slackSelfGate();
  if ("error" in g) return g;
  const { error } = await createAdminClient().from("slack_user_links").delete().eq("tenant_id", g.tenantId).eq("aywa_user_id", g.userId);
  if (error) return { error: "연결을 해제하지 못했습니다" };
  await logAction({ action: "slack_unlink", targetType: "integration", targetLabel: "내 슬랙 계정" });
  revalidatePath("/me");
  return { message: "슬랙 연결을 해제했습니다" };
}
