/**
 * 원장 구성의 지표 셋 — 성적 관리 · 학부모 만족도 · 강사 근태(2026-10-15 원장 *"계산 안된거 다음 단계라고 적힌거 다 해결해"*).
 * 스냅샷의 `sources`에서 강사 × 달 항목을 만든다(순수 함수). 수치(`raw`)만 내고 점수는 설정이 매긴다(`evaluate.ts`).
 * 재료가 없으면(옛 스냅샷 · 판정 표 적용 전) 그 지표는 '계산 전' 자리(`pending.ts`).
 */
import {
  DEFAULT_GRADES_OPTIONS, DEFAULT_PUNCTUALITY_OPTIONS, DEFAULT_SATISFACTION_OPTIONS, PUNCTUALITY_OVERRIDE_KEY, type EvaluationConfig,
} from "../evaluation/config";
import { buildRecordOwners } from "./attribution";
import type { PortfolioContext } from "./context";
import type { ManualEntry } from "./evaluate";
import { GRADES_REASON, buildGrades, type GradeTarget } from "./grades";
import { uncountedItem } from "./pending";
import { punctualityOf } from "./punctuality";
import { buildPunctualityBasis } from "./punctuality-basis";
import { buildSatisfaction } from "./satisfaction";
import type { ChurnSource } from "./students";
import { METRIC_MAX, type GradesMetric, type PeriodWindow, type PortfolioSnapshot, type PunctualityMetric, type SatisfactionMetric, type SnapshotClass } from "./types";

const SATISFACTION_REASON = "그 달 학부모 글·댓글 판정과 원장이 넣은 클레임·칭찬의 가감 합입니다. 결석·지각 연락으로 분류된 글은 판정하지 않습니다. 확실한 문구는 바로 반영하고, 애매한 글은 확인한 뒤 반영합니다(확인 대기는 점수에 들지 않습니다). 글은 그 반 보드 또는 그 과목으로 그날 다니던 반의 담임에게 갑니다.";
const PUNCTUALITY_REASON = "그 달 지각·결근·조퇴 횟수입니다(메이크에듀 출퇴근 기록). 기준은 그날 맡은 첫 수업 시작(설정한 분만큼 앞당김)과 마지막 수업 끝이고, 출퇴근 시각이 따로 정해진 직원은 그 시각입니다. 기준보다 늦게 출근을 찍으면 지각, 일찍 퇴근을 찍으면 조퇴, 기준이 있는 날 출근 기록이 없으면 결근입니다 — 그날 직접 쓴 출결·보고서가 있으면 출근으로 보고, 그 시각이 출근 태그보다 이르면 그때 온 것으로 봅니다. 설정한 분 이내의 차이는 세지 않습니다. 결재된 휴가(연차·반차·반반차)가 걸친 날과 휴원일은 뺍니다. 원장이 넣은 횟수가 있으면 그 값이 이깁니다.";

