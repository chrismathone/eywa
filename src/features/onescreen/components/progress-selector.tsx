"use client";

/**
 * 진도 선택기 — edutrix 진도선택창 이식. **여러 차시를 한 번에** 고르는 팝오버(다중 체크).
 * - 학년 필터 + 단원/차시 검색 + 이전 진도 표시 + 추천 진도(다음 차시) 칩 + 단원별 체크리스트.
 * - 선택값은 개행 구분자로 join된 하나의 문자열(today) — 저장/파싱 계약은 단일 string 유지(curriculum.ts PROGRESS_DELIM).
 * - 커리큘럼(math) 과목 전용. 비math(영어 등)는 소비처에서 자유 텍스트 입력 유지.
 * - overflow-x-auto(그리드) 안에서도 잘리지 않게 base-ui Popover 포털로 렌더.
 * (edutrix의 '상태 선택'=활동유형 태그는 별도 필드 설계가 필요해 v1 미포함 — 진도 차시 선택에 집중.)
 */
import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { ChevronDown, Plus } from "@/components/icons/eywa-icon-compat";
import {
  CURRICULUM_GRADES,
  curriculumForGrade,
  splitLessons,
  joinLessons,
  displayLessons,
  lastLesson,
  nextLessons,
} from "../curriculum";

/** 차시 코드 접두("2-3-5 ") 제거 — 칩·요약의 짧은 표시용. 중등(코드 없음)은 그대로. */
function shortLesson(l: string): string {
  return l.replace(/^[\d]+(?:-[\d]+)*\s+/, "").trim() || l;
}

export function ProgressSelector({
  value,
  onChange,
  studyGrade,
  onStudyGrade,
  studentGrade,
  prev,
  ariaLabel,
}: {
  value: string; // today(합본, 개행)
  onChange: (joined: string) => void; // 선택 변경 → 합본 문자열
  studyGrade: string; // 진도 학년
  onStudyGrade: (grade: string) => void; // 진도 학년 변경(선행/후행)
  studentGrade: string; // 실제 학년(선행/후행 배지)
  prev?: string; // 이전 진도(합본) — 표시 + 추천 진도 계산
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = splitLessons(value);
  const selectedSet = new Set(selected);
  const units = curriculumForGrade(studyGrade);
  const q = search.trim();
  const filteredUnits = q
    ? units
        .map((u) => ({ unit: u.unit, lessons: u.lessons.filter((l) => l.includes(q) || u.unit.includes(q)) }))
        .filter((u) => u.lessons.length > 0)
    : units;
  // 추천 진도 = 이전 진도 마지막 차시 다음 3개(이미 선택된 건 제외).
  const recos = nextLessons(studyGrade, lastLesson(prev), 3).filter((l) => !selectedSet.has(l));
  const ahead = studyGrade !== studentGrade;

  const toggle = (lesson: string) =>
    onChange(joinLessons(selectedSet.has(lesson) ? selected.filter((l) => l !== lesson) : [...selected, lesson]));
  const add = (lesson: string) => {
    if (!selectedSet.has(lesson)) onChange(joinLessons([...selected, lesson]));
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={`border-line bg-card hover:border-primary/60 data-[popup-open]:border-primary flex h-8 w-full items-center gap-1 rounded-sm border px-2 text-left text-[12px] outline-none transition-colors ${
          selected.length ? "text-foreground" : "text-text-faint"
        }`}
        aria-label={ariaLabel ?? "진도 선택"}
      >
        <span className="min-w-0 flex-1 truncate">
          {selected.length ? displayLessons(value) : "진도 선택…"}
        </span>
        {selected.length > 1 ? (
          <span className="bg-primary-soft text-primary shrink-0 rounded-pill px-1.5 py-px text-[10px] font-bold">
            {selected.length}
          </span>
        ) : null}
        <ChevronDown className="text-text-faint pointer-events-none size-3.5 shrink-0" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
          <Popover.Popup className="bg-card border-line shadow-card flex max-h-[70vh] w-[380px] flex-col overflow-hidden rounded-md border text-[12px] outline-none">
            {/* 학년 필터 */}
            <div className="border-line flex items-center gap-2 border-b px-3 py-2">
              <span className="text-text-faint shrink-0">진도 학년</span>
              <select
                value={studyGrade}
                onChange={(e) => onStudyGrade(e.target.value)}
                className="border-line bg-card focus:border-primary h-7 rounded-sm border px-1.5 text-[12px] outline-none"
                aria-label="진도 학년 선택"
              >
                {CURRICULUM_GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              {ahead ? (
                <span className="bg-amber-soft text-amber rounded-[3px] px-1.5 py-0.5 text-[10px] font-bold">
                  실제 {studentGrade}
                </span>
              ) : null}
            </div>

            {/* 검색 */}
            <div className="border-line border-b px-3 py-2">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="단원·차시 검색"
                className="border-line bg-bg-soft focus:border-primary h-7 w-full rounded-sm border px-2 text-[12px] outline-none"
                aria-label="단원·차시 검색"
              />
            </div>

            {/* 이전 진도 + 추천 진도 */}
            {prev?.trim() ? (
              <div className="border-line bg-bg-soft/40 border-b px-3 py-2">
                <p className="text-text-faint text-[11px]">
                  이전 진도: <span className="text-text-dim">{displayLessons(prev)}</span>
                </p>
                {recos.length ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <span className="text-text-faint text-[10px] self-center">추천</span>
                    {recos.map((l) => (
                      <button
                        key={l}
                        type="button"
                        onClick={() => add(l)}
                        className="border-primary/40 text-primary hover:bg-primary-soft inline-flex items-center gap-0.5 rounded-pill border px-1.5 py-0.5 text-[11px] font-semibold"
                      >
                        <Plus size={10} /> {shortLesson(l)}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* 선택 요약 */}
            {selected.length ? (
              <div className="border-line flex items-center justify-between gap-2 border-b px-3 py-1.5">
                <span className="text-text-dim text-[11px]">
                  선택 <b className="text-primary">{selected.length}</b>차시
                </span>
                <button
                  type="button"
                  onClick={() => onChange("")}
                  className="text-text-faint hover:text-danger text-[11px]"
                >
                  모두 해제
                </button>
              </div>
            ) : null}

            {/* 단원별 체크리스트 */}
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-1 py-1">
              {filteredUnits.length === 0 ? (
                <p className="text-text-faint px-2 py-4 text-center">검색 결과가 없습니다</p>
              ) : (
                filteredUnits.map((u) => (
                  <div key={u.unit} className="mb-1">
                    <p className="text-text-faint bg-bg-soft/60 sticky top-0 px-2 py-1 text-[10.5px] font-semibold">
                      {u.unit}
                    </p>
                    {u.lessons.map((l) => {
                      const on = selectedSet.has(l);
                      return (
                        <label
                          key={l}
                          className={`hover:bg-bg-soft flex cursor-pointer items-start gap-2 rounded-sm px-2 py-1 ${
                            on ? "text-primary font-semibold" : "text-text-dim"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggle(l)}
                            className="accent-primary mt-0.5 size-3.5 shrink-0"
                          />
                          <span className="leading-snug">{l}</span>
                        </label>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
