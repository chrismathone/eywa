import type { OccurrenceCause, SourceKind } from "./types";

/**
 * 사건 키는 접수 경로(source_kind)를 넣지 않는다.
 * 일별 수학의 초기 단위는 지점·학생·원반·원수업일이다.
 * 한 번 고정한 키는 시간표가 옮겨져도 다시 만들지 않는다.
 */

export function dayOccurrenceKey(input: {
  tenantId: string;
  studentId: string;
  originalClassId: string;
  originalDate: string;
}): string {
  return `day:${input.tenantId}:${input.studentId}:${input.originalClassId}:${input.originalDate}`;
}

export function additionalOccurrenceKey(eventId: string): string {
  return `additional:${eventId}`;
}

export function sameOccurrence(a: { occurrenceKey: string }, b: { occurrenceKey: string }): boolean {
  return a.occurrenceKey !== "" && a.occurrenceKey === b.occurrenceKey;
}

/** 서로 다른 원수업은 날짜가 같아도 한 케이스로 합치지 않는다. */
export function distinctLessons(keys: readonly string[]): boolean {
  return new Set(keys.filter(Boolean)).size === keys.filter(Boolean).length;
}

export function freezeOccurrence(frozenKey: string | null, proposedKey: string, ambiguous: boolean): {
  key: string | null;
  conflict: boolean;
} {
  if (frozenKey) return { key: frozenKey, conflict: false };
  if (ambiguous || !proposedKey) return { key: null, conflict: true };
  return { key: proposedKey, conflict: false };
}

export function linkAlias(input: {
  occurrenceKey: string;
  sourceKind: SourceKind;
  sourceId: string;
  aliases: readonly { occurrenceKey: string; sourceKind: SourceKind; sourceId: string }[];
}): { linked: boolean; conflict: boolean } {
  const sameSource = input.aliases.find((row) => row.sourceKind === input.sourceKind && row.sourceId === input.sourceId);
  if (sameSource && sameSource.occurrenceKey !== input.occurrenceKey) return { linked: false, conflict: true };
  const sameCase = input.aliases.some((row) => row.occurrenceKey === input.occurrenceKey);
  return { linked: sameCase || input.aliases.length === 0, conflict: false };
}

/** 추가 지도에 결석일을 만들어 넣지 않는다. 원결석이 없으면 originalDate 는 null 이다. */
export function rejectFakeAbsence(input: { cause: OccurrenceCause; originalDate: string | null }): string | null {
  if (input.cause === "additional" && input.originalDate) return "추가 지도에는 결석일을 넣지 않습니다";
  return null;
}

/** 출석으로 정정돼도 케이스를 지우거나 권리를 자동으로 없애지 않는다. */
export function correctionDisposition(): "source_conflict" {
  return "source_conflict";
}

/** 같은 사건의 수동 재접수는 새 키를 만들지 않고 기존 키에 붙인다. */
export function reintakeKey(existingKey: string | null, proposedKey: string): { key: string; created: boolean } {
  if (existingKey) return { key: existingKey, created: false };
  return { key: proposedKey, created: true };
}
