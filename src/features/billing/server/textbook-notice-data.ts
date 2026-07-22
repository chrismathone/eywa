import "server-only";

/**
 * 교재요청 학부모 발송의 **조회 조각들** — 액션 파일(textbook-notice-actions.ts)이 얇게 유지되도록 분리.
 * 여기엔 인가·부수효과가 없는(또는 읽기 전용) 조회만 둔다. 실제 게이트·발송은 액션 파일이 책임진다.
 */

import { getCurrentUser } from "@/lib/auth/current-user";
import { getTeacherScope } from "@/lib/auth/teacher-scope";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { kstToday } from "@/lib/date-kst";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { BOARD_PREFIX } from "@/features/report-admin/notice-targets";
import { workerSupportsNoticeAttachments } from "@/features/report-admin/worker-results";

export type TextbookOrderRow = {
  id: string;
  student_id: string | null;
  student_name: string | null;
  teacher_name: string | null;
  book_name: string;
  book_detail: string | null;
  price: string | number;
  request_date: string | null;
};

/** 로그인 강사가 저장해 둔 멘트(없으면 null). 읽기는 본인 users 행 self-select(기존 RLS). */
export async function getMyTextbookMent(): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select("textbook_notice_ment")
    .eq("id", user.id)
    .maybeSingle();
  const v = (data?.textbook_notice_ment as string | null) ?? null;
  return v && v.trim() ? v : null;
}

/**
 * 학생별 **발송 가능 과목 키** — textbook_orders엔 과목 컬럼이 없어 활성 수강(enrollments)에서 도출한다.
 * 활성 = end_date null 또는 미래(KST 오늘 기준). 보드 prefix가 없는 과목은 게시 대상이 아니라 제외.
 * 같은 보드로 가는 키(math·subject_1 → "(수학)")는 하나만 남긴다(고를 이유가 없는 선택지 제거).
 */
export async function getStudentBoardSubjects(studentIds: string[]): Promise<Record<string, string[]>> {
  const user = await getCurrentUser();
  if (!user) return {};
  const ids = [...new Set((studentIds ?? []).filter(Boolean))];
  if (!ids.length) return {};
  const supabase = await createClient();
  const today = kstToday();
  // 대량 id는 청크 분할(B3) — 헬퍼가 error를 삼키지 않고 throw.
  const rows = await fetchInChunks<{
    student_id: string;
    class: { subject?: string | null } | { subject?: string | null }[] | null;
  }>(ids, (chunk) =>
    supabase
      .from("enrollments")
      .select("student_id, class:class_id!inner ( subject )")
      .in("student_id", chunk)
      .or(`end_date.is.null,end_date.gte.${today}`),
  );

  const out: Record<string, string[]> = {};
  for (const r of rows) {
    const klass = Array.isArray(r.class) ? r.class[0] : r.class;
    const subject = (klass?.subject ?? "").trim();
    if (!subject || !BOARD_PREFIX[subject]) continue;
    const list = (out[r.student_id] ??= []);
    if (list.some((s) => BOARD_PREFIX[s] === BOARD_PREFIX[subject])) continue;
    list.push(subject);
  }
  for (const list of Object.values(out)) list.sort();
  return out;
}

/** 하트비트가 이 시간 안이면 "지금 돌고 있는 워커"로 본다 — 이 글을 집어갈 후보. */
const WORKER_LIVE_MS = 10 * 60 * 1000;

/**
 * 이미지 첨부 발송을 **지금 켜져 있는 연동 PC가 처리할 수 있는가**(롤아웃 가드).
 *
 * 앱은 즉시 배포되고 워커는 zip 물리 이관이라 시차가 생긴다. 그 사이 보내면 구버전 워커가 첨부를 통째로
 * 무시하고 글자만 게시한 뒤 `success`로 남긴다(재발송하면 중복 글). 그래서 **살아있는 워커 중 하나라도
 * 미지원이면 막는다** — 그 워커가 큐를 집어갈 수 있기 때문.
 * ⚠️ 켜져 있는 워커가 하나도 없으면 막지 않는다(큐에 쌓였다가 나중에 처리되는 정상 동작 — 여기서 막으면
 *    "PC를 켜기 전엔 예약도 못 한다"가 된다). 그 사이 구버전이 켜질 잔여 위험은 이관 절차로 관리한다.
 */
export async function getNoticeAttachmentWorkerGate(): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data } = await supabase.from("classnote_workers").select("hostname, last_seen, last_results");
  const live = (data ?? []).filter(
    (w) => Date.now() - Date.parse(String(w.last_seen ?? "")) < WORKER_LIVE_MS,
  );
  const stale = live.filter((w) => !workerSupportsNoticeAttachments(w.last_results));
  if (!stale.length) return { ok: true };
  return {
    ok: false,
    error: `연동 PC(${stale.map((w) => String(w.hostname)).join(", ")})의 발송 프로그램이 아직 이미지 첨부를 지원하지 않습니다 — 연동 PC를 최신 버전으로 업데이트한 뒤 보내주세요(지금 보내면 요청서 없이 글자만 게시됩니다).`,
  };
}

/** orderIds → 요청 행. 강사(겸직-강사뷰 포함)는 본인 담당 학생 요청만(하나라도 밖이면 전체 거부). */
export async function loadScopedOrders(
  orderIds: string[],
): Promise<{ error: string } | { rows: TextbookOrderRow[] }> {
  const supabase = await createClient();
  const rows = await fetchInChunks<TextbookOrderRow>(orderIds, (chunk) =>
    supabase
      .from("textbook_orders")
      .select("id, student_id, student_name, teacher_name, book_name, book_detail, price, request_date")
      .in("id", chunk),
  );
  if (!rows.length) return { error: "교재 요청을 찾을 수 없습니다" };
  const teacherId = await effectiveTeacherId();
  if (teacherId) {
    const { studentIds } = await getTeacherScope(teacherId);
    const scoped = new Set(studentIds);
    if (!rows.every((r) => r.student_id && scoped.has(r.student_id)))
      return { error: "담당 학생의 요청만 학부모에게 보낼 수 있습니다" };
  }
  return { rows };
}
