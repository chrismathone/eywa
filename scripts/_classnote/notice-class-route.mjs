// scripts/_classnote/notice-class-route.mjs — **원생 개별 공지·교재요청서의 반 보드 경로**(수학) 대상 확정(워커 전용).
//
// 원장 2026-10-02: *"수학은 더 이상 1인 보드 안쓰는 방향"* · *"개인 공지는 수업보고서와 동일하게 일인발송으로 배선"* ·
//   *"해당 선생님 반 학생 삼자 일치를 기준으로 발송"* · *"배선이 철저해야 오발송 일어나지 않음"*.
// 앱이 (보내는 선생님 – 반 – 학생) 삼자 일치로 **반(`target.classId`)**을 정해 큐에 싣는다(report-admin/server/notice-class-route.ts).
// 워커는 그 반을 **그대로 믿지 않고** 게시 직전에 다시 확인한다:
//   ① 그 학생이 오늘 그 반에 다닌다(수강 — 반이동 당일 옛 반은 아니다, notify-axis.mjs `isCurrentEnrollment`)
//   ② 그 반이 반 보드 대상(활성·수학·보고서 발송)이고 연결(0302a)이 있고 그 학생의 원아 매칭이 전부 ok다(`isClassRouteEligible`)
//   ③ 그 원아가 **지금** ClassNote 그 반에 배정돼 있다(`resolveClassTargets` — 실시간 재조회 + 배정 번호)
// 원아는 이름으로 찾지 않는다 — 0302a에 가드를 통과해 적힌 원아 번호만 쓴다(수업보고서 반 보드 경로와 같은 함수).
// 🔴 하나라도 어긋나면 **보내지 않는다** — 1인 보드로 되돌리지 않는다(조용히 옛 경로로 가면 어느 보드로 갔는지 아무도 모른다).
//
// **영어 반 방 경로(원장 2026-11-04 · AywaSync 1.0.15)**: 1인 보드 배정 금지 뒤 영어 신입이 개별 공지·교재요청서를 받을 곳이 없어서,
// 앱이 삼자 일치로 정한 영어 반에 반 방(s2_0006)이 이어져 있으면 대상에 `classId` + `subject: "english"`를 싣는다. 워커는
//   ① 오늘 그 반에 다닌다(수학과 같은 확인) ② 그 영어 반의 반 방 연결이 지금도 있다(`loadEnglishClassBoard` — 영어 반만)
//   ③ 원아 = 원아 연결(0185a) ∩ 지금 그 방 원아(`resolveEnglishClassTargets` — 영어 보고서와 같은 함수 · 이름으로 찾지 않는다 · 방에 없으면 막는다)
// 를 확인한 뒤 수학 반 보드와 **같은 게시·중복 확인·교차 확인 코드**로 올린다. 어긋나면 그 대상만 실패 — 1인 보드로 되돌리지 않는다.
import { isClassRouteEligible, resolveClassTargets } from "./classnote-class-route.mjs";
import { ENGLISH_ROUTE_SUBJECTS, englishBlockedMessage, loadEnglishClassBoard, resolveEnglishClassTargets } from "./english-class-route.mjs";
import { isCurrentEnrollment } from "./notify-axis.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const kstToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());

/** 이 타깃이 반 보드 경로인가 — 앱이 `classId`를 실었을 때만(영어 반 방 대상도 여기 든다 — 대상 확정만 다르다). */
export const isClassRouteTarget = (target) => typeof target?.classId === "string" && target.classId.length > 0;

/** 이 타깃이 **영어 반 방** 경로인가 — `classId`에 더해 앱이 `subject: "english"`를 실었을 때만(표식이 없으면 수학 반 보드로 본다). */
export const isEnglishRoomTarget = (target) => isClassRouteTarget(target) && ENGLISH_ROUTE_SUBJECTS.has(target?.subject ?? "");

