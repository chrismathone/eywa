import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getTeachingClassIds } from "@/features/classes/server/delegation";
import { isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import {
  decideSendClass,
  isSendCandidateClass,
  liveBoardClassIdsOf,
  mineOnly,
  pickMainClass,
  sendClassGateRow,
} from "../send-class";

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
  | { ok: true; classId: string; via: "makeup" | "chosen" | "auto" }
  | {
      ok: false;
      reason: "choose" | "none";
      candidates: { id: string; name: string }[];
      /** 물을 때 처음 골라 둘 반(메인 수업) — 없으면 null. */
      defaultId: string | null;
      /** 보강 추가 때 고른 반인데 이 학생의 반 보드가 없어 **다른 반으로 가야 할 때** 그 반(화면 경고 한 줄). */
      makeupClass: { id: string; name: string } | null;
    };

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
    .select("class_id, start_date, end_date, is_transferred")
    .eq("tenant_id", tenantId)
    .eq("student_id", studentId);
  if (enrErr) throw new Error(enrErr.message);
  // 학생과 접점 = 그날 다니는 반. 종료 규약은 단일 소스(isEnrollmentEndedOn — 반이동 당일 옛 반은 이미 아니다, [[#125]]).
  const live = [
    ...new Set(
      (enr ?? [])
        .filter(
          (e) =>
            (!e.start_date || e.start_date <= reportDate) &&
            !isEnrollmentEndedOn(e.end_date as string | null, reportDate, !!e.is_transferred),
        )
        .map((e) => e.class_id as string),
    ),
  ];
  if (!live.length) return [];

  const [{ data: cls, error: clsErr }, hasBoard, teaching] = await Promise.all([
    admin
      .from("classes")
      .select("id, class_name, subject, is_active, report_optout, closed_at")
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
    // 특강도 후보다(원장 2026-09-30 — 특강 반 보드도 만든다).
    // 🔴 종강 반은 후보가 아니다(원장 2026-09-30 *"종강이 아닌 담당 반에서 뜨는게 맞지? 학생과 접점이 있는"* · *"보내는 반도 마찬가지"*).
    //    종강 반 **자기 보고서**는 보드가 살아 있는 동안 그대로 그 반으로 간다(classBoardLiveForStudent — 후보 목록과 무관).
    .filter((c) =>
      isSendCandidateClass(
        {
          subject: c.subject as string | null,
          is_active: c.is_active as boolean | null,
          report_optout: c.report_optout as boolean | null,
          closed_at: (c.closed_at as string | null) ?? null,
        },
        reportDate,
      ),
    )
    .filter((c) => hasBoard.has(c.id as string))
    .map((c) => ({ id: c.id as string, name: c.class_name as string }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return mineOnly(all, mine, teacher.restrict);
}

/**
 * 반 정보 없는 보강 보고서의 'ClassNote로 보낼 반'을 정한다(A안, 원장 2026-09-29).
 *
 * 판정 순서 = 순수 [`decideSendClass`](../send-class.ts) (워커 `pickRouteClass`와 같은 순서):
 *  1. 🔴 **보강 추가 때 고른 반**(`makeupClassId`, 0171a)에 이 학생의 살아 있는 반 보드가 있으면 그 반 — 묻지 않는다
 *     (원장 2026-09-30 *"애초에 보강 추가로 선택된 반에 보고서가 발송되면 되는거아닌가?"*).
 *  2. `chosen`(강사가 고른 반) — 후보 안에 있을 때만 받는다(화면 위조 차단).
 *  3. 보강 반이 있는데 보드가 없으면 **묻는다**(기본 선택 = 메인 수업, `makeupClass`로 경고 한 줄).
 *  4. 메인 수업(send-class.ts `pickMainClass`) — 정할 수 없으면 `choose`로 후보를 돌려준다.
 * 후보 = 그날 그 학생이 다니는 반 중 반 보드 대상(수학 · 활성 · 보고서 발송 · **종강 전** — 특강 포함)이면서
 * 그 학생의 살아 있는 반 보드가 있는 반, 작성 강사가 담당하는 반(담임 ∪ 그날 위임)으로 좁힌다(`mineOnly`).
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
   * `autoPick` — 메인 수업을 자동으로 고를까. 보고서에 **반이 있는데** 그 반 보드가 없는 경우(종강 반 등)는 false —
   *   다른 반으로 자동으로 보내지 않고 사람이 고른다(원장 2026-09-30 적대 리뷰). 반 없는 보강만 자동.
   * `makeupClassId` — 보고서의 보강 반(0171a `makeup_class_id`). 반 없는 보강에만 있다.
   */
  opts: { autoPick?: boolean; makeupClassId?: string | null } = {},
): Promise<SendClassResolution> {
  const admin = createAdminClient();
  const makeupClassId = opts.makeupClassId ?? null;
  // 1. 보강 반에 살아 있는 반 보드가 있으면 후보를 읽을 것도 없다(조회 실패는 throw → 호출부 fail-closed).
  const makeupLive = makeupClassId ? (await liveBoardClassIds(tenantId, studentId, [makeupClassId])).has(makeupClassId) : false;
  if (makeupClassId && makeupLive) return { ok: true, classId: makeupClassId, via: "makeup" };

  const [candidates, makeupClass] = await Promise.all([
    loadSendClassCandidates(tenantId, studentId, reportDate, teacher),
    makeupClassId
      ? admin
          .from("classes")
          .select("id, class_name")
          .eq("tenant_id", tenantId)
          .eq("id", makeupClassId)
          .maybeSingle()
          .then(({ data, error }) => {
            if (error) throw new Error(error.message);
            return { id: makeupClassId, name: (data?.class_name as string | undefined) ?? "" };
          })
      : Promise.resolve(null),
  ]);
  const ids = candidates.map((c) => c.id);

  // 메인 수업은 필요할 때만 센다(고른 반이 있거나 후보가 없거나 자동 고르기를 안 하면 안 센다).
  let main: string | null = null;
  if (ids.length && !chosen && opts.autoPick !== false) {
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
    main = pickMainClass(
      ids,
      Object.fromEntries(ids.map((id, i) => [id, sentArr[i]!])),
      Object.fromEntries(ids.map((id, i) => [id, attArr[i]!])),
    );
  }

  const d = decideSendClass({ candidates: ids, makeupClassId, makeupLive, chosen, main });
  if (d.kind === "send") return { ok: true, classId: d.classId, via: d.via };
  const mk = d.makeupMismatch ? makeupClass : null;
  if (d.kind === "none") return { ok: false, reason: "none", candidates: [], defaultId: null, makeupClass: mk };
  return { ok: false, reason: "choose", candidates, defaultId: d.defaultId, makeupClass: mk };
}

/**
 * 관리자 일괄 경로(미발송 일괄 발송·재발송·멈춤 복구·대량 작성)의 **보낼 반 게이트** — 원스크린·직접 작성과 같은 규칙을 행 묶음에.
 * 막을 행 id를 돌려준다(호출부가 반별 발송 대상 수학 행만 넘긴다). 한 행 판정 = 순수 [`sendClassGateRow`](../send-class.ts)
 * (워커 `pickRouteClass`와 같은 순서):
 *  · 보고서 반에 이 학생의 살아 있는 반 보드가 있으면 통과
 *  · 이미 정해 둔 '보낼 반'(0303a `classnote_class_id`)이 살아 있으면 통과(워커가 그 반으로 간다 — 앱이 적은 최종 결정)
 *  · 반 없는 보강이면 보강 추가 때 고른 반(0171a `makeup_class_id`)이 살아 있을 때 통과(원장 2026-09-30).
 *    ⚠️ 이때 '보낼 반'을 보강 반으로 **적는다**(부수 효과 · `out.rewritten`에 id) — 보강 반을 모르는 옛 워커도 같은 반으로 가게.
 *    🔴 이미 어딘가 게시된 행(`classnote_sent_at`)은 다시 적지 않는다(옛 위치 기록 보존 — 회수가 글을 찾는 자리).
 *  · 그 밖 = 막는다(워커가 1인 보드로 흘리지 않게 — 원장 2026-09-30 *"담당 반이 없으면 보고서 발송 불가능하게"*)
 * 🔴 조회 실패는 throw — 호출부가 대상 행 전부를 막는다(fail-closed). '보낼 반'을 못 적은 행은 막는다.
 */
export async function blockedForNoSendClass(
  tenantId: string,
  rows: readonly { id: string; studentId: string; classId: string | null }[],
  /** 감사로그용 — '보낼 반'을 보강 반으로 적은 행 id가 여기 쌓인다. */
  out?: { rewritten: string[] },
): Promise<Set<string>> {
  const blocked = new Set<string>();
  if (!rows.length) return blocked;
  const admin = createAdminClient();
  // '보낼 반'은 따로 읽는다(0303a 칸이 없는 스키마에서도 호출부 조회가 죽지 않게, #95). 칸이 없으면 throw → 전부 막음.
  const extra = new Map<string, { stored: string | null; makeup: string | null; sentAt: string | null }>();
  for (let i = 0; i < rows.length; i += 100) {
    const { data, error } = await admin
      .from("lesson_reports")
      .select("id, classnote_class_id, makeup_class_id, classnote_sent_at")
      .eq("tenant_id", tenantId)
      .in("id", rows.slice(i, i + 100).map((r) => r.id));
    if (error) throw new Error(error.message);
    for (const d of data ?? [])
      extra.set(d.id as string, {
        stored: (d.classnote_class_id as string | null) ?? null,
        makeup: (d.makeup_class_id as string | null) ?? null,
        sentAt: (d.classnote_sent_at as string | null) ?? null,
      });
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
          ...new Set(
            list
              .flatMap((r) => [r.classId, extra.get(r.id)?.stored ?? null, extra.get(r.id)?.makeup ?? null])
              .filter((x): x is string => !!x),
          ),
        ];
        const live = await liveBoardClassIds(tenantId, sid, ids);
        for (const r of list) {
          const x = extra.get(r.id) ?? { stored: null, makeup: null, sentAt: null };
          const g = sendClassGateRow({
            classId: r.classId,
            classLive: !!r.classId && live.has(r.classId),
            storedId: x.stored,
            storedLive: !!x.stored && live.has(x.stored),
            makeupClassId: x.makeup,
            makeupLive: !!x.makeup && live.has(x.makeup),
            sentAt: x.sentAt,
          });
          if (!g.pass) {
            blocked.add(r.id);
            continue;
          }
          if (!g.rewriteTo) continue;
          // 조건부 한 문(compare-and-set) — 게시 기록이 없고 **'보낼 반'이 읽은 값 그대로일 때만**. 판정과 이 줄 사이에
          // 워커가 게시했거나 누가 보낼 반을 새로 적었으면 0행이다(그때도 통과: 워커는 그 새 값을 따른다 — 덮지 않는다).
          let upd = admin
            .from("lesson_reports")
            .update({ classnote_class_id: g.rewriteTo })
            .eq("tenant_id", tenantId)
            .eq("id", r.id)
            .is("classnote_sent_at", null);
          upd = x.stored ? upd.eq("classnote_class_id", x.stored) : upd.is("classnote_class_id", null);
          const { data: updRows, error } = await upd.select("id");
          if (error) blocked.add(r.id);
          else if (updRows?.length) out?.rewritten.push(r.id);
        }
      }),
    );
  }
  return blocked;
}

