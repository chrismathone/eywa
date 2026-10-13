/**
 * 퇴원율 — 원장 결정 5·6(2026-10-13): *"이전달 내가 담당한 학생수 기준이 분모(1번 담당하거나 이런것은 취급안하고, 그 달의 절반이상을
 * 수강시킨경우)"* · *"이사 질병 권고퇴원을 신규 퇴원항목으로 추가"*. 순수 함수 — 학생 추적(students.ts)과 같은 명단·같은 유출 판정을 쓴다.
 *
 * - 분모 = 지난달 이 강사 명단(담임·부담임)에 **그 달 날수의 절반 이상** 있던 학생.
 * - 분자 = 그 학생 중 이 달에 이 강사에게서 **퇴원·수강종료**한 학생(한 학생은 한 번). 끝난 수강 **줄마다** 판정해 하나라도 남으면 센다:
 *   늘 빼는 것 = 반 이동 · 수업이 끝남(반 폐지·종강·운영 기간 종료·폐강) · 끝난 특강 · 같은 과목의 다른 반을 계속(또는 곧) 다님,
 *   원장이 고르는 것 = 뺄 퇴원 사유(기본 졸업·이사·질병·권고퇴원) · 수강종료(학원의 다른 수업은 계속 다님)를 셀지.
 * - 사유 = 그 수강의 종료 사유 → 없거나 '퇴원에 따른 자동 종료'면 학생의 퇴원 사유(퇴원관리와 같은 곳, 퇴원일 때만).
 * - 수치(raw) = 분자 ÷ 분모 × 100(%). 분모가 0이면 null(자료 없음 규칙).
 * 🔴 미리 등록했다가 취소된 수강(종료일 = 시작일 — 퇴원 처리가 그렇게 닫는다)은 '다닌다'로 보지 않는다(적대적 리뷰 2026-10-13).
 */
import { isSpecialLecture } from "@/features/classes/special-lecture";
import { normalizeReason, REASON_LABEL, type WithdrawalReason } from "@/features/withdrawals/types";
import type { ChurnOptions } from "../evaluation/config";
import { addDays, daysBetween, round1 } from "./dates";
import type { ChurnSource } from "./students";
import type { ChurnMetric, ChurnRow, PeriodWindow, PortfolioSnapshot, SnapshotClass, SnapshotEnrollment } from "./types";

/** 자유 글로 남는 구조적 종료(classes/server의 ARCHIVE_REASON · CLOSE_TERM_REASON · PERIOD_END_REASON과 같은 글 — churn.test가 잠근다). */
export const CLASS_END_TEXT: readonly string[] = ["반 폐지", "종강", "운영 기간 종료"];
const TRANSFER_TEXT = "반 이동";
const AUTO_END_TEXT = "퇴원에 따른 자동 종료";

const codeOf = (text: string | null | undefined): WithdrawalReason | null => (text && /^[a-z_]+$/i.test(text) ? normalizeReason(text.toLowerCase()) : null);
/** '곧 다님'의 끝 — 그만둔 날부터 31일 안에 시작하는 수강까지(다음 달 시작 수강을 읽는 창과 같다). 몇 달 뒤 재등록은 '다님'이 아니다. */
const SOON_DAYS = 31;
const futureCache = new WeakMap<readonly SnapshotEnrollment[], Map<string, SnapshotEnrollment[]>>();
const reasonCache = new WeakMap<readonly { id: string; reason: string | null }[], Map<string, string | null>>();
function futureOf(rows: readonly SnapshotEnrollment[]): Map<string, SnapshotEnrollment[]> {
  let map = futureCache.get(rows);
  if (!map) {
    map = new Map();
    for (const e of rows) map.set(e.student_id, [...(map.get(e.student_id) ?? []), e]);
    futureCache.set(rows, map);
  }
  return map;
}
function reasonsOf(rows: readonly { id: string; reason: string | null }[]): Map<string, string | null> {
  let map = reasonCache.get(rows);
  if (!map) reasonCache.set(rows, (map = new Map(rows.map((r) => [r.id, r.reason]))));
  return map;
}
const NO_FUTURE: SnapshotEnrollment[] = [];
const NO_REASONS: { id: string; reason: string | null }[] = [];