const BAD_TARGET_NOTE = "발송 대상 정보가 올바르지 않습니다(반·학생 번호) — 다시 발송해 주세요";
const NOT_ATTENDING_NOTE = "이 학생은 지금 그 반에 다니지 않습니다 — 반을 확인한 뒤 다시 발송해 주세요";
/**
 * 수업 시작 전·휴원 중인 학생은 ClassNote로 보내지 않는다(원장 2026-11-05 *"수업 시작전이거나 휴원 중인 학생은 클래스노트 배정을 하지말것"*).
 * 앱이 큐에 올리기 전에 거르지만(notice-standing.ts), 큐에 오른 뒤 휴원으로 바뀐 경우를 여기서 다시 막는다.
 */
export const NOT_STARTED_NOTE = "이 학생은 아직 그 반 수업을 시작하지 않았습니다 — 수업 시작 전에는 ClassNote로 보내지 않습니다(첫 수업 날부터 보낼 수 있습니다)";
export const ON_HOLD_NOTE = "이 학생은 지금 휴원 중입니다 — 휴원 중에는 ClassNote로 보내지 않습니다(복귀하면 다시 보낼 수 있습니다)";
/**
 * 앱이 반 방으로 정한 뒤 그 연결이 풀렸다 — 시험이 벨 힌트 말을 담지 않는지 본다.
 * "다시 보내면 된다"고 약속하지 않는다 — 교재요청서는 같은 공지가 일부라도 나갔으면 그 요청서를 다시 보낼 수 없다(중복 발송 차단).
 */
export const ENGLISH_ROOM_GONE_NOTE =
  "이 영어 반의 ClassNote 반 방 연결이 발송 직전에 없어져 보내지 않았습니다(다른 보드로 보내지 않습니다) — 관리자에게 알려 주세요";

/** 큐 대상의 반·학생 번호(모양이 틀리면 null — 조회하지 않고 거절한다). */
function targetIds(target) {
  const classId = String(target?.classId ?? "");
  const studentId = String(target?.studentId ?? "");
  return UUID.test(classId) && UUID.test(studentId) ? { classId, studentId } : null;
}

/**
 * ① 오늘 그 반에 다니는가(큐에 오른 뒤 반이 바뀌었을 수 있다) — 반이동 당일 옛 반은 아니다. 수학·영어 같은 확인.
 * 휴원(그 수강의 휴원·대기 또는 학생 상태 휴원)과 수업 시작 전은 다니는 것이 아니다(2026-11-05) — 사유를 갈라 돌려준다(`attendanceNote`).
 * @returns {Promise<string|null>} 보내지 않을 사유(다니면 null)
 */
async function attendsToday(sql, tenant, classId, studentId) {
  const rows = await sql`select e.start_date::text as start_date, e.end_date::text as end_date, e.is_transferred, e.on_hold, s.status::text as status
    from enrollments e join students s on s.id = e.student_id
    where e.tenant_id = ${tenant} and e.class_id = ${classId} and e.student_id = ${studentId}`;
  return attendanceNote(rows, kstToday());
}

/**
 * 순수 판정(시험용으로 뺐다) — 수강 줄(`start_date`·`end_date`·`is_transferred`·`on_hold`·학생 `status`) → 보내지 않을 사유 또는 null.
 * 오늘 다니는 줄이 있고 휴원이 아니면 null · 학생 휴원이거나 오늘 줄이 모두 휴원이면 휴원 · 끝나지 않은 줄이 아직 시작 전이면 시작 전 ·
 * 그 밖은 '다니지 않음'.
 */
export function attendanceNote(rows, today) {
  const list = rows ?? [];
  const current = list.filter((e) => isCurrentEnrollment({ startDate: e.start_date, endDate: e.end_date, isTransferred: e.is_transferred === true }, today));
  if (current.length) {
    if (list.some((e) => e.status === "on_hold") || current.every((e) => e.on_hold === true)) return ON_HOLD_NOTE;
    return null;
  }
  const upcoming = list.some((e) => e.start_date && e.start_date > today && (!e.end_date || e.end_date >= e.start_date));
  return upcoming ? NOT_STARTED_NOTE : NOT_ATTENDING_NOTE;
}

