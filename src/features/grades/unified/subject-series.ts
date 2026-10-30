import { averagePercent, scorePercent, type UnifiedRow } from "./model";
import { distinctSubjectTokens, tokenColor } from "@/features/students/stats/model";
import type { PillColor } from "@/components/atoms/pill";

/**
 * 학생 한 명의 성적을 **과목별 선**으로(원장 2026-10-30 *"이 시험기록이 영어인지, 수학인지 과목표시가 되지 않고 있음 … 영어, 수학 둘 모두
 * 기입되었을때 색상구분해서 볼 수 있도록"*). 학생 상세 '성적' 탭과 통합 성적관리 '학생 추이'가 같은 함수를 쓴다(두 화면이 같은 학생을 같게).
 * 색 = 학원설정 과목 색(같은 색이 겹치면 비켜 준다 — 원생 통계와 같은 `distinctSubjectTokens`). 점수 없는 기록은 선에서 빠진다(평균과 같은 결).
 */
export type SubjectSeriesInput = { labelOf: (key: string) => string; colorOf: (key: string) => PillColor };

export function subjectSeriesOf(rows: readonly UnifiedRow[], subjects: SubjectSeriesInput) {
  const bySubject = new Map<string, UnifiedRow[]>();
  for (const r of rows) bySubject.set(r.subject, [...(bySubject.get(r.subject) ?? []), r]);
  const keys = [...bySubject.keys()].sort((a, b) => (bySubject.get(b)!.length - bySubject.get(a)!.length) || subjects.labelOf(a).localeCompare(subjects.labelOf(b), "ko"));
  const tokens = distinctSubjectTokens(keys.map((key) => ({ key, color: subjects.colorOf(key) })));
  return keys.map((key) => {
    const list = bySubject.get(key)!;
    const months = new Map<string, UnifiedRow[]>();
    for (const r of list) if (scorePercent(r) != null) months.set(r.date.slice(0, 7), [...(months.get(r.date.slice(0, 7)) ?? []), r]);
    return {
      key,
      label: subjects.labelOf(key),
      color: tokenColor(tokens.get(key) ?? subjects.colorOf(key)),
      count: list.length,
      average: averagePercent(list),
      points: [...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, entries]) => ({ month, average: averagePercent(entries) ?? 0 })),
    };
  });
}
