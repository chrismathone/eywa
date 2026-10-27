"use client";

import { Toolbar, ToolbarChip, ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { DEFAULT_HOMEROOM_FILTER, isDefaultHomeroomFilter, type HomeroomFilter } from "@/features/consultations/homeroom-sort";
import type { HomeroomTeacher } from "@/features/consultations/homeroom-model";

/**
 * 담임별 상담 현황 **골라 보기** 줄(homeroom-sort.ts `HomeroomFilter`) — 과목 · 담임(여러 명) · 미상담만.
 * 선택지는 지금 현황에 실제로 있는 과목·담임에서 만든다(학원설정 라벨 — 하드코딩 금지). 바꾸는 순간 부모가 계정에 저장한다.
 */
export function HomeroomFilters({
  teachers,
  filter,
  onChange,
}: {
  teachers: readonly HomeroomTeacher[];
  filter: HomeroomFilter;
  onChange: (f: HomeroomFilter) => void;
}) {
  const subjects = useSubjectMaps();
  const subjectKeys = [...new Set(teachers.flatMap((t) => t.subjects))].sort((a, b) => subjects.labelOf(a).localeCompare(subjects.labelOf(b), "ko"));
  const set = (patch: Partial<HomeroomFilter>) => onChange({ ...filter, ...patch });
  // 과목을 바꾸면 그 과목 담임이 아닌 '고른 담임'은 내려놓는다 — 안 보이는 선택이 남아 결과가 0명이 되지 않게.
  const setSubject = (subject: string | null) =>
    set({ subject, teachers: subject ? filter.teachers.filter((id) => teachers.some((t) => t.id === id && t.subjects.includes(subject))) : filter.teachers });
  const togglePick = (id: string) =>
    set({ teachers: filter.teachers.includes(id) ? filter.teachers.filter((x) => x !== id) : [...filter.teachers, id] });
  // 과목을 고르면 담임 선택지도 그 과목 담임으로 좁힌다(고를 수 없는 이름이 늘어서 있지 않게).
  const pickable = filter.subject ? teachers.filter((t) => t.subjects.includes(filter.subject!)) : teachers;
  return (
    <Toolbar rail={false} gap="gap-2">
      {subjectKeys.length > 1 ? (
        <ToolbarSegment label="과목" wrap>
          <ToolbarSegmentItem active={!filter.subject} onClick={() => setSubject(null)}>
            전체
          </ToolbarSegmentItem>
          {subjectKeys.map((k) => (
            <ToolbarSegmentItem key={k} active={filter.subject === k} onClick={() => setSubject(filter.subject === k ? null : k)}>
              {subjects.labelOf(k)}
            </ToolbarSegmentItem>
          ))}
        </ToolbarSegment>
      ) : null}
      {teachers.length > 1 ? (
        <ToolbarSegment label="담임" wrap title="여러 명을 골라 그 담임만 볼 수 있습니다">
          <ToolbarSegmentItem active={filter.teachers.length === 0} onClick={() => set({ teachers: [] })}>
            전체
          </ToolbarSegmentItem>
          {pickable.map((t) => (
            <ToolbarSegmentItem key={t.id} active={filter.teachers.includes(t.id)} onClick={() => togglePick(t.id)}>
              {t.name}
            </ToolbarSegmentItem>
          ))}
        </ToolbarSegment>
      ) : null}
      {teachers.length > 1 ? (
        <ToolbarChip active={filter.unmetOnly} onClick={() => set({ unmetOnly: !filter.unmetOnly })}>
          이번 달 미상담 있는 담임만
        </ToolbarChip>
      ) : null}
      <ToolbarChip active={filter.unmetStudentsOnly} onClick={() => set({ unmetStudentsOnly: !filter.unmetStudentsOnly })}>
        펼친 표에서 미상담 학생만
      </ToolbarChip>
      {!isDefaultHomeroomFilter(filter) ? (
        <button type="button" onClick={() => onChange(DEFAULT_HOMEROOM_FILTER)} className="text-primary text-xs font-medium hover:underline">
          모두 보기
        </button>
      ) : null}
    </Toolbar>
  );
}