/**
 * 반 보드 경로 타깃의 게시 대상 확정.
 * @returns {Promise<{ok:true, boardId:number, boardName:string, enrolled:Array<{child:{id:number,name:string}, enrollment:{id:number}}>, others:number[]}
 *                 | {ok:false, note:string}>}  note = 화면에 그대로 나가는 한글 사유 · others = 그 반 보드의 **다른** 원아(교차 확인용)
 */
export async function resolveNoticeClassTarget(sql, page, { tenant, centerId, target }) {
  const ids = targetIds(target);
  if (!ids) return { ok: false, note: BAD_TARGET_NOTE };
  const { classId, studentId } = ids;

  // ① 오늘 그 반에 다니는가.
  const notAttending = await attendsToday(sql, tenant, classId, studentId);
  if (notAttending) return { ok: false, note: notAttending };

  // ② 반 보드 대상 + 연결 + 원아 매칭 ok.
  if (!(await isClassRouteEligible(sql, tenant, classId, studentId)))
    return { ok: false, note: "이 학생의 ClassNote 반 보드 연결이 확인되지 않습니다(C.N 빨강) — '지금 반 보드 동기화' 뒤 다시 발송해 주세요" };

  // ③ 실시간 재확인 + 배정 번호.
  const resolved = await resolveClassTargets(sql, page, { tenant, centerId, classId, studentId });
  if (!resolved.ok) return { ok: false, note: resolved.error };
  if (!resolved.targets.length) return { ok: false, note: "이 학생의 ClassNote 원아를 찾지 못했습니다 — 반 매칭 후 다시 발송해 주세요" };
  return { ok: true, boardId: resolved.boardId, boardName: resolved.boardName, enrolled: resolved.targets, others: resolved.others ?? [] };
}

/**
 * 영어 반 방 경로 타깃의 게시 대상 확정 — `resolveNoticeClassTarget`과 같은 모양을 돌려준다(게시·중복 확인·교차 확인 코드를 그대로 탄다).
 * 🔴 실패 사유는 벨 힌트(SQL `classnote_failure_hint` · 앱 `humanizeClassnoteError`)의 말을 담지 않는다 — 담으면 벨이 1인 보드를
 *    만들거나 채우라고 안내한다(board-safety.mjs 상단 · 시험 no-personal-board-writes.test.mjs).
 * 조회 실패(DB·ClassNote)는 throw — 호출부(공지 큐)가 그 대상만 실패로 적는다.
 */
export async function resolveNoticeEnglishTarget(sql, page, { tenant, centerId, target }) {
  const ids = targetIds(target);
  if (!ids) return { ok: false, note: BAD_TARGET_NOTE };
  const { classId, studentId } = ids;

  // ① 오늘 그 반에 다니는가.
  const notAttending = await attendsToday(sql, tenant, classId, studentId);
  if (notAttending) return { ok: false, note: notAttending };

  // ② 그 영어 반의 반 방 연결이 지금도 있는가(사람이 이은 연결 — 큐에 오른 뒤 풀렸을 수 있다 · 영어 반이 아니면 없음).
  //    없으면 막는다 — 1인 보드로 몰래 돌리지 않는다(화면이 '반 방으로 보냄'을 거짓말하게 된다).
  const board = await loadEnglishClassBoard(sql, tenant, classId);
  if (!board) return { ok: false, note: ENGLISH_ROOM_GONE_NOTE };

  // ③ 원아 = 원아 연결 ∩ 지금 그 방 원아(영어 보고서와 같은 함수 — 이름으로 찾지 않는다 · 방에 없으면 막는다).
  const resolved = await resolveEnglishClassTargets(sql, page, { tenant, centerId, board, studentId });
  if (!resolved.ok) return { ok: false, note: resolved.error };
  if (!resolved.targets.length) return { ok: false, note: englishBlockedMessage("not_in_board", board.boardName) };
  return { ok: true, boardId: resolved.boardId, boardName: resolved.boardName, enrolled: resolved.targets, others: resolved.others ?? [] };
}

