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
 * 영어(2026-11-04 · AywaSync 1.0.15)는 같은 입구(`routeNoticeCandidates`)에서 갈린다 — 반 방이 이어진 영어 반이면 반 방
 * ([`notice-english-route.ts`](./notice-english-route.ts)), 아니면 지금처럼 1인 보드. 두 과목의 삼자 일치 재료는 한 벌(notice-route-legs.ts).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import {
  SEND_CLASS_SUBJECTS,
  classRouteActive,
  isSendCandidateClass,
  liveBoardClassIdsOf,
} from "@/features/onescreen/send-class";
import { isClassnoteSubjectEnabled } from "@/features/onescreen/classnote-guard";
import { workerSupportsNoticeClassRoute, workerSupportsNoticeEnglishRoom } from "../worker-results";
import {
  classTargetKey,
  pickNoticeClass,
  type EnglishNoticePick,
  type NoticeClassCandidate,
  type NoticeClassPick,
} from "../notice-class-pick";
import type { NoticeCandidate, NoticeSkip, NoticeTarget } from "../notice-targets";
import { attendingClassesOf, studentLegQuery, teacherLegQueries, teachersByClass } from "./notice-route-legs";
import { ENGLISH_NOTICE_SUBJECT, resolveEnglishNoticeClasses } from "./notice-english-route";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** 하트비트가 이 시간 안이면 "지금 돌고 있는 워커"로 본다(교재 첨부 게이트와 같은 창). */
const WORKER_LIVE_MS = 10 * 60 * 1000;

/**
 * 공지 경로를 판정할 **발송 PC들의 하트비트**(`last_results`) — 실제로 게시하는 워커(postMode)만. 지금 켜져 있는 워커가 있으면 그 전부,
 * 없으면 **가장 최근에 돌던 워커 하나**. 조회 실패·발송 PC 없음 = 빈 목록(= 지원 안 함 · 옛 경로).
 * 🔴 켜진 워커가 없을 때 가장 최근 워커로 보는 까닭 — 그러지 않으면 연동 PC가 꺼진 시각(밤·주말)에 보낸 공지만 조용히 1인 보드로 가서,
 *    같은 강사·같은 학생의 글이 시각에 따라 다른 보드로 갈린다(삼자 일치도 안 탄다).
 */
async function postingWorkerPool(supabase: ServerClient): Promise<unknown[]> {
  const { data, error } = await supabase.from("classnote_workers").select("last_seen, last_results");
  if (error) return [];
  // 실제로 게시하는 워커(postMode)만 본다 — 시험·dry-run PC는 큐를 집지 않으므로, 그 PC가 새 판이어도 발송 PC가 옛 판이면 아니다.
  const posting = (raw: unknown) => !!raw && typeof raw === "object" && !Array.isArray(raw) && (raw as Record<string, unknown>).postMode === true;
  const seen = (data ?? [])
    .map((w) => ({ at: Date.parse(String(w.last_seen ?? "")), raw: w.last_results }))
    .filter((w) => Number.isFinite(w.at) && posting(w.raw));
  if (!seen.length) return [];
  const live = seen.filter((w) => Date.now() - w.at < WORKER_LIVE_MS);
  return live.length ? live.map((w) => w.raw) : [seen.reduce((a, b) => (b.at > a.at ? b : a)).raw];
}

/** 판정할 워커가 있고 **전부** 그 기능을 알 때만 참. */
const poolSupports = (pool: readonly unknown[], supports: (raw: unknown) => boolean) => pool.length > 0 && pool.every(supports);

/**
 * 지금 켜져 있는 연동 PC가 **공지의 반 보드 경로**를 처리할 수 있는가(롤아웃 가드).
 * 앱은 바로 배포되고 워커는 zip으로 늦게 바뀐다 — 그 사이 `classId`가 실린 대상을 옛 워커가 집으면 반 보드 이름을 1인 보드처럼
 * 찾다가 "공유 보드"로 막힌다(발송 실패). 그래서 **켜져 있는 워커가 있고 전부 지원할 때만** 반 보드 경로를 쓴다.
 * 그 전에는 지금까지처럼 1인 보드로 보낸다(옛 워커·새 워커 둘 다 처리한다). 조회 실패 = 아니다(옛 경로).
 * 켜져 있는 워커가 없을 때는 가장 최근에 돌던 워커로 판정한다(`postingWorkerPool`).
 */
