import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getTeachingClassIds } from "@/features/classes/server/delegation";
import { liveBoardClassIdsOf, mineOnly, pickMainClass } from "../send-class";

/**
 * 이 반에 **이 학생이 받을 수 있는 살아 있는 반 보드**가 있는가 — 원장 2026-09-30 *"종강은 클래스노트에 반이 살아있는 한은
 * 계속 보내고, 이후에 반이 사라지면 반 선택이 뜨도록"*.
 * 판정 = 0302a 연결(`classnote_class_boards`)이 있고 그 학생의 원아가 ok로 매칭돼 있다(`classnote_class_board_members`).
 * ClassNote에서 보드가 지워지면 매일 동기화가 멤버 행을 비우므로(math-class-boards-db.mjs) "사라진 반" = false가 된다.
 * 종강 반은 동기화 대상에서 빠지지만 행은 남는다 → 반이 살아 있는 동안 그대로 그 반으로 간다.
 * - `null` = 확인 못 함(0302a 표 없음·조회 실패, [[#95]]) — 🔴 호출부는 **발송하지 않는다**(fail-closed, 한글 사유).
 * 🔴 판정 규칙은 **한 벌**: 보낼 반 후보(`loadSendClassCandidates`)·워커 `isClassRouteEligible`도 "연결 + 그 학생 ok 멤버"다
 *    (연결만 보면 화면은 반을 고르게 했는데 워커는 원래 반으로 가서 "원아 매칭이 끝나지 않았습니다"로 실패한다).
 * - 특강 반도 정규 반과 같다(원장 2026-09-30 *"특강도 그냥 클래스노트에 반을 만드는게 가장 베스트"*) — 매일 동기화가 특강 반 보드도 만든다.
 * ⚠️ admin 클라이언트 + tenant 필터(RLS 우회) — 돌려주는 것은 참/거짓뿐이다.
 */
export async function classBoardLiveForStudent(tenantId: string, classId: string, studentId: string): Promise<boolean | null> {
  try {
    return (await liveBoardClassIds(tenantId, studentId, [classId])).has(classId);
  } catch {
    return null;
  }
}

/**
 * 주어진 반 중 **이 학생을 워커가 실제로 게시할 수 있는 반 보드**가 있는 반 — 판정 단일 소스(워커 `isClassRouteEligible`과 같다):
 *  · 반 = 활성 · 보고서 발송 · 수학(math·subject_1). 종강일은 보지 않는다(연결은 동기화가 보드가 살아 있을 때만 지킨다)
 *  · 연결(`classnote_class_boards`)이 있고
 *  · 그 학생의 멤버 행이 **하나 이상 ok이고 ok 아닌 행이 없다** — 보류 행이 하나라도 있으면 워커(resolveClassTargets)가 실패한다.
 * 조회 실패는 throw(호출부가 fail-closed로 처리한다).
 */
async function liveBoardClassIds(tenantId: string, studentId: string, classIds: readonly string[]): Promise<Set<string>> {
  if (!classIds.length) return new Set();
  const admin = createAdminClient();
  const ids = [...classIds];
  const [{ data: cls, error: cErr }, { data: boards, error: bErr }, { data: mem, error: mErr }] = await Promise.all([
    admin
      .from("classes")
      .select("id")
      .eq("tenant_id", tenantId)
      .in("id", ids)
      .eq("is_active", true)
      .eq("report_optout", false)
      .in("subject", ["math", "subject_1"]),
    admin.from("classnote_class_boards").select("class_id").eq("tenant_id", tenantId).in("class_id", ids),
    admin
      .from("classnote_class_board_members")
      .select("class_id, status")
      .eq("tenant_id", tenantId)
      .eq("student_id", studentId)
      .in("class_id", ids),
  ]);
  if (cErr) throw new Error(cErr.message);
  if (bErr) throw new Error(bErr.message);
  if (mErr) throw new Error(mErr.message);
  return new Set(
    liveBoardClassIdsOf(
      (cls ?? []).map((c) => c.id as string),
      (boards ?? []).map((b) => b.class_id as string),
      (mem ?? []).map((m) => ({ classId: m.class_id as string, status: m.status as string | null })),
    ),
  );
}

export type SendClassResolution =
  | { ok: true; classId: string }
  | { ok: false; reason: "choose" | "none"; candidates: { id: string; name: string }[] };