/**
 * 보고서의 **보강 반**(0171a `makeup_class_id`) — 관리자 경로용. 관리자 작성은 이 칸을 쓰지 않지만, 강사가 원스크린에서
 * 보강으로 추가해 둔 같은 행(반 없음 · 과목 단위)을 관리자가 고쳐 보내면 그 앵커가 남아 있다 → 같은 규칙으로 그 반에 보낸다.
 * `reportId`가 있으면 그 행, 없으면 (학생·날짜·과목·반 없음) 행. 반 없는 행에만 의미가 있다. 조회 실패는 throw(호출부 fail-closed).
 */
export async function reportMakeupClassId(
  tenantId: string,
  key: { reportId: string } | { studentId: string; reportDate: string; subject: string },
): Promise<string | null> {
  const admin = createAdminClient();
  let q = admin.from("lesson_reports").select("makeup_class_id").eq("tenant_id", tenantId).is("class_id", null);
  q =
    "reportId" in key
      ? q.eq("id", key.reportId)
      : q.eq("student_id", key.studentId).eq("report_date", key.reportDate).eq("subject", key.subject);
  const { data, error } = await q.limit(1);
  if (error) throw new Error(error.message);
  return (data?.[0]?.makeup_class_id as string | null | undefined) ?? null;
}