export async function noticeClassRouteWorkerReady(supabase: ServerClient): Promise<boolean> {
  return poolSupports(await postingWorkerPool(supabase), workerSupportsNoticeClassRoute);
}
// 영어 반 방 경로의 롤아웃 가드(`caps.noticeEnglishRoom`, AywaSync 1.0.15)는 `routeNoticeCandidates`가 같은 풀로 본다 — 옛 워커는
// `classId`가 실린 영어 대상을 수학 반 보드로 보고 실패시키므로, 수학과 같은 방식(켜진 워커 전부 · 없으면 가장 최근)으로 본다.

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
  //    판정은 영어 반 방 경로와 한 벌(notice-route-legs.ts).
  const classesOf = attendingClassesOf(await studentLegQuery(admin, tenantId, studentIds), date);
  const classIds = [...new Set([...classesOf.values()].flatMap((s) => [...s]))];
  if (!classIds.length) {
    for (const r of requests) out.set(r.studentId, { ok: false, reason: "no_class_board" });
    return out;
  }

  const teacherIds = [...new Set(requests.flatMap((r) => [...(r.teacherIds ?? [])]))];
  // 서로 독립인 조회 — 한 번에(B4). 반·연결은 반 id 청크, 멤버는 학생 id 청크 × 페이징(B2·B3). 선생님 다리 재료는 공용 모듈(영어 반 방과 한 벌).
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
    // 선생님 다리 재료 — 오늘 유효한 교시 담당 · 위임(요청한 선생님들만).
    ...teacherLegQueries(admin, tenantId, classIds, teacherIds, date),
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
  const teachersOf = teachersByClass({ classes: classById.values(), slots, delegations, teacherIds, date });

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

/** 후보 한 명 + 삼자 일치 재료. 수학은 반 보드 경로가 켜져 있을 때 반 보드로, 영어는 그 반에 반 방이 이어져 있으면 반 방으로 간다. */
export type RoutedCandidate = NoticeCandidate & { hints?: readonly string[]; teacherIds?: readonly string[] | null; teacherStrict?: boolean };
type MergedCandidate = RoutedCandidate & { hints: string[]; teacherIds: string[] };

/** 같은 학생이 여러 번 뽑혀도 한 번만(반 힌트·선생님은 뽑힌 순서대로 모은다) — 한 학생에게 같은 글이 두 번 가지 않게. */
function mergeByStudent(list: readonly RoutedCandidate[]): Map<string, MergedCandidate> {
  const merged = new Map<string, MergedCandidate>();
  for (const c of list) {
    const cur = merged.get(c.studentId) ?? { ...c, hints: [], teacherIds: [] };
    for (const h of c.hints ?? []) if (h && !cur.hints.includes(h)) cur.hints.push(h);
    for (const t of c.teacherIds ?? []) if (t && !cur.teacherIds.includes(t)) cur.teacherIds.push(t);
    merged.set(c.studentId, cur);
  }
  return merged;
}
const requestsOf = (merged: Map<string, MergedCandidate>): NoticeClassRequest[] =>
  [...merged.values()].map((c) => ({ studentId: c.studentId, hints: c.hints, teacherIds: c.teacherIds, teacherStrict: c.teacherStrict === true }));

