import "server-only";

/**
 * **원생 개별 공지·교재요청서의 반 보드 경로**(수학) — 대상 반 확정의 조회부. 판정은 순수 [`pickNoticeClass`](../notice-class-pick.ts).
 *
 * 원장 2026-10-02: *"수학은 더 이상 1인 보드 안쓰는 방향"* · *"개인 공지는 수업보고서와 동일하게 일인발송"* ·
 * *"해당 선생님 반 학생 삼자 일치를 기준으로 발송"* · *"배선이 철저해야 오발송 일어나지 않음"*.
 *
 * 세 발송 표면(원스크린 강사 공지 · 사무실 '반 공지' 탭의 원생 개별 공지 · 교재요청서)이 **이 함수 하나**로 반을 정한다 —
 * 표면마다 따로 정하면 "원스크린에선 A반 보드, 교재요청서는 B반 보드"처럼 갈린다(#77).
 * 🔴 맞는 반이 없는 학생은 **제외**한다(사유와 함께) — 1인 보드 `(수학)이름`으로 되돌리지 않는다.
 * 🔴 워커도 게시 직전에 같은 것을 다시 본다(scripts/_classnote/notice-class-route.mjs — 오늘 그 반에 다니는가 · 반 보드 연결 ·
 *    원아 매칭 ok · 지금 그 반에 배정돼 있는가). 여기서 고른 반은 "보낼 곳"의 제안이고 워커의 확인이 마지막 문이다.
 * ⚠️ admin 클라이언트 + tenant 필터(RLS 우회) — 강사 RLS로는 다른 강사 반의 연결·멤버 행이 안 보여 판정이 사람마다 달라진다.
 *    돌려주는 것은 그 학생의 반 이름·반 보드 이름뿐이다.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { isDelegationActiveOn } from "@/features/classes/delegation-window";
import {
  SEND_CLASS_SUBJECTS,
  classRouteActive,
  isSendCandidateClass,
  liveBoardClassIdsOf,
} from "@/features/onescreen/send-class";
import { isClassnoteSubjectEnabled } from "@/features/onescreen/classnote-guard";
import { workerSupportsNoticeClassRoute } from "../worker-results";
import { classTargetKey, pickNoticeClass, type NoticeClassCandidate, type NoticeClassPick } from "../notice-class-pick";
import type { NoticeCandidate, NoticeSkip, NoticeTarget } from "../notice-targets";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** 하트비트가 이 시간 안이면 "지금 돌고 있는 워커"로 본다(교재 첨부 게이트와 같은 창). */
const WORKER_LIVE_MS = 10 * 60 * 1000;

/**
 * 지금 켜져 있는 연동 PC가 **공지의 반 보드 경로**를 처리할 수 있는가(롤아웃 가드).
 * 앱은 바로 배포되고 워커는 zip으로 늦게 바뀐다 — 그 사이 `classId`가 실린 대상을 옛 워커가 집으면 반 보드 이름을 1인 보드처럼
 * 찾다가 "공유 보드"로 막힌다(발송 실패). 그래서 **켜져 있는 워커가 있고 전부 지원할 때만** 반 보드 경로를 쓴다.
 * 그 전에는 지금까지처럼 1인 보드로 보낸다(옛 워커·새 워커 둘 다 처리한다). 조회 실패 = 아니다(옛 경로).
 * 🔴 **켜져 있는 워커가 없을 때는 가장 최근에 돌던 워커**로 판정한다 — 그러지 않으면 연동 PC가 꺼진 시각(밤·주말)에 보낸 수학 공지만
 *    조용히 1인 보드로 가서, 같은 강사·같은 학생의 글이 시각에 따라 다른 보드로 갈린다(삼자 일치도 안 탄다).
 */
export async function noticeClassRouteWorkerReady(supabase: ServerClient): Promise<boolean> {
  const { data, error } = await supabase.from("classnote_workers").select("last_seen, last_results");
  if (error) return false;
  // 실제로 게시하는 워커(postMode)만 본다 — 시험·dry-run PC는 큐를 집지 않으므로, 그 PC가 새 판이어도 발송 PC가 옛 판이면 아니다.
  const posting = (raw: unknown) => !!raw && typeof raw === "object" && !Array.isArray(raw) && (raw as Record<string, unknown>).postMode === true;
  const seen = (data ?? [])
    .map((w) => ({ at: Date.parse(String(w.last_seen ?? "")), raw: w.last_results }))
    .filter((w) => Number.isFinite(w.at) && posting(w.raw));
  if (!seen.length) return false;
  const live = seen.filter((w) => Date.now() - w.at < WORKER_LIVE_MS);
  if (live.length) return live.every((w) => workerSupportsNoticeClassRoute(w.raw));
  return workerSupportsNoticeClassRoute(seen.reduce((a, b) => (b.at > a.at ? b : a)).raw);
}

