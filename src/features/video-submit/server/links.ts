import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { isSubmitTokenShape, isVideoLinkExpired, videoLinkExpiresAt } from "../rules";
import { hashSubmitToken, newSubmitToken } from "./token";

type Db = ReturnType<typeof createAdminClient>;

export type LinkRow = {
  id: string; tenant_id: string; student_id: string; class_id: string; origin: "manual" | "report" | "site";
  report_id: string | null; report_share_hash: string | null; expires_at: string; revoked_at: string | null;
};
const LINK_COLUMNS = "id,tenant_id,student_id,class_id,origin,report_id,report_share_hash,expires_at,revoked_at";

/**
 * 새 링크 — 토큰 원문은 돌려주기만 하고 DB엔 해시만. 기준일 = 보고서일(보고서 줄) 또는 오늘(KST, 학생 상세).
 * `expiresAt`을 주면 그 순간에 끝난다(올리기 사이트가 만든 링크는 7일이 아니라 만든 날과 다음 날 — site.ts `siteLinkExpiresAt`).
 */
export async function mintSubmitLink(db: Db, input: {
  tenantId: string; studentId: string; classId: string; origin: "manual" | "report" | "site";
  baseDate: string; reportId?: string | null; reportShareToken?: string | null; createdBy?: string | null; expiresAt?: string;
}): Promise<{ token: string; id: string; expiresAt: string }> {
  const token = newSubmitToken();
  const expiresAt = input.expiresAt ?? videoLinkExpiresAt(input.baseDate);
  const { data, error } = await db.from("homework_video_links").insert({
    tenant_id: input.tenantId, student_id: input.studentId, class_id: input.classId, origin: input.origin,
    report_id: input.reportId ?? null, created_by: input.createdBy ?? null, token_hash: hashSubmitToken(token), expires_at: expiresAt,
    report_share_hash: input.reportShareToken ? hashSubmitToken(input.reportShareToken) : null,
  }).select("id").single();
  if (error || !data) throw new Error("제출 링크를 만들지 못했습니다.");
  return { token, id: data.id as string, expiresAt };
}

/** 링크 끊기 — 그 학생 × 반의 아직 살아 있는 링크 전부(보고서에 붙은 것 포함). 몇 개 끊었나를 돌려준다. */
export async function revokeSubmitLinks(db: Db, input: { tenantId: string; studentId: string; classId: string; userId: string }): Promise<number> {
  const { data, error } = await db.from("homework_video_links")
    .update({ revoked_at: new Date().toISOString(), revoked_by: input.userId })
    .eq("tenant_id", input.tenantId).eq("student_id", input.studentId).eq("class_id", input.classId)
    .is("revoked_at", null).gt("expires_at", new Date().toISOString())
    .select("id");
  if (error) throw new Error("제출 링크를 끊지 못했습니다.");
  return data?.length ?? 0;
}

export type TokenState =
  | { state: "invalid" }
  | { state: "revoked"; link: LinkRow }
  | { state: "expired"; link: LinkRow }
  | { state: "ok"; link: LinkRow };

/** 공개 링크 → 상태. 토큰 모양이 다르면 DB를 묻지 않는다. 지점은 링크 행이 정한다(토큰이 지점을 해석). */
export async function resolveSubmitToken(db: Db, token: unknown, nowMs: number = Date.now()): Promise<TokenState> {
  if (!isSubmitTokenShape(token)) return { state: "invalid" };
  const { data, error } = await db.from("homework_video_links").select(LINK_COLUMNS).eq("token_hash", hashSubmitToken(token)).maybeSingle();
  if (error) throw new Error("제출 링크를 확인하지 못했습니다.");
  if (!data) return { state: "invalid" };
  const link = data as LinkRow;
  if (link.revoked_at || !(await reportStillStands(db, link))) return { state: "revoked", link };
  if (isVideoLinkExpired(link.expires_at, nowMs)) return { state: "expired", link };
  return { state: "ok", link };
}

/**
 * 보고서 글에 붙었던 링크는 **그 보고서가 그대로일 때만** 쓴다 — 열람 차단(revoked_at)·ClassNote 회수(recall_*)·
 * 공유 링크 재발급(공유 토큰이 바뀜)이면 그 글이 잘못 간 것이라 그 집이 7일 동안 남의 아이 기록에 올리지 못하게 닫는다
 * (적대 리뷰 2026-10-01). 링크를 끊는 쪽 코드(보고서 액션·워커)를 고치지 않고 **읽는 쪽 한 곳**에서 판정한다.
 * 보고서가 지워졌으면(report_id null로 남음) 닫는다. 조회 실패는 throw(열지 않는다).
 */
async function reportStillStands(db: Db, link: LinkRow): Promise<boolean> {
  if (link.origin !== "report") return true;
  if (!link.report_id || !link.report_share_hash) return false;
  const { data, error } = await db.from("lesson_reports").select("share_token,revoked_at,classnote_status")
    .eq("tenant_id", link.tenant_id).eq("id", link.report_id).maybeSingle();
  if (error) throw new Error("보고서 상태를 확인하지 못했습니다.");
  if (!data || data.revoked_at || String(data.classnote_status ?? "").startsWith("recall")) return false;
  return typeof data.share_token === "string" && hashSubmitToken(data.share_token) === link.report_share_hash;
}

/** 학생 상세 표시용 — 반별 살아 있는 링크 수와 가장 늦은 만료. 한 학생 × 지금 반 몇 개라 행이 적다(학생 하나로 좁힘). */
export async function activeLinkSummary(db: Db, tenantId: string, studentId: string): Promise<Map<string, { count: number; lastExpiresAt: string }>> {
  const { data, error } = await db.from("homework_video_links").select(LINK_COLUMNS)
    .eq("tenant_id", tenantId).eq("student_id", studentId).is("revoked_at", null).gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: false }).limit(200);
  if (error) throw new Error("제출 링크 목록을 읽지 못했습니다.");
  // 보고서 글의 링크는 그 보고서가 그대로일 때만 센다(회수·차단·재발급되면 닫힌 링크 — 공개 화면과 같은 판정). 한 학생의 7일치라 적다.
  const rows = data as LinkRow[];
  const standing = await Promise.all(rows.map((row) => reportStillStands(db, row)));
  const out = new Map<string, { count: number; lastExpiresAt: string }>();
  for (const row of rows.filter((_, i) => standing[i])) {
    const prev = out.get(row.class_id as string);
    out.set(row.class_id as string, { count: (prev?.count ?? 0) + 1, lastExpiresAt: prev?.lastExpiresAt ?? (row.expires_at as string) });
  }
  return out;
}
