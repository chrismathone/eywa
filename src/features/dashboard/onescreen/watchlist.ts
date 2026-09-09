/**
 * '살펴볼 학생' — 결석 위험과 상담 후속조치를 **한 목록으로 합치는 규칙**(순수·Vitest).
 *
 * 설계서 §4: 두 신호는 축이 다르지만(결석은 출결, 후속은 상담) 원장이 하는 일은 같다 — *"오늘 누구에게
 * 전화할까"*. 두 칸으로 나누면 한 화면에서 같은 판단을 두 번 하게 된다.
 *
 * 🔴 **결석 사유 원문을 담지 않는다**(설계서 §4) — 사유엔 `병원`·`수술`·`가족여행`이 그대로 적혀 있어
 *    바탕화면에 띄울 값이 아니다. 이름과 횟수까지만.
 * 🔴 **사전 통보로 설명되는 결석은 애초에 안 온다** — 그 판정(`unexplainedAbsences`)은 조회 쪽이
 *    이미 하고 있고(원장 2026-08-29), 여기서 다시 하지 않는다(같은 판정을 두 곳에서 하면 갈린다).
 * ⚠️ 목록은 짧다(최대 8) — 넘치면 **원본 화면**에 맡긴다. 한 화면 규약상 안쪽 스크롤을 만들지 않는다.
 */

export type WatchKind = "absence" | "followup";

export type WatchItem = {
  /** 목록 키 — 같은 학생이 두 신호로 걸릴 수 있어 종류까지 넣는다. */
  key: string;
  kind: WatchKind;
  studentId: string;
  studentName: string;
  /** 한 줄 사유 — "결석 5회" · "후속 기한 지남". 🔴 사유 **원문**은 넣지 않는다. */
  reason: string;
  /** 정렬·색을 정하는 급함. 낮을수록 급하다. */
  rank: number;
  tone: "critical" | "caution" | "inert";
};

/** 결석 위험 한 건(조회가 이미 사전 통보분을 걸러 낸 뒤의 값). */
export type AbsenceInput = { studentId: string; studentName: string; absences: number };
/** 상담 후속조치 한 건. */
export type FollowUpInput = {
  id: string;
  studentId: string;
  studentName: string;
  urgency: "overdue" | "today" | "soon" | string;
};

/**
 * 🔑 **순서가 이 칸의 전부다.** 8줄만 서므로, 무엇이 위에 오느냐가 곧 "원장이 오늘 누구에게 전화하는가"다.
 *  1. 기한이 **지난** 후속조치 — 약속한 일을 넘긴 것이라 가장 급하다.
 *  2. 결석이 잦은 학생 — 횟수가 많을수록 위.
 *  3. 오늘 기한 후속 → 임박 후속.
 * ⚠️ 결석을 후속조치보다 **위에 두지 않는다** — 결석은 매일 비슷한 얼굴이 뜨지만 후속조치는 사람이
 *    직접 "언제까지 하겠다"고 적어 둔 약속이다. 약속을 넘긴 것이 먼저다.
 */
const URGENCY_RANK: Record<string, number> = { overdue: 0, today: 30, soon: 40 };

export function buildWatchlist(
  absences: readonly AbsenceInput[],
  followUps: readonly FollowUpInput[],
  limit = 8,
): WatchItem[] {
  const items: WatchItem[] = [];
  for (const f of followUps) {
    const rank = URGENCY_RANK[f.urgency] ?? 50;
    items.push({
      key: `followup:${f.id}`,
      kind: "followup",
      studentId: f.studentId,
      studentName: f.studentName,
      reason:
        f.urgency === "overdue" ? "후속 기한 지남" : f.urgency === "today" ? "후속 기한 오늘" : "후속 기한 임박",
      rank,
      tone: f.urgency === "overdue" ? "critical" : f.urgency === "today" ? "caution" : "inert",
    });
  }
  for (const a of absences) {
    items.push({
      key: `absence:${a.studentId}`,
      kind: "absence",
      studentId: a.studentId,
      studentName: a.studentName,
      // 🔴 창(최근 14일)을 **글자로** 적는다 — 기간이 빠진 "결석 5회"는 언제 것인지 알 수 없다(§8-1).
      reason: `14일 결석 ${a.absences}회`,
      // 결석은 잦을수록 위로. 기한 지난 후속(0)보다는 아래, 오늘 기한(30)보다는 위에 오게 10~29에 눕힌다.
      rank: Math.max(10, 29 - a.absences),
      tone: a.absences >= 5 ? "critical" : "caution",
    });
  }
  return items
    .sort((x, y) => x.rank - y.rank || x.studentName.localeCompare(y.studentName, "ko"))
    .slice(0, limit);
}

/** 목록에 다 못 담은 나머지 수 — "외 N명"으로 적어 **잘렸다는 사실**을 숨기지 않는다(#89). */
export function watchlistOverflow(
  absences: readonly AbsenceInput[],
  followUps: readonly FollowUpInput[],
  limit = 8,
): number {
  return Math.max(0, absences.length + followUps.length - limit);
}
