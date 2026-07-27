"use client";

/**
 * 진도 선택기 — edutrix 진도선택창 이식. **여러 차시를 한 번에** 고르는 팝오버(다중 체크).
 * - 학년 필터 + 단원/차시 검색 + 이전 진도 표시 + 단원별 체크리스트.
 * - 선택값은 개행 구분자로 join된 하나의 문자열(today) — 저장/파싱 계약은 단일 string 유지(curriculum.ts PROGRESS_DELIM).
 * - 커리큘럼(math) 과목 전용. 비math(영어 등)는 소비처에서 자유 텍스트 입력 유지.
 * - overflow-x-auto(그리드) 안에서도 잘리지 않게 base-ui Popover 포털로 렌더.
 * (edutrix의 '상태 선택'=활동유형 태그는 별도 필드 설계가 필요해 v1 미포함 — 진도 차시 선택에 집중.)
 */
import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { ChevronDown } from "@/components/icons/eywa-icon-compat";
import {
  CURRICULUM_GRADES,
  curriculumForGrade,
  splitLessons,
  joinLessons,
  displayLessons,
} from "../curriculum";

export function ProgressSelector({
  value,
  onChange,
  studyGrade,
  onStudyGrade,
  studentGrade,
  prev,
  ariaLabel,
  locked,
}: {
  value: string; // today(합본, 개행)
  onChange: (joined: string) => void; // 선택 변경 → 합본 문자열
  studyGrade: string; // 진도 학년
  onStudyGrade: (grade: string) => void; // 진도 학년 변경(선행/후행)
  studentGrade: string; // 실제 학년(선행/후행 배지)
  prev?: string; // 이전 진도(합본) — 참고 표시용
  ariaLabel?: string;
  /** 발송 완료된 보고서 — 수정 금지(0134a/2026-07-22 원장 지시). 선택 UI를 열지 않는다. */
  locked?: boolean;
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
  const ahead = studyGrade !== studentGrade;

  const toggle = (lesson: string) =>
    onChange(joinLessons(selectedSet.has(lesson) ? selected.filter((l) => l !== lesson) : [...selected, lesson]));

  // 발송 완료된 보고서는 **수정 금지**(2026-07-22 원장 지시) — 학부모가 받은 이미지와 기록이 갈라지면
  // 나중에 어느 쪽이 사실인지 아무도 모른다. 팝오버를 아예 열지 않고 값만 읽기 전용으로 보여준다.
  if (locked) {
    return (
      <div
        className="border-line bg-bg-soft text-text-dim flex h-8 w-full min-w-0 flex-1 items-center gap-1 rounded-lg border px-2 text-left text-[12px]"
        aria-label={ariaLabel ?? "진도"}
        aria-readonly="true"
      >
        <span className="min-w-0 flex-1 truncate">
          {selected.length ? displayLessons(value) : "—"}
        </span>
      </div>
    );
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      {/* ⚠️ `min-w-0 flex-1` 필수 — flex 행(라벨 '오늘 →' + 이 트리거) 안에서 `w-full`만 주면 트리거가
          **행 전체 너비**를 요구해 라벨 폭만큼 카드 밖으로 삐져나온다(2026-07-27 실측 23px 오버플로,
          `scrollWidth 417 > clientWidth 394`). 옆 자유입력 <input>은 처음부터 `w-full min-w-0 flex-1`이라
          멀쩡했다 — 같은 규약으로 맞춘다. 표 뷰(블록 컨텍스트)에선 flex-1이 무시돼 기존 동작 그대로. */}
      <Popover.Trigger
        className={`border-line bg-card hover:border-primary/60 data-[popup-open]:border-primary flex h-8 w-full min-w-0 flex-1 items-center gap-1 rounded-lg border px-2 text-left text-[12px] outline-none transition-colors ${
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
          <Popover.Popup className="bg-card border-line shadow-card flex max-h-[70vh] w-[380px] flex-col overflow-hidden rounded-lg border text-[12px] outline-none">
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
                <span className="bg-amber-soft text-amber rounded-pill px-1.5 py-0.5 text-[10px] font-bold">
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

            {/* 이전 진도 — 참고 표시만. 추천 진도 칩은 2026-07-22 원장 지시로 폐지(재도입 금지):
                커리큘럼 순서상 '다음 차시'일 뿐 그 반이 실제로 나갈 진도가 아니라, 맞을 때보다 틀릴 때가
                많았고 한 번 누르면 잘못된 진도가 그대로 저장된다. 진도는 강사가 고르는 게 맞다. */}
            {prev?.trim() ? (
              <div className="border-line bg-bg-soft/40 border-b px-3 py-2">
                <p className="text-text-faint text-[11px]">
                  이전 진도: <span className="text-text-dim">{displayLessons(prev)}</span>
                </p>
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
                    <p className="text-text-faint bg-bg-soft/60 sticky top-0 px-2 py-1 text-[10.5px] font-bold">
                      {u.unit}
                    </p>
                    {u.lessons.map((l) => {
                      const on = selectedSet.has(l);
                      return (
                        <label
                          key={l}
                          className={`hover:bg-bg-soft flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 ${
                            on ? "text-primary font-bold" : "text-text-dim"
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