/** 한 공지에서 한 반 보드의 교차 확인이 훑는 원아 상한(반 보드는 보통 20명 안쪽 — 넘으면 앞에서부터). */
export const LEAK_CHECK_MAX = 60;

/** 원아 한 명의 최근 알림장 글(20건) — 실패하면 null. */
async function recentReports(page, centerId, child) {
  const list = await page
    .evaluate(
      async ([center, ch]) => {
        const res = await fetch(`/api/v1_2/centers/${center}/reports/?page_size=20&child=${ch}&tz=Asia/Seoul&center_id=${center}`, { headers: { accept: "application/json" } });
        if (!res.ok) return null;
        const j = await res.json().catch(() => null);
        return (Array.isArray(j) ? j : j && Array.isArray(j.results) ? j.results : []).map((r) => ({ id: r.id, cls: r.cls, child: r.child, content: r.content }));
      },
      [centerId, child],
    )
    .catch(() => null);
  return Array.isArray(list) ? list : null;
}

/**
 * 교차 확인의 **기준선** — 이 공지를 그 반 보드에 올리기 **전에**, 그 반의 다른 원아들이 지금 갖고 있는 글 번호를 적어 둔다.
 * 공지 본문은 보고서 링크처럼 고유하지 않다(같은 문장을 어제·방금 다른 공지로 그 반 다른 학생에게 보냈을 수 있다) — 그래서
 * "같은 본문이 있다"가 아니라 **"올리기 전엔 없던 글이 생겼다"**로 판정한다(시계·글 번호 순서에 기대지 않는다).
 * @returns {Promise<Map<number, Set<number>|null>>} 원아 → 그때 있던 글 번호(조회 실패한 원아는 null — 그 원아는 확인하지 못한다)
 */
export async function snapshotChildReports(page, centerId, children) {
  const out = new Map();
  for (const child of children.slice(0, LEAK_CHECK_MAX)) {
    const list = await recentReports(page, centerId, child);
    out.set(Number(child), list ? new Set(list.map((r) => Number(r.id))) : null);
  }
  return out;
}

/**
 * 게시 후 **교차 확인** — 그 반 보드에서 **대상이 아닌 원아**에게, 올리기 전엔 없던 이 공지의 글(같은 반 · 같은 본문)이 생겼으면 새어 나간 것이다.
 * 수업보고서의 교차 확인(classnote-class-route.mjs `crossCheckOthers`)과 같은 목적.
 * @param {{ centerId:number, boardId:number, others:number[], contents:string[], baseline:Map<number, Set<number>|null> }} a
 *   others = 대상이 아닌 원아(기준선이 있는 원아만 본다) · contents = 이 공지가 그 반 보드에 올린 본문들
 * @returns {Promise<{ leakedTo:number[], unknown:boolean }>}  unknown = 확인하지 못한 원아가 있다(조회 실패·기준선 없음)
 */
export async function findNoticeLeaks(page, { centerId, boardId, others, contents, baseline }) {
  const wanted = [...new Set(contents)].filter((c) => typeof c === "string" && c.length > 0);
  const leakedTo = [];
  let unknown = false;
  for (const child of others) {
    const before = baseline.get(Number(child));
    if (!before) {
      unknown = true; // 기준선이 없다(그때 조회 실패·그 뒤 반에 들어온 원아) — 새었다고도 아니라고도 못 한다
      continue;
    }
    const list = await recentReports(page, centerId, child);
    if (!list) {
      unknown = true;
      continue;
    }
    const hit = list.some(
      (r) => String(r.cls) === String(boardId) && String(r.child) === String(child) && wanted.includes(r.content) && !before.has(Number(r.id)),
    );
    if (hit) leakedTo.push(Number(child));
  }
  return { leakedTo, unknown };
}