/**
 * 보낼 반 **후보**(이름순) — resolveSendClass와 관리자 직접 작성의 반 고르기(원장 2026-09-30)가 **같은 목록**을 쓴다.
 * 비어 있으면 보낼 반이 없다(발송 불가 — `NO_SEND_CLASS_ERROR`).
 */
export async function loadSendClassCandidates(
  tenantId: string,
  studentId: string,
  reportDate: string,
  teacher: { userId: string; restrict: boolean },
): Promise<{ id: string; name: string }[]> {
  const admin = createAdminClient();
  const { data: enr, error: enrErr } = await admin
    .from("enrollments")
    .select("class_id, start_date, end_date")
    .eq("tenant_id", tenantId)
    .eq("student_id", studentId);
  if (enrErr) throw new Error(enrErr.message);
  const live = [
    ...new Set(
      (enr ?? [])
        .filter((e) => (!e.start_date || e.start_date <= reportDate) && (!e.end_date || e.end_date >= reportDate))
        .map((e) => e.class_id as string),
    ),
  ];
  if (!live.length) return [];

  const [{ data: cls, error: clsErr }, hasBoard, teaching] = await Promise.all([
    admin
      .from("classes")
      .select("id, class_name, subject, is_active, report_optout")
      .eq("tenant_id", tenantId)
      .in("id", live),
    // 워커와 같은 판정(연결 + 이 학생 ok 멤버) — 연결만 보면 워커가 그 반에서 원아를 못 찾아 실패한다.
    liveBoardClassIds(tenantId, studentId, live),
    // 담당 반 = 원스크린 명단과 **같은 함수**(담임 ∪ 그날 위임) — 강사가 화면에서 보는 반과 고를 반이 같아야 한다.
    createClient().then((sb) => getTeachingClassIds(sb, teacher.userId, reportDate)),
  ]);
  if (clsErr) throw new Error(clsErr.message);
  const mine = new Set<string>(teaching.all);
  const all = (cls ?? [])
    .filter((c) => (c.subject === "math" || c.subject === "subject_1") && c.is_active && !c.report_optout)
    // 특강도 후보다(원장 2026-09-30 — 특강 반 보드도 만든다). 종강 반도 반 보드가 살아 있는 동안은 후보다
    // (연결은 동기화가 보드가 살아 있을 때만 지킨다) — 그래서 종강일로 따로 거르지 않는다.
    .filter((c) => hasBoard.has(c.id as string))
    .map((c) => ({ id: c.id as string, name: c.class_name as string }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return mineOnly(all, mine, teacher.restrict);
}

/**
 * 반 정보 없는 보강 보고서의 'ClassNote로 보낼 반'을 정한다(A안, 원장 2026-09-29).
 *
 * 후보 = 그날 그 학생이 다니는 반 중 **반 보드 대상**(수학 · 활성 · 보고서 발송 · 종강 전 — 특강 포함, 2026-09-30)이면서
 * ClassNote 반 보드 연결(0302a)이 있는 반. `chosen`이 오면 후보 안에 있을 때만 받는다(화면 위조 차단).
 * 안 오면 메인 수업(send-class.ts `pickMainClass`) — 정할 수 없으면 `choose`로 후보를 돌려준다.
 * 후보는 **작성 강사가 담당하는 반**(담임 ∪ 그날 위임)으로 좁힌다(`mineOnly`, 원장 2026-09-29 *"담당인 반만 뜨도록"*).
 *
 * ⚠️ admin 클라이언트 + tenant 필터 — 강사 RLS로는 **다른 강사 반**의 보고서·출결 수가 안 보여 메인 수업을 잘못 고른다.
 *    돌려주는 것은 그 학생의 반 이름뿐이다(보고서·출결 내용은 안 나간다).
 * ⚠️ 발송 경로에서만 돈다(반별 경로 대상 보강 보고서) — 페이지 렌더에는 안 얹힌다.
 */
export async function resolveSendClass(
  tenantId: string,
  studentId: string,
  reportDate: string,
  chosen: string | null | undefined,
  /** 작성 강사 — `restrict` = 강사(scoped)면 담당 반만, 아니면(관리자) 담당 반이 없을 때 전부. */
  teacher: { userId: string; restrict: boolean },
  /**
   * 메인 수업을 자동으로 고를까. 보고서에 **반이 있는데** 그 반 보드가 없는 경우(특강·종강 반 등)는 false —
   * 다른 반으로 자동으로 보내지 않고 사람이 고른다(원장 2026-09-30 적대 리뷰). 반 없는 보강만 자동.
   */
  opts: { autoPick?: boolean } = {},
): Promise<SendClassResolution> {
  const admin = createAdminClient();
  const candidates = await loadSendClassCandidates(tenantId, studentId, reportDate, teacher);
  if (!candidates.length) return { ok: false, reason: "none", candidates: [] };

  if (chosen) {
    return candidates.some((c) => c.id === chosen)
      ? { ok: true, classId: chosen }
      : { ok: false, reason: "choose", candidates };
  }
  if (opts.autoPick === false) return { ok: false, reason: "choose", candidates };

  const ids = candidates.map((c) => c.id);
  const count = async (table: "lesson_reports" | "attendance_records", classId: string) => {
    let q = admin
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("student_id", studentId)
      .eq("class_id", classId);
    if (table === "lesson_reports") q = q.eq("classnote_status", "success");
    const { count: n, error } = await q;
    if (error) throw new Error(error.message);
    return n ?? 0;
  };
  // 반 수(1~3) × 2 — 서로 독립이라 한 번에(B4).
  const [sentArr, attArr] = await Promise.all([
    Promise.all(ids.map((id) => count("lesson_reports", id))),
    Promise.all(ids.map((id) => count("attendance_records", id))),
  ]);
  const sent = Object.fromEntries(ids.map((id, i) => [id, sentArr[i]!]));
  const attended = Object.fromEntries(ids.map((id, i) => [id, attArr[i]!]));
  const main = pickMainClass(ids, sent, attended);
  return main ? { ok: true, classId: main } : { ok: false, reason: "choose", candidates };
}

/**
 * 관리자 일괄 경로(미발송 일괄 발송·재발송·멈춤 복구)의 **보낼 반 게이트** — 원스크린·직접 작성과 같은 규칙을 행 묶음에.
 * 막을 행 id를 돌려준다(호출부가 반별 발송 대상 수학 행만 넘긴다):
 *  · 보고서 반에 이 학생의 살아 있는 반 보드가 있으면 통과
 *  · 없으면 이미 정해 둔 '보낼 반'(0303a `classnote_class_id`)이 살아 있을 때만 통과(워커가 그 반으로 간다)
 *  · 그 밖 = 막는다(워커가 1인 보드로 흘리지 않게 — 원장 2026-09-30 *"담당 반이 없으면 보고서 발송 불가능하게"*)
 * 🔴 조회 실패는 throw — 호출부가 대상 행 전부를 막는다(fail-closed).
 */
export async function blockedForNoSendClass(
  tenantId: string,
  rows: readonly { id: string; studentId: string; classId: string | null }[],
): Promise<Set<string>> {
  const blocked = new Set<string>();
  if (!rows.length) return blocked;
  const admin = createAdminClient();
  // '보낼 반'은 따로 읽는다(0303a 칸이 없는 스키마에서도 호출부 조회가 죽지 않게, #95). 칸이 없으면 throw → 전부 막음.
  const sendClassById = new Map<string, string | null>();
  for (let i = 0; i < rows.length; i += 100) {
    const { data, error } = await admin
      .from("lesson_reports")
      .select("id, classnote_class_id")
      .eq("tenant_id", tenantId)
      .in("id", rows.slice(i, i + 100).map((r) => r.id));
    if (error) throw new Error(error.message);
    for (const d of data ?? []) sendClassById.set(d.id as string, (d.classnote_class_id as string | null) ?? null);
  }
  // 학생별로 한 번에(반 수가 적다) — 25명씩(B4).
  const byStudent = new Map<string, { id: string; studentId: string; classId: string | null }[]>();
  for (const r of rows) byStudent.set(r.studentId, [...(byStudent.get(r.studentId) ?? []), r]);
  const students = [...byStudent.keys()];
  for (let i = 0; i < students.length; i += 25) {
    await Promise.all(
      students.slice(i, i + 25).map(async (sid) => {
        const list = byStudent.get(sid) ?? [];
        const ids = [
          ...new Set(list.flatMap((r) => [r.classId, sendClassById.get(r.id) ?? null]).filter((x): x is string => !!x)),
        ];
        const live = await liveBoardClassIds(tenantId, sid, ids);
        for (const r of list) {
          if (r.classId && live.has(r.classId)) continue;
          const send = sendClassById.get(r.id);
          if (send && live.has(send)) continue;
          blocked.add(r.id);
        }
      }),
    );
  }
  return blocked;
}