export type NoticeClassRequest = {
  studentId: string;
  /** 화면이 고른 반(그 학생을 뽑은 반 — 여러 반이면 순서대로). */
  hints?: readonly string[];
  /** 보내는 선생님(들) — 강사 본인 또는 교재요청서의 주인. null·빈 배열 = 선생님 없는 발송(사무실). */
  teacherIds?: readonly string[] | null;
  /** 선생님 다리가 **문**인가 — 강사 본인이 보낼 때 true(남의 반 보드로 못 보낸다). 사무실이 주인 대신 보내면 false(우선순위일 뿐). */
  teacherStrict?: boolean;
};

/**
 * 학생별 보낼 반 — 삼자 일치(보내는 선생님 – 반 – 학생). 조회 실패는 throw(호출부가 fail-closed: 그 발송을 막는다).
 * @returns studentId → 판정(맞는 반이 없으면 `{ok:false, reason}`)
 */
export async function resolveNoticeClasses(
  tenantId: string,
  requests: readonly NoticeClassRequest[],
  date: string = kstToday(),
): Promise<Map<string, NoticeClassPick>> {
  const out = new Map<string, NoticeClassPick>();
  const studentIds = [...new Set(requests.map((r) => r.studentId).filter(Boolean))];
  if (!studentIds.length) return out;
  const admin = createAdminClient();

  // ① 학생 다리 — 오늘 다니는 반. 종료 규약은 단일 소스(반이동 당일 옛 반은 이미 아니다, [[#125]]). 휴원은 다니는 반이 아니다.
  const enr = await fetchAllPagedInChunks<{
    id: string; class_id: string; student_id: string; start_date: string | null; end_date: string | null;
    is_transferred: boolean | null; on_hold: boolean | null;
  }>(studentIds, (chunk, from, to) =>
    admin
      .from("enrollments")
      .select("id, class_id, student_id, start_date, end_date, is_transferred, on_hold")
      .eq("tenant_id", tenantId)
      .in("student_id", chunk)
      .order("id")
      .range(from, to),
  );
  const classesOf = new Map<string, Set<string>>();
  for (const e of enr) {
    if (e.on_hold) continue;
    if (e.start_date && e.start_date > date) continue;
    if (isEnrollmentEndedOn(e.end_date, date, !!e.is_transferred)) continue;
    if (!classesOf.has(e.student_id)) classesOf.set(e.student_id, new Set());
    classesOf.get(e.student_id)!.add(e.class_id);
  }
  const classIds = [...new Set([...classesOf.values()].flatMap((s) => [...s]))];
  if (!classIds.length) {
    for (const r of requests) out.set(r.studentId, { ok: false, reason: "no_class_board" });
    return out;
  }

  const teacherIds = [...new Set(requests.flatMap((r) => [...(r.teacherIds ?? [])]))];
  // 서로 독립인 조회 — 한 번에(B4). 반·연결은 반 id 청크, 멤버는 학생 id 청크 × 페이징(B2·B3).
  const [classes, boards, members, slots, delegations] = await Promise.all([
    fetchInChunks<{
      id: string; class_name: string; subject: string | null; is_active: boolean | null; report_optout: boolean | null;
      closed_at: string | null; teacher_id: string | null;
    }>(classIds, (chunk) =>
      admin
        .from("classes")
        .select("id, class_name, subject, is_active, report_optout, closed_at, teacher_id")
        .eq("tenant_id", tenantId)
        .in("id", chunk),
    ),
    fetchInChunks<{ class_id: string; board_name: string | null }>(classIds, (chunk) =>
      admin.from("classnote_class_boards").select("class_id, board_name").eq("tenant_id", tenantId).in("class_id", chunk),
    ),
    fetchAllPagedInChunks<{ id: number; class_id: string; student_id: string; status: string | null }>(studentIds, (chunk, from, to) =>
      admin
        .from("classnote_class_board_members")
        .select("id, class_id, student_id, status")
        .eq("tenant_id", tenantId)
        .in("student_id", chunk)
        .order("id")
        .range(from, to),
    ),
    // 선생님 다리 재료 — 오늘 유효한 교시 담당(교시 표는 이력을 함께 담는다, [[#88]]).
    teacherIds.length
      ? fetchAllPagedInChunks<{ id: string; class_id: string; teacher_id: string | null }>(classIds, (chunk, from, to) =>
          admin
            .from("class_schedules")
            .select("id, class_id, teacher_id")
            .eq("tenant_id", tenantId)
            .in("class_id", chunk)
            .in("teacher_id", teacherIds)
            .lte("valid_from", date)
            .or(`valid_to.is.null,valid_to.gte.${date}`)
            .order("id")
            .range(from, to),
        )
      : Promise.resolve([]),
    teacherIds.length
      ? fetchInChunks<{ class_id: string; delegate_user_id: string | null; from_date: string; to_date: string; revoked_at: string | null }>(
          classIds,
          (chunk) =>
            admin
              .from("class_delegations")
              .select("class_id, delegate_user_id, from_date, to_date, revoked_at")
              .eq("tenant_id", tenantId)
              .in("class_id", chunk)
              .in("delegate_user_id", teacherIds)
              .is("revoked_at", null),
        )
      : Promise.resolve([]),
  ]);

  // 반 보드 대상 반(수학 · 활성 · 보고서 발송 · 종강 전) — 수업보고서의 '보낼 반 후보'와 같은 기준.
  const classById = new Map(
    classes
      .filter((c) => isSendCandidateClass({ subject: c.subject, is_active: c.is_active, report_optout: c.report_optout, closed_at: c.closed_at }, date))
      .map((c) => [c.id, c]),
  );
  const boardName = new Map(boards.map((b) => [b.class_id, (b.board_name ?? "").trim()]));
  const membersOf = new Map<string, { classId: string; status: string | null }[]>();
  for (const m of members) {
    if (!membersOf.has(m.student_id)) membersOf.set(m.student_id, []);
    membersOf.get(m.student_id)!.push({ classId: m.class_id, status: m.status });
  }
  // 반 → 그 반 담당(담임 ∪ 오늘 교시 담당 ∪ 오늘 위임). 요청한 선생님들만 담는다.
  const wanted = new Set(teacherIds);
  const teachersOf = new Map<string, Set<string>>();
  const add = (classId: string, teacherId: string | null) => {
    if (!teacherId || !wanted.has(teacherId)) return;
    if (!teachersOf.has(classId)) teachersOf.set(classId, new Set());
    teachersOf.get(classId)!.add(teacherId);
  };
  for (const c of classById.values()) add(c.id, c.teacher_id);
  for (const s of slots) add(s.class_id, s.teacher_id);
  for (const d of delegations)
    if (isDelegationActiveOn({ fromDate: d.from_date, toDate: d.to_date, revokedAt: d.revoked_at }, date)) add(d.class_id, d.delegate_user_id);

  for (const r of requests) {
    const mine = [...(classesOf.get(r.studentId) ?? [])].filter((id) => classById.has(id));
    // 이 학생의 살아 있는 반 보드 — 워커 `isClassRouteEligible`·수업보고서 판정과 같은 규칙(연결 + ok 멤버만).
    const liveIds = liveBoardClassIdsOf(mine, mine.filter((id) => boardName.has(id)), membersOf.get(r.studentId) ?? []);
    const senders = [...(r.teacherIds ?? [])];
    const live: NoticeClassCandidate[] = liveIds.map((id) => {
      const c = classById.get(id)!;
      const set = teachersOf.get(id);
      return {
        classId: id,
        className: c.class_name,
        boardName: boardName.get(id) || c.class_name,
        taught: senders.some((t) => set?.has(t)),
        homeroom: !!c.teacher_id && senders.includes(c.teacher_id),
      };
    });
    out.set(
      r.studentId,
      pickNoticeClass({
        live,
        teacher: !senders.length ? "none" : r.teacherStrict ? "strict" : "prefer",
        hints: r.hints,
        // 반 보드 상태와 무관하게, 보내는 선생님이 이 학생이 다니는 수학 반을 맡고 있는가(사유 가르기용).
        teachesStudent: mine.some((id) => senders.some((t) => teachersOf.get(id)?.has(t))),
      }),
    );
  }
  return out;
}

