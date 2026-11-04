import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { requestClassnoteBoardSync } from "@/features/report-admin/server/classnote-sync-actions";
import { runAsAutoSyncRequest } from "@/features/report-admin/server/classnote-sync-auto";
import { loadSyncRows } from "@/features/report-admin/server/classnote-sync-core";
import { kstToday } from "@/lib/date-kst";
import {
  boardMissingNotice,
  boardMissingPreview,
  boardMissingWorthSync,
  classifyBoardMissing,
  type BoardMissingKind,
  type BoardMissingStatus,
  decideSendClass,
  isSendCandidateClass,
  liveBoardClassIdsOf,
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
 * 정규 보고서가 "이 학생이 받을 반 보드가 없다"로 막혔을 때 — **까닭을 가려** 안내를 고르고, 기다리면 풀리는 까닭이면
 * 그 반·학생의 반 보드 동기화를 요청한다(원장 2026-10-03 *"해결가능한건 해결하는 방향으로"*). 예전엔 까닭이 무엇이든
 * "반 보드가 없어 … 관리자에게 동기화를 부탁"만 떴다 — 방금 배정한 신입도, 학부모가 가입하지 않은 학생도, 반을 떠난 학생도.
 *  · 요청은 '지금 반 보드 동기화' 버튼과 **같은 함수**(`requestClassnoteBoardSync`)다 — 권한·지점당 하나·5분 쿨다운·연동 PC 확인·
 *    감사로그가 그대로 붙는다(강사도 누를 수 있는 버튼이다). 🔴 "요청했다"는 그 함수의 대답이 아니라 **되읽은 요청 표**로 판정한다 —
 *    살아 있는 요청(또는 그 뒤를 잇는 범위)에 이 반이 실려 있을 때만. 합류가 범위를 못 실은 채 성공을 돌려주는 길이 있다.
 *  · `request=false` = 미리 보기(보내려던 게 아니다) — 까닭만 가리고 요청하지 않는다. 문장도 미리 보기용이다.
 *  · 🔴 "기다리면 풀린다"는 동기화가 실제로 그 학생을 넣을 수 있을 때만 — 워커의 대상 기준(`targetClassWhere`·
 *    `currentEnrollmentOn`: 활성·수학·종강 전 반 · 재원이고 테스트가 아닌 학생 · 시작일 ≤ 오늘 ≤ 종료일)을 본다 — 반은 보고서 발송 반만
 *    (워커는 2026-11-03부터 미발송 반도 동기화하지만 그 반 보고서는 여기 오기 전에 막힌다 · 더 좁은 쪽이라 안내가 거짓이 되지 않는다).
 * 조회 실패·예외 = 까닭 모름(옛 안내 그대로). 던지지 않는다 — 발송은 이미 막혔고 여기는 안내일 뿐이다.
 * ⚠️ admin 클라이언트 + tenant 필터 — 돌려주는 것은 결과 코드와 안내 문장뿐이다.
 */
export async function explainBoardMissing(
  tenantId: string,
  classId: string,
  studentId: string,
  opts: { request: boolean },
): Promise<{ status: BoardMissingStatus; error: string; holdReason?: string; /** 발송을 누르면 동기화를 요청할 까닭인가(미리 보기가 버튼을 잠그지 않는다) */ requestable: boolean }> {
  const unknown = { ...boardMissingNotice("unknown", false), requestable: false };
  let kind: BoardMissingKind = "unknown";
  let holdReason: string | null = null;
  const admin = createAdminClient();
  try {
    const today = kstToday();
    const [enr, mem, cls, stu, link, classMembers] = await Promise.all([
      admin.from("enrollments").select("start_date, end_date").eq("tenant_id", tenantId).eq("student_id", studentId).eq("class_id", classId),
      admin
        .from("classnote_class_board_members")
        .select("status, reason")
        .eq("tenant_id", tenantId)
        .eq("class_id", classId)
        .eq("student_id", studentId),
      admin.from("classes").select("is_active, report_optout, subject, closed_at").eq("tenant_id", tenantId).eq("id", classId).maybeSingle(),
      admin.from("students").select("status, is_test").eq("tenant_id", tenantId).eq("id", studentId).maybeSingle(),
      admin.from("classnote_class_boards").select("class_id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("class_id", classId),
      admin.from("classnote_class_board_members").select("student_id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("class_id", classId),
    ]);
    if (enr.error || mem.error || cls.error || stu.error || link.error || classMembers.error) return unknown;
    const rows = (enr.data ?? []) as { start_date: string | null; end_date: string | null }[];
    const members = (mem.data ?? []) as { status: string | null; reason: string | null }[];
    const c = cls.data as { is_active: boolean | null; report_optout: boolean | null; subject: string | null; closed_at: string | null } | null;
    const st = stu.data as { status: string | null; is_test: boolean | null } | null;
    // 워커 `targetClassWhere`(종강일 당일까지 대상) · `currentEnrollmentOn`(재원 · 테스트 아님)과 같은 기준 — 반은 보고서 발송 반만(워커보다 좁다).
    const classTarget = !!c && isSendCandidateClass({ subject: c.subject, is_active: c.is_active, report_optout: c.report_optout, closed_at: c.closed_at }, today);
    const studentTarget = !!st && st.status === "enrolled" && !st.is_test;
    holdReason = members.find((m) => m.status !== "ok")?.reason ?? null;
    kind = classifyBoardMissing({
      liveNow: rows.some((e) => (!e.start_date || e.start_date <= today) && (!e.end_date || e.end_date >= today)),
      ended: rows.some((e) => !!e.end_date && e.end_date < today),
      syncTarget: classTarget && studentTarget,
      classLinked: (link.count ?? 0) > 0,
      classMemberCount: classMembers.count ?? 0,
      memberStatuses: members.map((m) => m.status),
      holdReason,
    });
  } catch {
    return unknown;
  }
  const requestable = boardMissingWorthSync(kind);
  if (!opts.request) return { status: boardMissingNotice(kind, false, holdReason).status, error: boardMissingPreview(kind, holdReason), requestable };
  let requested = false;
  if (requestable) {
    try {
      const res = await runAsAutoSyncRequest(() => requestClassnoteBoardSync({ classIds: [classId], studentIds: [studentId], source: "send_blocked" }));
      // 대답이 아니라 요청 표로 확인한다 — 살아 있는 요청(또는 실행 중 요청의 다음 범위)에 이 반이 실렸는가.
      if (res.ok) {
        const live = (await loadSyncRows(admin, tenantId)).active;
        const has = (scope: { full: boolean; classIds: string[] } | null | undefined) => !!scope && (scope.full || scope.classIds.includes(classId));
        requested = !!live && (live.status === "running" ? has(live.nextScope) || has(live.scope) : has(live.scope));
      }
    } catch {
      requested = false;
    }
  }
  return { ...boardMissingNotice(kind, requested, holdReason), requestable };
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
  | { ok: true; classId: string; via: "makeup" }
  | {
      ok: false;
      reason: "choose" | "none";
      /** 고를 수 있는 반 — 고르면 그 반이 **새 보강 반**이 된다(출석부 칸도 함께 옮겨진다). */
      candidates: { id: string; name: string }[];
      /** 물을 때 처음 골라 둘 반(메인 수업) — 없으면 null. */
      defaultId: string | null;
      /** 보강 반이 있는데 이 학생의 반 보드가 없어 **반을 바꿔야 할 때** 그 반(화면 경고 한 줄). */
      makeupClass: { id: string; name: string } | null;
    };

/**
 * 보강 반 **후보**(이름순) — 반 미정 보강의 반 고르기·보강 반 보드가 없을 때의 반 바꾸기(원스크린·관리자 직접 작성)가 **같은 목록**을 쓴다.
 * = 그날 그 학생이 다니는 반 중 **같은 과목** · 반 보드 대상(수학 · 활성 · 보고서 발송 · 종강 전 — 특강 포함) · 이 학생의 살아 있는 반 보드.
 * 🔴 원장 결정 2(2026-09-30): 위임 없이 남의 반 학생을 대신 보강하면 **학생의 원래 반(B반)**으로 — 작성 강사 담당 반으로 좁히지 않는다
 *    (예전 `mineOnly`는 그 반을 빼서 '반 없이'밖에 고를 수 없었다). 학생과 접점이 없는 반은 반 보드도 없어 후보가 되지 않는다.
 * 🔴 고른 반은 저장이 `acceptMakeupAnchor`로 다시 확인한다(같은 과목 · 학생이 다니는 반 · 종강 전) — 이 목록은 그 부분집합이다.
 * 비어 있으면 보낼 반이 없다(발송 불가 — `NO_SEND_CLASS_ERROR`).
 */
export async function loadSendClassCandidates(
  tenantId: string,
  studentId: string,
  reportDate: string,
  subject: string | null | undefined,
): Promise<{ id: string; name: string }[]> {
  const admin = createAdminClient();
  const { data: enr, error: enrErr } = await admin
    .from("enrollments")
    .select("class_id, start_date, end_date, is_transferred, on_hold")
    .eq("tenant_id", tenantId)
    .eq("student_id", studentId);
  if (enrErr) throw new Error(enrErr.message);
  // 학생과 접점 = 그날 다니는 반. 종료 규약은 단일 소스(isEnrollmentEndedOn — 반이동 당일 옛 반은 이미 아니다, [[#125]]).
  // 휴원(on_hold)은 다니는 반이 아니다 — 보강 앵커 후보(loadMakeupAnchorCandidates)와 같은 기준.
  const live = [
    ...new Set(
      (enr ?? [])
        .filter(
          (e) =>
            !e.on_hold &&
            (!e.start_date || e.start_date <= reportDate) &&
            !isEnrollmentEndedOn(e.end_date as string | null, reportDate, !!e.is_transferred),
        )
        .map((e) => e.class_id as string),
    ),
  ];
  if (!live.length) return [];

  const [{ data: cls, error: clsErr }, hasBoard] = await Promise.all([
    admin
      .from("classes")
      .select("id, class_name, subject, is_active, report_optout, closed_at")
      .eq("tenant_id", tenantId)
      .in("id", live),
    // 워커와 같은 판정(연결 + 이 학생 ok 멤버) — 연결만 보면 워커가 그 반에서 원아를 못 찾아 실패한다.
    liveBoardClassIds(tenantId, studentId, live),
  ]);
  if (clsErr) throw new Error(clsErr.message);
  return (cls ?? [])
    // 🔴 같은 과목만 — 보강 반은 보고서와 과목이 같아야 한다(`acceptMakeupAnchor`). 다른 과목 반을 고르면 저장이 거절한다.
    .filter((c) => !subject || (c.subject as string | null) === subject)
    // 🔴 종강 반은 후보가 아니다(원장 2026-09-30 *"종강이 아닌 담당 반에서 뜨는게 맞지? 학생과 접점이 있는"* · *"보내는 반도 마찬가지"*).
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
}

/**
 * 보강 보고서의 'ClassNote로 보낼 반' — 🔴 원장 2026-09-30: **발송 반 = 보강 반**(출석부 칸의 반과 같다).
 *
 * 판정 = 순수 [`decideSendClass`](../send-class.ts) (워커 `pickRouteClass`·일괄 게이트 `sendClassGateRow`와 한 규칙):
 *  1. 보강 반(`makeupClassId`, 0171a)에 이 학생의 살아 있는 반 보드가 있으면 그 반 — 묻지 않는다.
 *  2. 보강 반 보드가 없거나 보강 반이 없으면('반 미정') **묻는다** — 강사가 고른 반이 새 보강 반이 되고, 저장이 출석부 칸을
 *     그 반으로 함께 옮긴다(`changeMakeupAnchor` 규칙). 기본 선택 = 메인 수업(보낸 보고서 → 출결이 가장 많은 반).
 *  3. 후보가 없으면 `none`(발송 불가).
 * ⚠️ 예전의 '고른 반을 `classnote_class_id`에만 적고 보내기'·'메인 수업 자동 발송'은 없앴다 — 보고서 반과 출석부 반이 갈리는 길이었다.
 * ⚠️ admin 클라이언트 + tenant 필터 — 강사 RLS로는 다른 강사 반의 보고서·출결 수가 안 보여 메인 수업을 잘못 고른다.
 *    돌려주는 것은 그 학생의 반 이름뿐이다(보고서·출결 내용은 안 나간다).
 */
export async function resolveMakeupSendClass(
  tenantId: string,
  studentId: string,
  reportDate: string,
  subject: string | null | undefined,
  makeupClassId: string | null,
): Promise<SendClassResolution> {
  const admin = createAdminClient();
  // 1. 보강 반에 살아 있는 반 보드가 있으면 후보를 읽을 것도 없다(조회 실패는 throw → 호출부 fail-closed).
  const makeupLive = makeupClassId ? (await liveBoardClassIds(tenantId, studentId, [makeupClassId])).has(makeupClassId) : false;
  if (makeupClassId && makeupLive) return { ok: true, classId: makeupClassId, via: "makeup" };

  const [all, makeupClass] = await Promise.all([
    loadSendClassCandidates(tenantId, studentId, reportDate, subject),
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
  // 보드가 없는 보강 반을 다시 고르게 하지 않는다.
  const candidates = all.filter((c) => c.id !== makeupClassId);
  const ids = candidates.map((c) => c.id);

  // 메인 수업(기본 선택) — 후보가 둘 이상일 때만 센다(하나면 그 반, 없으면 발송 불가).
  let main: string | null = ids.length === 1 ? ids[0]! : null;
  if (ids.length > 1) {
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

  const d = decideSendClass({ candidates: ids, makeupClassId, makeupLive, main });
  if (d.kind === "send") return { ok: true, classId: d.classId, via: d.via };
  const mk = d.makeupMismatch ? makeupClass : null;
  if (d.kind === "none") return { ok: false, reason: "none", candidates: [], defaultId: null, makeupClass: mk };
  return { ok: false, reason: "choose", candidates, defaultId: d.defaultId, makeupClass: mk };
}

/**
 * 관리자 일괄 경로(미발송 일괄 발송·재발송·멈춤 복구·대량 작성)의 **보낼 반 게이트** — 원스크린·직접 작성과 같은 규칙을 행 묶음에.
 * 막을 행 id를 돌려준다(호출부가 반별 발송 대상 수학 행만 넘긴다). 한 행 판정 = 순수 [`sendClassGateRow`](../send-class.ts)
 * (워커 `pickRouteClass`와 같은 판정 — 원장 2026-09-30 *"보고서 반 = 출석부 반"*):
 *  · 정규 보고서 = 보고서 반에 이 학생의 살아 있는 반 보드가 있을 때만 통과(없으면 막는다 — 다른 반으로 보내지 않는다)
 *  · 보강 보고서 = 보강 반(0171a `makeup_class_id`)이 살아 있고 적힌 '보낼 반'이 그 반과 같거나 비었을 때만 통과.
 *    ⚠️ 이때 '보낼 반'을 보강 반으로 **적는다**(부수 효과 · `out.rewritten`에 id) — 보강 반을 모르는 옛 워커도 같은 반으로 가게.
 *    🔴 이미 어딘가 게시된 행(`classnote_sent_at`)은 다시 적지 않는다(옛 위치 기록 보존 — 회수가 글을 찾는 자리).
 *  · 반 미정 보강(보강 반 없음) = 막는다(반 없는 발송을 만들지 않는다)
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