/**
 * 후보를 **반 보드 경로(수학)** · **영어 반 방 경로** · **기존 1인 보드 경로(그 밖)**로 가른다 — 세 발송 표면이 같이 쓰는 한 벌.
 * 영어(원장 2026-11-04 — 1인 보드 배정 금지 뒤): 삼자 일치로 정한 영어 반에 ClassNote 반 방(s2_0006)이 이어져 있으면 그 반 방의
 * 그 학생 원아에게 1:1(대상에 `classId` + `subject: "english"`), 없거나 반을 못 정하면 지금처럼 `(영어)이름` 1인 보드(rest).
 * @returns classTargets = 반 보드·반 방으로 갈 대상(완성) · rest = 기존 경로로 넘길 후보(resolveNoticeTargets + 동명이인 가드) · skipped = 제외 사유
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
  const sendable = (c: RoutedCandidate) => isClassnoteSubjectEnabled(c.subject, settings.report.classnoteSubjects);
  const isMath = (c: RoutedCandidate) => SEND_CLASS_SUBJECTS.has(c.subject ?? "") && sendable(c);
  const isEnglish = (c: RoutedCandidate) => c.subject === ENGLISH_NOTICE_SUBJECT && sendable(c);
  const plain = (list: readonly RoutedCandidate[]): NoticeCandidate[] =>
    list.map((c) => ({ studentId: c.studentId, name: c.name, classnoteName: c.classnoteName, subject: c.subject }));
  // 경로가 꺼져 있거나(수학 = 설정·모듈 · 영어 = 모듈) 켜져 있는 연동 PC가 아직 처리 못 하면 그 과목은 전부 기존 경로.
  // 하트비트는 한 번만 읽는다(두 과목이 같은 발송 PC 목록을 본다).
  const wantMath = candidates.some(isMath) && classRouteActive(settings, senderName);
  const wantEnglish = candidates.some(isEnglish) && !(settings.modules?.disabled ?? []).includes("classnote");
  const pool = wantMath || wantEnglish ? await postingWorkerPool(supabase) : [];
  const mathOn = wantMath && poolSupports(pool, workerSupportsNoticeClassRoute);
  const englishOn = wantEnglish && poolSupports(pool, workerSupportsNoticeEnglishRoom);
  if (!mathOn && !englishOn) return { classTargets: [], rest: plain(candidates), skipped: [] };

  const merged = mergeByStudent(mathOn ? candidates.filter(isMath) : []);
  const englishMerged = mergeByStudent(englishOn ? candidates.filter(isEnglish) : []);
  // 서로 독립인 판정 — 한 번에(B4). 조회 실패는 throw(호출부가 그 발송을 막는다).
  const [picks, englishPicks] = await Promise.all([
    merged.size ? resolveNoticeClasses(tenantId, requestsOf(merged)) : Promise.resolve(new Map<string, NoticeClassPick>()),
    englishMerged.size ? resolveEnglishNoticeClasses(tenantId, requestsOf(englishMerged)) : Promise.resolve(new Map<string, EnglishNoticePick>()),
  ]);
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
  // 영어 — 반 방으로 정해진 학생만 반 방 대상. 반 방이 없는 반·반을 못 정한 학생은 지금처럼 1인 보드(rest — 동명이인 가드를 탄다).
  // 🔴 `subject: "english"`가 워커의 분기 표식이다 — 없으면 워커가 수학 반 보드로 확인한다(영어 반은 거기서 통과하지 못한다).
  const englishPersonal = new Set<string>();
  for (const c of englishMerged.values()) {
    const pick = englishPicks.get(c.studentId);
    if (pick?.route !== "room") {
      englishPersonal.add(c.studentId);
      continue;
    }
    const eff = (c.classnoteName || c.name || "").trim();
    if (!eff) {
      skipped.push({ name: c.name || "(이름 없음)", reason: "no_name" });
      continue;
    }
    classTargets.push({
      studentId: c.studentId,
      studentName: eff,
      board: classTargetKey(pick.boardName, eff),
      classId: pick.classId,
      className: pick.className,
      subject: ENGLISH_NOTICE_SUBJECT,
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
  const routed = (c: RoutedCandidate) => (mathOn && isMath(c)) || (englishOn && isEnglish(c) && !englishPersonal.has(c.studentId));
  return { classTargets: unique, rest: plain(candidates.filter((c) => !routed(c))), skipped };
}