/** 후보 한 명 + 삼자 일치 재료. `subject`가 수학이고 반 보드 경로가 켜져 있을 때만 반 보드로 간다. */
export type RoutedCandidate = NoticeCandidate & { hints?: readonly string[]; teacherIds?: readonly string[] | null; teacherStrict?: boolean };

/**
 * 후보를 **반 보드 경로(수학)**와 **기존 1인 보드 경로(그 밖)**로 가른다 — 세 발송 표면이 같이 쓰는 한 벌.
 * @returns classTargets = 반 보드로 갈 대상(완성) · rest = 기존 경로로 넘길 후보(resolveNoticeTargets + 동명이인 가드) · skipped = 제외 사유
 */
export async function routeNoticeCandidates(args: {
  supabase: ServerClient;
  tenantId: string;
  settings: Parameters<typeof classRouteActive>[0] & { report: { classnoteSubjects: readonly string[] } };
  /** 보내는 사람 표시 이름(시범 강사 판정용 — 수학 발송 경로가 '시범'일 때만 쓰인다). */
  senderName: string | null;
  candidates: readonly RoutedCandidate[];
}): Promise<{ classTargets: NoticeTarget[]; rest: NoticeCandidate[]; skipped: NoticeSkip[] }> {
  const { supabase, tenantId, settings, senderName, candidates } = args;
  const isMath = (c: RoutedCandidate) =>
    SEND_CLASS_SUBJECTS.has(c.subject ?? "") && isClassnoteSubjectEnabled(c.subject, settings.report.classnoteSubjects);
  const math = candidates.filter(isMath);
  const plain = (list: readonly RoutedCandidate[]): NoticeCandidate[] =>
    list.map((c) => ({ studentId: c.studentId, name: c.name, classnoteName: c.classnoteName, subject: c.subject }));
  // 경로가 꺼져 있거나(설정·모듈) 켜져 있는 연동 PC가 아직 처리 못 하면 전부 기존 경로.
  if (!math.length || !classRouteActive(settings, senderName) || !(await noticeClassRouteWorkerReady(supabase)))
    return { classTargets: [], rest: plain(candidates), skipped: [] };

  // 같은 학생이 여러 번 뽑혀도 한 번만(반 힌트는 뽑힌 순서대로 모은다) — 한 학생에게 같은 글이 두 번 가지 않게.
  const merged = new Map<string, RoutedCandidate & { hints: string[]; teacherIds: string[] }>();
  for (const c of math) {
    const cur = merged.get(c.studentId) ?? { ...c, hints: [], teacherIds: [] };
    for (const h of c.hints ?? []) if (h && !cur.hints.includes(h)) cur.hints.push(h);
    for (const t of c.teacherIds ?? []) if (t && !cur.teacherIds.includes(t)) cur.teacherIds.push(t);
    merged.set(c.studentId, cur);
  }
  const picks = await resolveNoticeClasses(
    tenantId,
    [...merged.values()].map((c) => ({ studentId: c.studentId, hints: c.hints, teacherIds: c.teacherIds, teacherStrict: c.teacherStrict === true })),
  );
  const classTargets: NoticeTarget[] = [];
  const skipped: NoticeSkip[] = [];
  for (const c of merged.values()) {
    const eff = (c.classnoteName || c.name || "").trim();
    if (!eff) {
      skipped.push({ name: c.name || "(이름 없음)", reason: "no_name" });
      continue;
    }
    const pick = picks.get(c.studentId);
    if (!pick || !pick.ok) {
      skipped.push({ name: eff, reason: pick?.reason ?? "no_class_board" });
      continue;
    }
    classTargets.push({
      studentId: c.studentId,
      studentName: eff,
      board: classTargetKey(pick.boardName, eff),
      classId: pick.classId,
      className: pick.className,
    });
  }
  // 표시 키(`board`)가 겹치는 대상은 결과를 서로 구분할 수 없다(같은 반 보드 · 같은 표시 이름) — 둘 다 뺀다(0302a가 같은 반
  // 동명이인을 보류로 두므로 여기까지 오지 않는 것이 정상이다. 왔다면 어느 학생의 결과인지 화면이 거짓말하게 된다).
  const seenKey = new Map<string, number>();
  for (const t of classTargets) seenKey.set(t.board, (seenKey.get(t.board) ?? 0) + 1);
  const unique = classTargets.filter((t) => {
    if (seenKey.get(t.board) === 1) return true;
    skipped.push({ name: t.studentName, reason: "name_collision" });
    return false;
  });
  unique.sort((a, b) => a.board.localeCompare(b.board, "ko"));
  return { classTargets: unique, rest: plain(candidates.filter((c) => !isMath(c))), skipped };
}
