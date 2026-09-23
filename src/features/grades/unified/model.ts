import { schoolGradeLabel as formatSchoolGradeLabel } from "@/lib/format/school-grade";

export type UnifiedKind = "daily" | "check" | "admission" | "school" | "monthly" | "other";
export type UnifiedSource = "grade" | "report" | "level";

export type UnifiedClass = { id: string; name: string; teacher: string | null; days: number };

/** 한 시험 결과는 학생당 한 행이다. 두 반 수강은 `classes` 안에서만 표현한다. */
export type UnifiedRecord = {
  key: string;
  source: UnifiedSource;
  sourceId: string;
  studentId: string;
  name: string;
  school: string | null;
  grade: string | null;
  subject: string;
  kind: UnifiedKind;
  date: string;
  score: number | null;
  maxScore: number | null;
  rawScore: string | null;
  classes: UnifiedClass[];
  /** 반별 추이는 평가 당시 수강 반을 기준으로 계산한다. */
  trendClasses?: UnifiedClass[];
  /** 상담 탭의 학습·성적 상담 날짜. 기존 시험 체크 날짜는 백업으로 사용한다. */
  consultationDate: string | null;
  manualConsultationDate: string | null;
  editHref: string;
  /** 학교 성적 저장에 필요한 기존 선택 축. 다른 출처에는 없다. */
  slot?: string;
  schoolYear?: number;
  term?: number;
};

export type UnifiedRow = UnifiedRecord & {
  previousScore: number | null;
  previousMaxScore: number | null;
  delta: number | null;
  deltaUnit: "점" | "%p";
};

export const KIND_LABEL: Record<UnifiedKind, string> = {
  daily: "일일테스트",
  check: "확인테스트",
  admission: "입학테스트",
  school: "내신",
  monthly: "월말평가",
  other: "기타 시험",
};

export function schoolGradeLabel(school: string | null, grade: string | null): string {
  return formatSchoolGradeLabel(school, grade) || "학교학년 미입력";
}

export function scorePercent(record: Pick<UnifiedRecord, "score" | "maxScore">): number | null {
  if (record.score == null || record.maxScore == null || record.maxScore <= 0) return null;
  return (record.score / record.maxScore) * 100;
}

/** 동일 학생·과목·시험 종류의 직전 유효 점수만 비교한다. 만점이 다르면 백분율 포인트다. */
export function withPreviousScores(records: readonly UnifiedRecord[]): UnifiedRow[] {
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  const previous = new Map<string, UnifiedRecord>();
  const rows = sorted.map((record) => {
    const key = `${record.studentId}|${record.subject}|${record.kind}`;
    const earlier = previous.get(key);
    const currentPct = scorePercent(record);
    const earlierPct = earlier ? scorePercent(earlier) : null;
    const sameMax = earlier?.maxScore != null && earlier.maxScore === record.maxScore;
    const delta = currentPct == null || earlierPct == null ? null : sameMax
      ? Math.round(((record.score ?? 0) - (earlier?.score ?? 0)) * 10) / 10
      : Math.round((currentPct - earlierPct) * 10) / 10;
    if (currentPct != null) previous.set(key, record);
    return {
      ...record,
      previousScore: earlier?.score ?? null,
      previousMaxScore: earlier?.maxScore ?? null,
      delta,
      deltaUnit: sameMax ? "점" as const : "%p" as const,
    };
  });
  return rows.reverse();
}

export function averagePercent(records: readonly Pick<UnifiedRecord, "score" | "maxScore">[]): number | null {
  const values = records.map(scorePercent).filter((value): value is number => value != null);
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10;
}

export type Aggregate = { key: string; label: string; count: number; average: number | null; points: { month: string; average: number }[] };

/** 학생이 두 반이면 반별 평균에는 둘 다 포함하지만, 학원 평균에는 기록을 한 번만 센다. */
export function aggregateBy(records: readonly UnifiedRow[], axis: "class" | "grade" | "school" | "academy"): Aggregate[] {
  const groups = new Map<string, { label: string; records: UnifiedRow[] }>();
  for (const record of records) {
    if (scorePercent(record) == null) continue;
    const keys = axis === "class"
      ? (record.trendClasses ?? record.classes).map((cls) => [cls.id, cls.name] as const)
      : axis === "grade" ? [[record.grade ?? "미입력", record.grade ?? "미입력"] as const]
      : axis === "school" ? [[record.school ?? "미입력", record.school ?? "미입력"] as const]
      : [["academy", "학원 전체"] as const];
    for (const [key, label] of keys) {
      const group = groups.get(key) ?? { label, records: [] };
      group.records.push(record);
      groups.set(key, group);
    }
  }
  return [...groups].map(([key, group]) => {
    const months = new Map<string, UnifiedRow[]>();
    for (const record of group.records) {
      const month = record.date.slice(0, 7);
      months.set(month, [...(months.get(month) ?? []), record]);
    }
    return {
      key,
      label: group.label,
      count: group.records.length,
      average: averagePercent(group.records),
      points: [...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, entries]) => ({ month, average: averagePercent(entries) ?? 0 })),
    };
  }).sort((a, b) => (b.average ?? -1) - (a.average ?? -1) || a.label.localeCompare(b.label, "ko"));
}

export function classOrder(classes: readonly UnifiedClass[]): UnifiedClass[] {
  return [...classes].sort((a, b) => b.days - a.days || a.name.localeCompare(b.name, "ko"));
}
