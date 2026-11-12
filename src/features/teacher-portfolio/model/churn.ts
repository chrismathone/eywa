/**
 * 퇴원율 — 원장 결정 5·6(2026-10-13): *"이전달 내가 담당한 학생수 기준이 분모(1번 담당하거나 이런것은 취급안하고, 그 달의 절반이상을
 * 수강시킨경우)"* · *"이사 질병 권고퇴원을 신규 퇴원항목으로 추가"*. 순수 함수 — 학생 추적(students.ts)과 같은 명단을 쓴다.
 *
 * - 분모 = 지난달 이 강사 명단(담임·부담임)에 정규 수업으로 **그 달 날수의 절반 이상** 있던 학생(특강만 듣는 날은 안 센다).
 * - 분자 = 그 학생 중 이 달에 **퇴원·수강종료**한 학생(한 학생은 한 번) — 끝은 학생 수강에서 읽는다(`churnSource.exitsOf`):
 *   이 강사가 맡았던 반의 끝, 또는 이 강사가 정규 수업으로 가르친 과목을 통째로 끊은 끝(다른 선생님 반으로 옮긴 뒤라도 —
 *   main 퇴원율과 같은 셈 · 이 강사에게서 끊김 없이 이어진 수강만). 끝난 수강 **줄마다** 판정해 하나라도 남으면 센다:
 *   늘 빼는 것 = 반 이동(옮겨 간 반을 하루도 안 다녔으면 그만둔 것) · 수업이 끝남(반 폐지·종강·운영 기간 종료·폐강) · 끝난 특강 ·
 *   같은 과목의 다른 반을 계속(또는 곧 · 휴원 포함) 다님 — **어느 선생님 반이든** 반 이동처럼 뺀다(원장 2026-10-15 확인 *"다른 선생님 반으로
 *   옮긴 학생은 퇴원율에 반이동으로 필터링되는거 맞지? 오해 안되게"* — 같은 날 '다른 선생님 반이면 센다'로 바꿨다가 되돌림),
 *   원장이 고르는 것 = 뺄 퇴원 사유(기본 졸업·이사·질병·권고퇴원) · 수강종료(학원의 다른 수업은 계속 다님)를 셀지.
 * - 사유 = 그 수강의 종료 사유 → 없거나 '퇴원에 따른 자동 종료'면 학생의 퇴원 사유(퇴원관리와 같은 곳 · 퇴원일 때만 · 그 퇴원일이
 *   그만둔 날 ±14일 안일 때만 — `exit-reason.ts`).
 * - 수치(raw) = 분자 ÷ 분모 × 100(%). 분모가 0이면 null(자료 없음 규칙).
 * 🔴 미리 등록했다가 취소된 수강(종료일 = 시작일 — 퇴원 처리가 그렇게 닫는다)은 '다닌다'로 보지 않는다(적대적 리뷰 2026-10-13).
 */
import { isSpecialLecture } from "@/features/classes/special-lecture";
import { normalizeReason, REASON_LABEL, type WithdrawalReason } from "@/features/withdrawals/types";
import type { ChurnOptions } from "../evaluation/config";
import { addDays, daysBetween, round1 } from "./dates";
import { AUTO_END_TEXT, SOON_DAYS, endedWithWithdrawal, excusedReasonOf, reasonsOf, stillAttending, studentReasonAt } from "./exit-reason";
import type { ChurnSource } from "./students";
import type { ChurnMetric, ChurnRow, PeriodWindow, PortfolioSnapshot, SnapshotClass, SnapshotEnrollment } from "./types";

/** 자유 글로 남는 구조적 종료(classes/server의 ARCHIVE_REASON · CLOSE_TERM_REASON · PERIOD_END_REASON과 같은 글 — churn.test가 잠근다). */
export const CLASS_END_TEXT: readonly string[] = ["반 폐지", "종강", "운영 기간 종료"];
const TRANSFER_TEXT = "반 이동";