export function buildSourceItems(d: PortfolioSnapshot, input: {
  classes: ReadonlyMap<string, SnapshotClass>; owner: (c: SnapshotClass, day: string) => string | null; holidays: ReadonlySet<string>;
  config: EvaluationConfig; entriesOf: (teacherId: string, month: string) => ReadonlyMap<string, ManualEntry>; classNameOf: (id: string) => string;
  classDays: PortfolioContext["classDays"];
  /** 그날 강사별 명단(원생상담·퇴원율과 같은 명단) — 월말평가 응시율의 대상. */
  rosterOf: ChurnSource["rosterOf"];
}) {
  const src = d.sources;
  const ownersOf = buildRecordOwners({ enrollments: d.enrollments, classes: input.classes, owner: input.owner });
  const grades = src ? buildGrades({ grades: src.grades, ownersOf, classes: input.classes, rosterOf: input.rosterOf }) : null;
  const satisfaction = src ? buildSatisfaction({ source: src.satisfaction, ownersOf }) : null;
  const m = input.config.metrics;
  // 앱에 기록을 시작하기 전에 끝난 달(침산 2026-07-01 전)의 보고서 시험은 옛 프로그램에서 나중에 옮겨 온 기록이라 입력일이 그 달보다 늦다 —
  // 그 달은 입력일로 거르지 않는다(보고서·출결의 '기록 시작 전' 기준일과 같은 값). 그 뒤 달은 마감 규칙대로 그 달 말일까지 입력된 시험만.
  const recordStart = d.preRecord?.report?.before ?? null;
  const punctuality = m.punctuality.punctuality ?? DEFAULT_PUNCTUALITY_OPTIONS;
  const basis = src ? buildPunctualityBasis(d, { classDays: input.classDays }, punctuality) : null;

  /** `targets` = 그 달 이 강사의 보고서 대상 칸(`duties.ts` `reportTargets` — 작성률과 같은 칸) — 일일테스트 제출률의 분모. */
  return function items(teacherId: string, w: PeriodWindow, cutoff: string, targets: readonly GradeTarget[] = []): [GradesMetric, SatisfactionMetric, PunctualityMetric] {
    const g = grades?.(teacherId, w, recordStart && w.end < recordStart ? "9999-12-31" : cutoff, m.grades.grades ?? DEFAULT_GRADES_OPTIONS, input.classNameOf, targets);
    const kind = (k: string) => g?.kinds.find((x) => x.kind === k);
    const daily = kind("daily"), monthly = kind("monthly");
    const gradeParts = g ? [
      daily ? `일일테스트 제출 ${daily.done ?? 0}/${daily.count}칸` : "", monthly ? `월말평가 응시 ${monthly.done ?? 0}/${monthly.count}명` : "",
      g.tests ? `시험 ${g.tests}건` : "",
    ].filter(Boolean) : [];
    const s = satisfaction?.(teacherId, w, m.satisfaction.satisfaction ?? DEFAULT_SATISFACTION_OPTIONS, input.classNameOf);
    const manual = input.entriesOf(teacherId, w.month).get(PUNCTUALITY_OVERRIDE_KEY)?.value ?? null;
    const p = src && basis ? punctualityOf({
      days: src.punctuality.days ?? [], leaves: src.punctuality.leaves, holidays: input.holidays, teacherId, w, options: punctuality, manual,
      basisOn: (day) => basis.basisOn(teacherId, day), evidenceOn: (day, b) => basis.evidenceOn(teacherId, day, b), latest: src.punctuality.latest ?? null,
    }) : null;
    return [
      g ? {
        id: "grades", max: METRIC_MAX.grades, value: null, raw: g.raw, reason: GRADES_REASON, detail: g.detail, tests: g.tests, students: g.students, kinds: g.kinds,
        basis: g.raw !== null ? `${gradeParts.join(" · ")} · 종합 ${g.raw}%` : "이 달 일일테스트·월말평가 대상과 시험 기록 없음",
      } : uncountedItem("grades"),
      s ? {
        id: "satisfaction", max: METRIC_MAX.satisfaction, value: null, raw: s.raw, reason: SATISFACTION_REASON, detail: s.detail,
        plus: s.plus, minus: s.minus, claims: s.claims, waiting: s.waiting,
        // 확인 대기는 항목 이름 옆 칩이 말한다(원장 2026-10-16 *"확인대기는 눈에 띄도록 라벨화"*) — 여기 다시 적지 않는다.
        basis: `가점 글 ${s.plus} · 감점 글 ${s.minus} · 클레임·칭찬 ${s.claims}건`,
      } : uncountedItem("satisfaction"),
      p ? {
        id: "punctuality", max: METRIC_MAX.punctuality, value: null, raw: p.raw, reason: PUNCTUALITY_REASON, detail: p.detail,
        late: p.late, absent: p.absent, early: p.early, excused: p.excused, days: p.days, checkIns: p.checkIns, checkOuts: p.checkOuts, manual: p.manual,
        basis: p.manual ? `원장 입력 ${p.raw}회` : p.days ? `지각 ${p.late} · 결근 ${p.absent} · 조퇴 ${p.early}회${p.excused ? ` · 결재된 휴가 ${p.excused}일 제외` : ""}`
          : "이 달 출퇴근 기록 없음",
      } : uncountedItem("punctuality"),
    ];
  };
}
