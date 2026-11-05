import "server-only";

/**
 * 원생 개별 공지·교재요청서의 **수업 시작 전·휴원 제외** 조회부 — 판정은 순수 [`noticeStandingOf`](../notice-standing.ts).
 * 세 발송 표면(원스크린 개별 공지 · 사무실 개별 공지 · 교재요청서)이 `routeNoticeCandidates`에서 이 함수를 한 번 지나고, 교재요청서 발송 창의
 * 미리보기도 같은 함수를 쓴다(화면에 보인 사유로 실제로 빠진다).
 * ⚠️ admin 클라이언트 + tenant 필터 — 공지 삼자 일치(notice-route-legs.ts)와 같은 이유(강사 RLS로는 다른 반 수강이 안 보여 판정이 사람마다 달라진다).
 * 조회 실패는 throw — 호출부가 그 발송을 막는다(모르는 채 시작 전·휴원 학생에게 보내지 않는다).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { noticeStandingOf, type NoticeStanding, type StandingClass } from "../notice-standing";
import { studentLegQuery } from "./notice-route-legs";

/**
 * (학생, 알림장 과목)마다 제외 사유 — 제외할 쌍만 담는다(studentId → 과목 → 사유).
 * @param pairs 판정할 쌍(같은 쌍이 여러 번 와도 한 번만 본다)
 */
export async function resolveNoticeStandings(
  tenantId: string,
  pairs: readonly { studentId: string; subject: string }[],
  date: string = kstToday(),
): Promise<Map<string, Map<string, NoticeStanding>>> {
  const out = new Map<string, Map<string, NoticeStanding>>();
  const wanted = pairs.filter((p) => p.studentId && p.subject);
  const studentIds = [...new Set(wanted.map((p) => p.studentId))];
  if (!studentIds.length) return out;
  const admin = createAdminClient();
  // 서로 독립인 조회 — 한 번에(B4). 수강은 학생 id 청크 × 페이징(공지 삼자 일치와 같은 조회), 학생 상태는 학생 id 청크(B3).
  const [rows, students] = await Promise.all([
    studentLegQuery(admin, tenantId, studentIds),
    fetchInChunks<{ id: string; status: string | null }>(studentIds, (chunk) =>
      admin.from("students").select("id, status").eq("tenant_id", tenantId).in("id", chunk),
    ),
  ]);
  const classIds = [...new Set(rows.map((r) => r.class_id))];
  const classes = classIds.length
    ? await fetchInChunks<{ id: string } & StandingClass>(classIds, (chunk) =>
        admin.from("classes").select("id, subject, is_active, closed_at").eq("tenant_id", tenantId).in("id", chunk),
      )
    : [];
  const classById = new Map(classes.map((c) => [c.id, c]));
  const onHold = new Set(students.filter((s) => s.status === "on_hold").map((s) => s.id));
  const rowsOf = new Map<string, typeof rows>();
  for (const r of rows) rowsOf.set(r.student_id, [...(rowsOf.get(r.student_id) ?? []), r]);
  for (const p of wanted) {
    if (out.get(p.studentId)?.has(p.subject)) continue;
    const standing = noticeStandingOf({
      subject: p.subject,
      rows: rowsOf.get(p.studentId) ?? [],
      classOf: (id) => classById.get(id),
      studentOnHold: onHold.has(p.studentId),
      date,
    });
    if (!standing) continue;
    if (!out.has(p.studentId)) out.set(p.studentId, new Map());
    out.get(p.studentId)!.set(p.subject, standing);
  }
  return out;
}