const codeOf = (text: string | null | undefined): WithdrawalReason | null => (text && /^[a-z_]+$/i.test(text) ? normalizeReason(text.toLowerCase()) : null);
const futureCache = new WeakMap<readonly SnapshotEnrollment[], Map<string, SnapshotEnrollment[]>>();
function futureOf(rows: readonly SnapshotEnrollment[]): Map<string, SnapshotEnrollment[]> {
  let map = futureCache.get(rows);
  if (!map) {
    map = new Map();
    for (const e of rows) map.set(e.student_id, [...(map.get(e.student_id) ?? []), e]);
    futureCache.set(rows, map);
  }
  return map;
}
const NO_FUTURE: SnapshotEnrollment[] = [];

export type ChurnInput = {
  source: ChurnSource; classes: ReadonlyMap<string, SnapshotClass>; teacherId: string; w: Pick<PeriodWindow, "start" | "end">; options: ChurnOptions;
} & Pick<PortfolioSnapshot, "futureEnrollments" | "studentReasons">;
/**
 * `metric` = 근거 화면·점수 · `subjects` = 분모 학생을 정규 수업으로 가르친 과목 · `exits` = 퇴원율에 넣은 그만둠(같은 학생 한 번만으로
 * 접힌 줄 포함)의 학생·과목 — 뒤의 둘은 시간표 X 겹침이 같은 계산을 읽는 자리다(`churn-model.ts`). 저장하지 않는다.
 */
export type ChurnResult = {
  metric: Omit<ChurnMetric, "id" | "max" | "value">; subjects: ReadonlySet<string>;
  exits: readonly { studentId: string; subjects: readonly string[] }[];
};

export function buildChurn(input: ChurnInput): Omit<ChurnMetric, "id" | "max" | "value"> {
  return churnResult(input).metric;
}

