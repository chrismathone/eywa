"use client";

import { useId, useState } from "react";
import {
  candidateMeta,
  filterBulkCandidates,
  toggleVisible,
  type BulkCandidate,
} from "@/features/enrollments/bulk-assign";

/**
 * 단체 배정의 학생 고르기(원장 2026-09-18) — 검색 + 체크 목록. 반 상세 '학생 배정' 창에서만 쓴다
 * (학생 상세에서 반을 고르는 쪽은 한 반씩 그대로 — 원장 같은 날 *"원생에서 수업 배정할때는 단체배정 기능 필요없고"*).
 * 검색은 이름·학교·학년을 함께 본다(`filterBulkCandidates`) — "고1"로 좁히고 '모두 선택'이 특강의 주 흐름이다.
 */
export function EnrollmentBulkPicker({
  options,
  selected,
  onChange,
  disabled,
  blocked = {},
  descriptions = {},
  listLabel = "배정할 학생 목록",
  emptyLabel = "배정할 수 있는 학생이 없습니다",
}: {
  options: BulkCandidate[];
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  blocked?: Record<string, string | null>;
  descriptions?: Record<string, string>;
  listLabel?: string;
  emptyLabel?: string;
}) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const visible = filterBulkCandidates(options, query);
  const visibleIds = visible.filter((c) => !blocked[c.id]).map((c) => c.id);
  const chosen = new Set(selected);
  const allVisibleOn = visibleIds.length > 0 && visibleIds.every((id) => chosen.has(id));
  const toggle = (id: string) =>
    onChange(chosen.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={searchId} className="text-foreground block text-sm font-medium">
          학생 선택
        </label>
        <span className="text-muted-foreground num text-xs" aria-live="polite">
          {selected.length}명 선택
        </span>
      </div>
      <input
        id={searchId}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="이름·학교·학년 검색 (예: 고1)"
        disabled={disabled}
        className="border-border bg-card text-foreground w-full rounded-lg border px-2 py-1.5 text-sm"
      />
      <div className="flex items-center justify-between gap-2 text-xs">
        <button
          type="button"
          onClick={() => onChange(toggleVisible(selected, visibleIds))}
          disabled={disabled || visibleIds.length === 0}
          className="text-primary font-medium hover:underline disabled:opacity-40 disabled:no-underline"
        >
          {allVisibleOn ? `보이는 ${visibleIds.length}명 선택 해제` : `보이는 ${visibleIds.length}명 모두 선택`}
        </button>
        {selected.length > 0 ? (
          <button
            type="button"
            onClick={() => onChange([])}
            disabled={disabled}
            className="text-muted-foreground hover:text-foreground"
          >
            선택 모두 해제
          </button>
        ) : null}
      </div>
      <ul className="border-border max-h-64 overflow-y-auto rounded-lg border" aria-label={listLabel}>
        {visible.length === 0 ? (
          <li className="text-muted-foreground px-3 py-4 text-center text-sm">
            {options.length === 0 ? emptyLabel : "검색 결과가 없습니다"}
          </li>
        ) : (
          visible.map((c) => {
            const meta = candidateMeta(c);
            return (
              <li key={c.id} className="border-border border-b last:border-b-0">
                <label className="hover:bg-muted flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={chosen.has(c.id)}
                    onChange={() => toggle(c.id)}
                    disabled={disabled || (!!blocked[c.id] && !chosen.has(c.id))}
                    className="accent-primary size-4 shrink-0"
                  />
                  <span className="text-foreground shrink-0 font-medium">{c.name}</span>
                  <span className="text-muted-foreground min-w-0 text-xs">
                    {meta}
                    {descriptions[c.id] ? <span className="block">{descriptions[c.id]}</span> : null}
                    {blocked[c.id] ? <span className="text-danger block">{blocked[c.id]}</span> : null}
                  </span>
                </label>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

/** 단체 배정에서 막힌 학생과 이유 — 조용히 빠뜨리지 않는다(들어간 수도 함께). */
export function BulkAssignFailures({
  failures,
  doneCount,
}: {
  failures: { studentId: string; name: string; error: string }[];
  doneCount: number;
}) {
  if (failures.length === 0) return null;
  return (
    <div className="border-chart-4/40 bg-chart-4/5 rounded-lg border px-3 py-2 text-xs" role="alert">
      <p className="text-foreground font-bold">
        {doneCount > 0 ? `${doneCount}명은 배정했습니다. ` : ""}
        {failures.length}명은 배정하지 못했습니다
      </p>
      <ul className="text-foreground mt-1 max-h-32 space-y-0.5 overflow-y-auto">
        {failures.map((f) => (
          <li key={f.studentId}>
            <span className="font-medium">{f.name}</span> — {f.error}
          </li>
        ))}
      </ul>
    </div>
  );
}
