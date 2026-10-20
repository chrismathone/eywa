import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { logDbError } from "@/lib/supabase/db-error";

/**
 * 발송한 교재 요청을 지울 때 **공지 연결(0174a `classnote_notice_id`)을 같은 요청의 남은 행으로 옮긴다**.
 *
 * 원장 2026-10-20(최연재 건): '이미지 저장 및 기록'과 '클래스노트 발송'이 각각 요청을 만들어 같은 줄이 둘 생기고,
 * 선생님이 하나를 지우면서 **발송한 쪽**을 지웠다 — 9/10~10/20 사이 9건 전부. 남은 요청은 '발송 안 함'이 되어
 * 중복 차단(같은 학생·같은 교재)이 풀리고, 학부모 글은 ClassNote에 그대로 남는다.
 *
 * 규칙: 지운 행에 연결이 있었으면 **같은 지점 · 같은 학생 · 같은 교재명 · 같은 요청일 · 연결 없는** 요청 중 가장 먼저 만든 것 하나로 옮긴다.
 * 🔴 요청일까지 같아야 한다 — 쌍둥이는 같은 폼에서 나와 요청일이 같다. 몇 달 뒤 같은 교재를 새로 요청한 것(아직 안 보냄)에
 *    옛 공지를 붙이면 그 요청이 '이미 발송함'으로 막힌다.
 * 없으면 아무것도 안 한다(지우는 것 자체는 막지 않는다 — 학부모 글은 ClassNote에서 따로 내린다).
 * 🔴 지운 뒤에 부른다 — 지우기가 막히면(RLS 0행) 옮기지 않는다. 옮기기 실패는 지우기를 되돌리지 않는다(로그만).
 * 🔴 admin(RLS 우회) — 남은 행이 다른 선생님 요청이거나 사무실이 이미 처리한 행이어도 연결은 같은 사실이라 옮긴다. tenant 필터 필수.
 */
export async function handOverTextbookNoticeLink(
  tenantId: string,
  deleted: { student_id: string | null; book_name: string | null; request_date: string | null; classnote_notice_id: string | null },
): Promise<string | null> {
  if (!deleted.classnote_notice_id || !deleted.student_id || !deleted.book_name || !deleted.request_date) return null;
  const admin = createAdminClient();
  const { data: heir, error: findErr } = await admin
    .from("textbook_orders")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("student_id", deleted.student_id)
    .eq("book_name", deleted.book_name)
    .eq("request_date", deleted.request_date)
    .is("classnote_notice_id", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (findErr) {
    logDbError(findErr, "billing.textbook.noticeHandover.find");
    return null;
  }
  if (!heir) return null;
  const { error } = await admin
    .from("textbook_orders")
    .update({ classnote_notice_id: deleted.classnote_notice_id })
    .eq("id", heir.id)
    .eq("tenant_id", tenantId)
    .is("classnote_notice_id", null);
  if (error) {
    logDbError(error, "billing.textbook.noticeHandover.update");
    return null;
  }
  return heir.id as string;
}