export function churnResult(input: ChurnInput): ChurnResult {
  const { source, classes, teacherId, w, options } = input;
  const prevEnd = addDays(w.start, -1);
  const prevDays = daysBetween(`${prevEnd.slice(0, 7)}-01`, prevEnd);
  const need = Math.ceil(prevDays.length / 2);
  const subjectOf = (x: SnapshotEnrollment) => classes.get(x.class_id)?.subject;
  const regularOf = new Map<string, boolean>();
  const regular = (id: string) => {
    let v = regularOf.get(id);
    if (v === undefined) {
      const c = classes.get(id);
      regularOf.set(id, (v = Boolean(c) && !isSpecialLecture({ isSpecial: c!.is_special, className: c!.class_name })));
    }
    return v;
  };
  // 학생별 — 지난달 정규 수업으로 맡은 날 수(특강만 듣는 날은 분모에 안 센다 — 끝난 특강은 분자에서 늘 빠진다) ·
  // 이 선생님이 맡은 반과 처음 맡은 날 · 맡은 날 목록(지난달 1일 ~ 이 달 끝, 오름차순).
  const days = new Map<string, number>();
  const firstDay = new Map<string, Map<string, string>>();
  const seen = new Map<string, string[]>();
  const prevSubjects = new Map<string, Set<string>>();
  for (const day of [...prevDays, ...daysBetween(w.start, w.end)]) {
    for (const [studentId, relation] of source.rosterOf(day, teacherId)) {
      const mine = firstDay.get(studentId) ?? firstDay.set(studentId, new Map()).get(studentId)!;
      let anyRegular = false;
      for (const id of relation.classes) {
        if (!mine.has(id)) mine.set(id, day);
        if (regular(id)) {
          anyRegular = true;
          if (day <= prevEnd) (prevSubjects.get(studentId) ?? prevSubjects.set(studentId, new Set()).get(studentId)!).add(classes.get(id)!.subject);
        }
      }
      (seen.get(studentId) ?? seen.set(studentId, []).get(studentId)!).push(day);
      if (day <= prevEnd && anyRegular) days.set(studentId, (days.get(studentId) ?? 0) + 1);
    }
  }
  const base = new Set([...days].filter(([, n]) => n >= need).map(([id]) => id));
  const future = futureOf(input.futureEnrollments ?? NO_FUTURE);
  const studentReason = reasonsOf(input.studentReasons);

  const rows: ChurnRow[] = [];
  const counted = new Set<string>();
  const exits: ChurnResult["exits"][number][] = [];
  for (const studentId of base) {
    const history = [...source.enrollmentsOf(studentId), ...(future.get(studentId) ?? [])];
    // 반 이동했지만 옮겨 간 반을 하루도 안 다녔다(시작 전·당일 퇴원 — 퇴원 처리가 그 수강을 종료일 = 시작일로 닫는다) = 그만둔 것.
    // 옮겨 간 반 = 반 이동으로 들어온 같은 과목 다른 반 중 31일 안에 시작한 것. 돌려주는 값 = 그 수강들(사유를 거기서 읽는다).
    const cancelledMove = (x: SnapshotEnrollment): SnapshotEnrollment[] | null => {
      if (!x.end_date || !(x.is_transferred || x.withdrawal_reason?.trim() === TRANSFER_TEXT)) return null;
      const to = history.filter((b) => b.is_transferred_in && b.class_id !== x.class_id && subjectOf(b) === subjectOf(x)
        && b.start_date >= x.end_date! && b.start_date <= addDays(x.end_date!, SOON_DAYS));
      return to.length > 0 && to.every((b) => b.end_date !== null && b.end_date <= b.start_date) ? to : null;
    };
    const mineDays = seen.get(studentId) ?? [];
    for (const exit of source.exitsOf(studentId, w.start, w.end)) {
      // 이 날 뒤에도 다니는(또는 31일 안에 시작하는) 다른 수강 — 학생 배정·유지의 사유 판정과 한 벌(`stillAttending`).
      const others = stillAttending(history, classes, exit.day, new Set(exit.ended.map((x) => x.id)));
      const keeps = (x: SnapshotEnrollment) => others.some((o) => subjectOf(o) === subjectOf(x));
      // 이 선생님 몫 = 이 선생님이 맡았던 반의 끝 · 또는 이 선생님이 정규 수업으로 가르친 과목을 통째로 끊은 끝(다른 선생님 반으로
      // 옮긴 뒤라도 — 단 이 선생님에게서 끊김 없이 이어진 수강만: 그만두고 한참 뒤 다른 반에 다시 등록했다 끊은 것은 이 선생님 몫이 아니다).
      const taught = new Set([...(firstDay.get(studentId) ?? [])].filter(([, d]) => d < exit.day).map(([id]) => id));
      const subjects = new Set([...taught].filter(regular).map((id) => classes.get(id)?.subject));
      const last = mineDays.findLast((d) => d < exit.day);
      const ended = exit.ended.filter((x) => taught.has(x.class_id)
        || (last !== undefined && x.start_date <= addDays(last, 1) && subjects.has(subjectOf(x)) && !keeps(x)));
      // 같은 과목을 계속 다니는데 이 선생님이 계속 맡거나(반을 옮김·반이 닫혀 다른 반으로) 반 이동으로 옮겨 갔으면 그만둔 게 아니다 — 줄도 안 남긴다.
      const stays = source.rosterOf(exit.day, teacherId).has(studentId);
      if (!ended.length || ended.every((x) => keeps(x) && (stays || (x.is_transferred && !cancelledMove(x))))) continue;
      const type: ChurnRow["type"] = others.length ? "수강종료" : "퇴원";
      const judged = ended.map((x) => {
        const c = classes.get(x.class_id);
        const cancelled = cancelledMove(x);
        // 취소된 반 이동의 사유 = 옮겨 갈 반을 닫은 사유('반 이동' 글은 사유가 아니다).
        const text = (cancelled ? cancelled.map((b) => b.withdrawal_reason?.trim()).find(Boolean) : x.withdrawal_reason?.trim()) || null;
        // 🔴 강사 탓이 아닌 사유(원장이 고른 사유 — 이사·졸업 등)는 퇴원·수강종료 모두 퇴원율에 넣지 않는다 — 수강 종료 사유 · 학생 퇴원
        // 사유(퇴원일 때 · 그 무렵 것만) 중 하나라도(원장 2026-10-14 *"모든 곳에서"* — 학생 배정·유지와 같은 판정 `exit-reason.ts`).
        const s = studentReason.get(studentId);
        const together = (at: string) => endedWithWithdrawal(x, history, classes, at);
        const off = excusedReasonOf({ text, type, student: s, exitDay: exit.day, excludeReasons: options.excludeReasons, together });
        // 사유 칸(라벨)도 같은 조건 — 사유 없이 그만둔 줄에 몇 달 뒤 퇴원 사유를 붙이지 않는다.
        const student = !text || text === AUTO_END_TEXT ? studentReasonAt(type, s, text, exit.day, together) : null;
        const code = off ?? codeOf(text) ?? codeOf(student);
        const reason = code ? REASON_LABEL[code] : text && !codeOf(text) ? text : "사유 없음";
        let note: string | null = null;
        if (!cancelled && (text === TRANSFER_TEXT || x.is_transferred)) note = "반 이동";
        else if ((text && CLASS_END_TEXT.includes(text)) || c?.closed_at === exit.day) note = "수업이 끝남";
        else if (isSpecialLecture({ isSpecial: c?.is_special, className: c?.class_name })) note = "끝난 특강";
        else if (keeps(x)) note = "같은 과목 다른 반을 다님(반 이동처럼 제외)";
        else if (off) note = `사유 ${REASON_LABEL[off]}`;
        return { reason, note };
      });
      const kept = judged.find((j) => !j.note);
      let note = kept ? null : (judged[0]?.note ?? "근거 확인");
      if (!note && type === "수강종료" && !options.countEnded) note = "수강종료는 세지 않음";
      const again = !note && counted.has(studentId);
      if (!note && !again) counted.add(studentId);
      if (!note) exits.push({ studentId, subjects: [...new Set(ended.filter((_, i) => !judged[i]!.note).flatMap((x) => subjectOf(x) ?? []))] });
      rows.push({
        studentId, day: exit.day, type, className: ended.map((x) => classes.get(x.class_id)?.class_name || "").join(", "),
        reason: (kept ?? judged[0])?.reason ?? "사유 없음", counted: !note && !again, note: note ?? (again ? "같은 학생 한 번만" : null),
      });
    }
  }
  rows.sort((a, b) => a.day.localeCompare(b.day));
  const raw = base.size ? round1((100 * counted.size) / base.size) : null;
  const subjects = new Set([...base].flatMap((id) => [...(prevSubjects.get(id) ?? [])]));
  return { subjects, exits, metric: {
    raw, base: base.size, need, counted: counted.size, detail: rows,
    // 지난달 담당 학생이 없다(새로 맡은 선생님) — 퇴원율이 없어도 0점이 아니라 합계에서 제외(원장 2026-11-11 · 급여 비율의 새 선생님과 같다).
    ...(base.size ? {} : { newcomer: true }),
    basis: base.size ? `그만둠 ${counted.size} / 지난달 담당 ${base.size}명` : "지난달 담당 학생 없음",
    reason: `지난달(${Number(prevEnd.slice(5, 7))}월) 이 선생님이 정규 수업으로 ${need}일 이상 맡은 학생(담임·교시 담당 모두) ${base.size}명 중 이 달에 그 선생님 반이나 가르친 과목을 그만둔(퇴원·수강종료) 학생의 비율입니다. 다른 반으로 옮긴 뒤 그 과목을 그만두면 셉니다. 원장이 고른 사유·반 이동·수업이 끝남·끝난 특강·같은 과목의 다른 반을 계속 다니는 경우(어느 선생님 반이든 — 반 이동처럼)는 제외하고, 한 학생은 한 번만 셉니다.`,
  } };
}