export function buildChurn(input: {
  source: ChurnSource; classes: ReadonlyMap<string, SnapshotClass>; teacherId: string; w: Pick<PeriodWindow, "start" | "end">; options: ChurnOptions;
} & Pick<PortfolioSnapshot, "futureEnrollments" | "studentReasons">): Omit<ChurnMetric, "id" | "max" | "value"> {
  const { source, classes, teacherId, w, options } = input;
  const prevEnd = addDays(w.start, -1);
  const prevDays = daysBetween(`${prevEnd.slice(0, 7)}-01`, prevEnd);
  const need = Math.ceil(prevDays.length / 2);
  const days = new Map<string, number>();
  for (const day of prevDays) for (const studentId of source.rosterOf(day, teacherId).keys()) days.set(studentId, (days.get(studentId) ?? 0) + 1);
  const base = new Set([...days].filter(([, n]) => n >= need).map(([id]) => id));
  const future = futureOf(input.futureEnrollments ?? NO_FUTURE);
  const studentReason = reasonsOf(input.studentReasons ?? NO_REASONS);

  const rows: ChurnRow[] = [];
  const counted = new Set<string>();
  for (const e of source.exitsOf(teacherId, w.start, w.end)) {
    if (!base.has(e.studentId)) continue;
    const ended = e.ended ?? [];
    const endedIds = new Set(ended.map((x) => x.id));
    const soon = addDays(e.day, SOON_DAYS);
    // 이 날 뒤에도 다니는(또는 31일 안에 시작하는) 다른 수강 — 취소된 미래 수강(종료일 ≤ 시작일)·보강 반·휴원·닫힌 반은 뺀다.
    // 끝난 수강은 줄(id)로 뺀다 — 같은 반에 다음 날 다시 등록한 것은 '다님'이다.
    const others = [...source.enrollmentsOf(e.studentId), ...(future.get(e.studentId) ?? [])].filter((x) => {
      const c = classes.get(x.class_id);
      return !endedIds.has(x.id) && !x.on_hold && !c?.is_makeup_pool && (!c?.closed_at || c.closed_at > e.day) && x.start_date <= soon
        && (!x.end_date || (x.end_date > e.day && x.end_date > x.start_date));
    });
    const type: ChurnRow["type"] = others.length ? "수강종료" : "퇴원";
    const judged = ended.map((x) => {
      const c = classes.get(x.class_id);
      const text = x.withdrawal_reason?.trim() || null;
      const code = codeOf(text) ?? (type === "퇴원" && (!text || text === AUTO_END_TEXT) ? codeOf(studentReason.get(e.studentId)) : null);
      const reason = code ? REASON_LABEL[code] : text && !codeOf(text) ? text : "사유 없음";
      let note: string | null = null;
      if (text === TRANSFER_TEXT || x.is_transferred) note = "반 이동";
      else if ((text && CLASS_END_TEXT.includes(text)) || c?.closed_at === e.day) note = "수업이 끝남";
      else if (isSpecialLecture({ isSpecial: c?.is_special, className: c?.class_name })) note = "끝난 특강";
      else if (others.some((o) => classes.get(o.class_id)?.subject === c?.subject)) note = "같은 과목 다른 반을 다님";
      else if (code && options.excludeReasons.includes(code)) note = `사유 ${REASON_LABEL[code]}`;
      return { reason, note };
    });
    const kept = judged.find((j) => !j.note);
    let note = kept ? null : (judged[0]?.note ?? "근거 확인");
    if (!note && type === "수강종료" && !options.countEnded) note = "수강종료는 세지 않음";
    const again = !note && counted.has(e.studentId);
    if (!note && !again) counted.add(e.studentId);
    rows.push({
      studentId: e.studentId, day: e.day, type, className: e.className, reason: (kept ?? judged[0])?.reason ?? "사유 없음",
      counted: !note && !again, note: note ?? (again ? "같은 학생 한 번만" : null),
    });
  }
  const raw = base.size ? round1((100 * counted.size) / base.size) : null;
  return {
    raw, base: base.size, need, counted: counted.size, detail: rows,
    basis: base.size ? `그만둠 ${counted.size} / 지난달 담당 ${base.size}명` : "지난달 담당 학생 없음",
    reason: `지난달(${Number(prevEnd.slice(5, 7))}월) 이 선생님이 ${need}일 이상 맡은 학생 ${base.size}명 중 이 달에 퇴원·수강종료한 학생의 비율입니다. 원장이 고른 사유·반 이동·수업이 끝남·끝난 특강·같은 과목의 다른 반으로 옮긴 경우는 빼고, 한 학생은 한 번만 셉니다.`,
  };
}
