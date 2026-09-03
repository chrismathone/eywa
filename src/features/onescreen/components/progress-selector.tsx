"use client";

/**
 * 진도 선택기 — edutrix 진도선택창 이식. **여러 차시를 한 번에** 고르는 팝오버(다중 체크).
 * - 학년 필터 + 단원/차시 검색 + 이전 진도 표시 + 단원별 체크리스트.
 * - 선택값은 개행 구분자로 join된 하나의 문자열(today) — 저장/파싱 계약은 단일 string 유지(curriculum.ts PROGRESS_DELIM).
 * - 커리큘럼(math) 과목 전용. 비math(영어 등)는 소비처에서 자유 텍스트 입력 유지.
 * - overflow-x-auto(그리드) 안에서도 잘리지 않게 base-ui Popover 포털로 렌더.
 * - **'진도 없이 제출'**(edutrix `SKIP_CHAPTER_STATUSES` 이식) = 시험처럼 진도가 중단되는 날의 특수 상태.
 *   차시와 상호배타라 고르면 아래 차시 선택을 통째로 잠근다(규약·목록 = progress-status.ts).
 * (edutrix '상태 선택'의 나머지 6개 = 진도와 **병행**하는 별개 축이라 미포함 — progress-status.ts 🔴 참조.)
 */
import { useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { ChevronDown } from "@/components/icons/eywa-icon-compat";
import {
  CURRICULUM_GRADES,
  curriculumForGrade,
  flatLessons,
  splitLessons,
  joinLessons,
  displayLessons,
} from "../curriculum";
import { SKIP_PROGRESS_STATUSES, skipStatusOf } from "../progress-status";
import { asProgressMode } from "../progress-mode";
import { ProgressModePills } from "./progress-mode-pills";

export function ProgressSelector({
  value,
  onChange,
  mode,
  onMode,
  studyGrade,
  onStudyGrade,
  studentGrade,
  prev,
  ariaLabel,
  locked,
}: {
  value: string; // today(합본, 개행)
  onChange: (joined: string) => void; // 선택 변경 → 합본 문자열
  /** 오늘 수업 성격(복습·문제풀이) — 차시와 **함께** 사는 별개 축(progress-mode.ts). 미지정이면 알약을 안 그린다. */
  mode?: string | null;
  onMode?: (mode: string | null) => void;
  studyGrade: string; // 진도 학년
  onStudyGrade: (grade: string) => void; // 진도 학년 변경(선행/후행)
  studentGrade: string; // 실제 학년(선행/후행 배지)
  prev?: string; // 이전 진도(합본) — 참고 표시용
  ariaLabel?: string;
  /** 발송 완료·결석 — 수정 금지(isRowInputEditable). 선택 UI를 열지 않는다. */
  locked?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  /** 특수 상태를 고르기 직전의 차시 선택 — 해제하면 되살린다(실수로 눌렀다고 고른 차시가 날아가면 다시 고르게 된다). */
  const [beforeSkip, setBeforeSkip] = useState("");
  /** 펼쳐 둔 대단원(기본 접힘). 검색 중에는 이 상태와 무관하게 전부 펼친다. */
  const [openUnits, setOpenUnits] = useState<Set<string>>(new Set());

  // 진도가 중단된 날(progress-status.ts 규약) — 진도 문자열에 라벨 **단독**으로 들어가므로 차시 선택과
  // 상호배타다. 고르면 아래 선택 UI를 통째로 잠근다.
  const skip = skipStatusOf(value);
  const selected = skip ? [] : splitLessons(value);
  const selectedSet = new Set(selected);
  const units = curriculumForGrade(studyGrade);
  const activeMode = asProgressMode(mode);
  /**
   * **다른 학년에서 고른 차시** — 학년 드롭다운을 바꿔도 선택은 지우지 않으므로(원장 2026-08-07:
   * *"내신대비 기간이라 한시간은 선행, 한시간은 현행"*) 지금 목록엔 없는 선택이 생긴다.
   * 그걸 조용히 숨기면 "고른 게 사라졌다"가 되므로 아래 메타 밴드에 건수와 해제 버튼을 남긴다.
   */
  const gradeLessons = new Set(flatLessons(studyGrade));
  const otherGrade = selected.filter((l) => !gradeLessons.has(l));
  const q = search.trim();
  const filteredUnits = q
    ? units
        .map((u) => ({ unit: u.unit, lessons: u.lessons.filter((l) => l.includes(q) || u.unit.includes(q)) }))
        .filter((u) => u.lessons.length > 0)
    : units;
  const ahead = studyGrade !== studentGrade;

  const toggle = (lesson: string) =>
    onChange(joinLessons(selectedSet.has(lesson) ? selected.filter((l) => l !== lesson) : [...selected, lesson]));

  /**
   * **드래그로 주르륵 선택**(원장 2026-08-07: *"지금은 일일이 클릭해야되네"*).
   * 첫 칸을 누른 순간의 상태로 방향을 정하고(꺼져 있었으면 켜기, 켜져 있었으면 끄기) 지나가는 칸에
   * 같은 방향을 적용한다 — 스프레드시트의 그것과 같은 동작.
   *
   * ⚠️ 작업본을 **ref에 들고 다닌다**: `value`는 부모가 되돌려주는 값이라 한 번의 드래그 안에서 여러 번
   *    onChange가 나가는 동안 최신 선택을 props로 다시 못 받는다(스냅샷으로 계산하면 마지막 칸만 남는다).
   * ⚠️ 지나간 칸은 `touched`로 기억한다 — 손이 흔들려 같은 칸에 다시 들어오면 방금 한 일이 뒤집힌다.
   * ⚠️ 시작 칸도 **pointerdown에서 즉시** 토글한다. click에 맡기면, 드래그가 다른 칸에서 끝났을 때
   *    click은 두 칸의 공통 조상에서 발생해 **시작 칸엔 영영 안 온다**(눌렀는데 안 켜진 것처럼 보인다).
   *    그래서 행은 label+input(클릭→onChange)이 아니라 role="checkbox"로 그린다 — 그래야 pointerdown과
   *    click이 같은 칸을 두 번 토글하지 않는다(키보드는 아래 onKeyDown이 담당).
   */
  const drag = useRef<{ add: boolean; sel: string[]; touched: Set<string> } | null>(null);

  const applyDrag = (lesson: string) => {
    const d = drag.current;
    if (!d || d.touched.has(lesson)) return;
    d.touched.add(lesson);
    const has = d.sel.includes(lesson);
    if (d.add === has) return; // 이미 원하는 상태 — 건드리지 않는다
    d.sel = d.add ? [...d.sel, lesson] : d.sel.filter((l) => l !== lesson);
    onChange(joinLessons(d.sel));
  };

  const startDrag = (lesson: string) => {
    drag.current = { add: !selectedSet.has(lesson), sel: [...selected], touched: new Set() };
    applyDrag(lesson);
    // 팝오버 밖에서 손을 떼도 드래그가 끝나야 한다(once라 해제도 자동).
    if (typeof window !== "undefined")
      window.addEventListener("pointerup", () => {
        drag.current = null;
      }, { once: true });
  };

  const toggleUnit = (unit: string) =>
    setOpenUnits((prev) => {
      const next = new Set(prev);
      if (!next.delete(unit)) next.add(unit);
      return next;
    });

  /**
   * 팝오버를 열 때 **이미 고른 차시가 있는 단원만** 펼쳐 둔다 — 접힘이 기본이라 그냥 두면 강사가
   * "내가 뭘 골랐지"를 보려고 단원을 하나씩 눌러야 한다. 열 때마다 계산해 현재 값과 어긋나지 않는다.
   */
  const handleOpenChange = (o: boolean) => {
    setOpen(o);
    if (!o) return;
    const chosen = new Set(splitLessons(value));
    setOpenUnits(
      new Set(curriculumForGrade(studyGrade).filter((u) => u.lessons.some((l) => chosen.has(l))).map((u) => u.unit)),
    );
  };

  /** 특수 상태 알약 — 같은 것을 다시 누르면 해제(차시 복원), 다른 것을 누르면 교체(둘을 동시에 못 고른다). */
  const pickSkip = (status: string) => {
    if (skip === status) {
      onChange(beforeSkip); // 해제 — 고르기 전 차시 복원(없었으면 빈 값)
      return;
    }
    if (!skip) setBeforeSkip(value); // 차시 → 상태로 넘어가는 순간에만 기억(상태 간 교체는 덮어쓰지 않음)
    onChange(status);
  };

  // 발송 완료된 보고서는 **수정 금지**(2026-07-22 원장 지시) — 학부모가 받은 이미지와 기록이 갈라지면
  // 나중에 어느 쪽이 사실인지 아무도 모른다. 팝오버를 아예 열지 않고 값만 읽기 전용으로 보여준다.
  if (locked) {
    return (
      <div
        className="border-line bg-bg-soft text-text-dim flex h-8 w-full min-w-0 flex-1 items-center gap-1 rounded-lg border px-2 text-left text-xs"
        aria-label={ariaLabel ?? "진도"}
        aria-readonly="true"
      >
        {activeMode && !skip ? (
          <span className="bg-primary-soft text-primary shrink-0 rounded-pill px-1.5 py-px text-xs font-bold">
            {activeMode}
          </span>
        ) : null}
        <span className={`min-w-0 flex-1 truncate ${skip ? "text-amber font-bold" : ""}`}>
          {skip ?? (selected.length ? displayLessons(value) : "—")}
        </span>
      </div>
    );
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      {/* ⚠️ `min-w-0 flex-1` 필수 — flex 행(라벨 '오늘 →' + 이 트리거) 안에서 `w-full`만 주면 트리거가
          **행 전체 너비**를 요구해 라벨 폭만큼 카드 밖으로 삐져나온다(2026-07-27 실측 23px 오버플로,
          `scrollWidth 417 > clientWidth 394`). 옆 자유입력 <input>은 처음부터 `w-full min-w-0 flex-1`이라
          멀쩡했다 — 같은 규약으로 맞춘다. 표 뷰(블록 컨텍스트)에선 flex-1이 무시돼 기존 동작 그대로. */}
      <Popover.Trigger
        className={`bg-card hover:border-primary/60 data-[popup-open]:border-primary flex h-8 w-full min-w-0 flex-1 items-center gap-1 rounded-lg border px-2 text-left text-xs outline-none transition-colors ${
          skip ? "border-amber text-amber font-bold" : selected.length ? "border-line text-foreground" : "border-line text-text-faint"
        }`}
        aria-label={ariaLabel ?? "진도 선택"}
      >
        {/* 성격(복습·문제풀이)은 **닫힌 상태에서도** 보여야 한다 — 안 보이면 강사가 켠 줄 모르고,
            그게 곧 학부모 문장의 뜻을 바꾼다(진도 나감 ↔ 복습). */}
        {activeMode && !skip ? (
          <span className="bg-primary-soft text-primary shrink-0 rounded-pill px-1.5 py-px text-xs font-bold">
            {activeMode}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate">
          {skip ?? (selected.length ? displayLessons(value) : "진도 선택…")}
        </span>
        {selected.length > 1 ? (
          <span className="bg-primary-soft text-primary shrink-0 rounded-pill px-1.5 py-px text-xs font-bold">
            {selected.length}
          </span>
        ) : null}
        <ChevronDown className="text-text-faint pointer-events-none size-3.5 shrink-0" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
          <Popover.Popup className="bg-card border-line shadow-card flex max-h-[70vh] w-[380px] flex-col overflow-hidden rounded-lg border text-xs outline-none">
            {/* ── 진도 없이 제출(edutrix '상태 선택'의 특수 상태) — 진도가 중단된 날. 맨 위에 두는 이유:
                   이걸 고르면 아래가 전부 잠기므로 **분기 지점**이고, 아래에 묻히면 강사가 못 찾는다. ── */}
            <div className="border-line border-b px-3 py-2">
              <p className="text-text-faint mb-1.5 text-xs">
                진도 없이 제출 <span className="text-text-faint/70">· 시험 등 진도가 중단된 날</span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {SKIP_PROGRESS_STATUSES.map((s) => {
                  const on = skip === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => pickSkip(s)}
                      aria-pressed={on}
                      className={`rounded-pill border px-2.5 py-1 text-xs font-bold transition-colors ${
                        on
                          ? "border-amber bg-amber-soft text-amber"
                          : "border-line text-text-dim hover:border-amber/60 hover:text-amber"
                      }`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── 오늘 수업 성격(복습·문제풀이) — **차시와 함께** 고르는 축이라 위 '진도 없이 제출'과 다른 밴드.
                   원장 2026-08-07: 성격이 없으니 복습을 한 날도 멘트가 "진도를 나갔다"로 나갔다.
                   ⚠️ 진도가 중단된 날(skip)엔 안 그린다 — 나간 차시가 없으니 그 차시의 복습도 성립하지 않는다. ── */}
            {onMode && !skip ? (
              <div className="border-line border-b px-3 py-2">
                <p className="text-text-faint mb-1.5 text-xs">
                  오늘 수업 성격 <span className="text-text-faint/70">· 안 고르면 새 진도로 나갑니다</span>
                </p>
                {/* 알약 자체는 공용 컴포넌트 — 자유 입력 과목(영어)이 입력칸 아래에 쓰는 것과 **같은 물건**이라
                    라벨·해제 규약·툴팁이 두 자리에서 갈라지지 않는다. */}
                <ProgressModePills mode={mode} onMode={onMode} ariaLabel={`${ariaLabel ?? "진도"} 오늘 수업 성격`} />
              </div>
            ) : null}

            {skip ? (
              <p className="text-text-dim bg-amber-soft/50 border-line border-b px-3 py-2 text-xs">
                오늘은 <b className="text-amber">{skip}</b>라 진도 선택이 잠겨 있어요. 차시를 고르려면 위에서
                <b> {skip}</b>를 한 번 더 눌러 해제하세요.
              </p>
            ) : null}

            {/* 아래는 전부 '차시 고르기' — 특수 상태를 고른 날엔 통째로 잠근다(입력마다 disabled: 시각만
                흐리면 키보드·스크린리더로 들어와 값이 바뀐다). */}
            <div className={`flex min-h-0 flex-1 flex-col ${skip ? "opacity-40" : ""}`}>
              {/* 학년 필터 + 검색 — 원래 두 밴드였는데 한 줄로 합쳤다(팝오버가 380px라 겹이 쌓이면 정작
                  체크리스트가 안 보인다). */}
              <div className="border-line flex items-center gap-2 border-b px-3 py-2">
                <select
                  value={studyGrade}
                  onChange={(e) => onStudyGrade(e.target.value)}
                  disabled={!!skip}
                  className="border-line bg-card focus:border-primary h-7 shrink-0 rounded-sm border px-1.5 text-xs outline-none"
                  aria-label="진도 학년 선택"
                >
                  {CURRICULUM_GRADES.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
                {ahead ? (
                  <span className="bg-amber-soft text-amber shrink-0 rounded-pill px-1.5 py-0.5 text-xs font-bold">
                    실제 {studentGrade}
                  </span>
                ) : null}
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="단원·차시 검색"
                  disabled={!!skip}
                  className="border-line bg-bg-soft focus:border-primary h-7 w-full min-w-0 flex-1 rounded-sm border px-2 text-xs outline-none"
                  aria-label="단원·차시 검색"
                />
              </div>

              {/* 이전 진도(참고) + 선택 요약 — 둘 다 한 줄짜리 메타라 같은 밴드에 좌/우로 놓는다.
                  추천 진도 칩은 2026-07-22 원장 지시로 폐지(재도입 금지): 커리큘럼 순서상 '다음 차시'일 뿐
                  그 반이 실제로 나갈 진도가 아니라, 맞을 때보다 틀릴 때가 많았고 한 번 누르면 잘못된 진도가
                  그대로 저장된다. 진도는 강사가 고르는 게 맞다. */}
              {prev?.trim() || selected.length ? (
                <div className="border-line bg-bg-soft/40 flex items-center gap-2 border-b px-3 py-1.5">
                  {prev?.trim() ? (
                    <p className="text-text-faint min-w-0 flex-1 truncate text-xs" title={displayLessons(prev)}>
                      이전 진도: <span className="text-text-dim">{displayLessons(prev)}</span>
                    </p>
                  ) : (
                    <span className="flex-1" />
                  )}
                  {selected.length ? (
                    <span className="text-text-dim shrink-0 text-xs">
                      선택 <b className="text-primary">{selected.length}</b>차시
                    </span>
                  ) : null}
                  {selected.length ? (
                    <button
                      type="button"
                      onClick={() => onChange("")}
                      disabled={!!skip}
                      className="text-text-faint hover:text-danger shrink-0 text-xs"
                    >
                      모두 해제
                    </button>
                  ) : null}
                </div>
              ) : null}

              {/* 다른 학년에서 고른 차시 — 학년을 바꿔도 선택을 지우지 않으므로(내신대비 기간의 선행+현행)
                  지금 목록엔 안 보이는 선택이 생긴다. **보이지 않는 선택은 반드시 여기서 밝힌다**
                  (안 그러면 학년을 바꿔 본 강사가 "고른 게 사라졌다"고 읽고, 그대로 저장돼 학부모에게 나간다). */}
              {otherGrade.length ? (
                <div className="border-line bg-primary-soft/30 flex items-center gap-2 border-b px-3 py-1.5">
                  <p className="text-text-dim min-w-0 flex-1 truncate text-xs" title={otherGrade.join(", ")}>
                    다른 학년 <b className="text-primary">{otherGrade.length}</b>차시도 함께 선택됨:{" "}
                    <span className="text-text-faint">{otherGrade.join(", ")}</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => onChange(joinLessons(selected.filter((l) => gradeLessons.has(l))))}
                    disabled={!!skip}
                    className="text-text-faint hover:text-danger shrink-0 text-xs"
                  >
                    다른 학년만 해제
                  </button>
                </div>
              ) : null}

              {/* 단원별 체크리스트 — **대단원 단위 아코디언, 기본 접힘**(2026-07-28 원장: "진도가 너무 펼쳐져
                  있으니 눌러서 펼치는 형식으로"). 한 학년 차시가 수십 개라 전부 펼쳐두면 원하는 단원까지
                  스크롤이 길다. ⚠️ 접었다고 **선택이 숨지 않아야 한다** — 접힌 단원엔 '선택 N' 배지를 달고,
                  검색 중에는 전부 펼친다(안 그러면 검색 결과가 접힌 채로 안 보인다). */}
              <div
                className={`scrollbar-thin min-h-0 flex-1 overflow-y-auto px-1 py-1 ${skip ? "pointer-events-none" : ""}`}
                aria-hidden={!!skip || undefined}
              >
                {filteredUnits.length === 0 ? (
                  <p className="text-text-faint px-2 py-4 text-center">검색 결과가 없습니다</p>
                ) : (
                  filteredUnits.map((u) => {
                    const unitSelected = u.lessons.filter((l) => selectedSet.has(l)).length;
                    const expanded = !!q || openUnits.has(u.unit);
                    return (
                      <div key={u.unit} className="mb-1">
                        {/* 검색 중엔 전부 펼쳐지므로 접기 버튼이 **아무 일도 안 하는 컨트롤**이 된다 →
                            버튼을 disabled로 두면 "고장난 것처럼" 보이므로 아예 비대화형 헤더로 렌더한다. */}
                        {q ? (
                          <div className="text-text-faint bg-bg-soft/60 sticky top-0 z-10 flex w-full items-center gap-1.5 px-2 py-1.5 text-xs font-bold">
                            <span className="min-w-0 flex-1 truncate">{u.unit}</span>
                            {unitSelected ? (
                              <span className="bg-primary-soft text-primary shrink-0 rounded-pill px-1.5 py-px text-xs">
                                선택 {unitSelected}
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => toggleUnit(u.unit)}
                            disabled={!!skip}
                            aria-expanded={expanded}
                            className="text-text-faint hover:bg-bg-soft bg-bg-soft/60 sticky top-0 z-10 flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs font-bold"
                          >
                            <ChevronDown
                              className={`size-3 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`}
                            />
                            <span className="min-w-0 flex-1 truncate">{u.unit}</span>
                            {unitSelected ? (
                              <span className="bg-primary-soft text-primary shrink-0 rounded-pill px-1.5 py-px text-xs">
                                선택 {unitSelected}
                              </span>
                            ) : (
                              <span className="text-text-faint/60 shrink-0 font-normal">{u.lessons.length}</span>
                            )}
                          </button>
                        )}
                        {expanded
                          ? u.lessons.map((l) => {
                              const on = selectedSet.has(l);
                              return (
                                <div
                                  key={l}
                                  role="checkbox"
                                  aria-checked={on}
                                  tabIndex={skip ? -1 : 0}
                                  onPointerDown={(e) => {
                                    if (e.button !== 0 || skip) return;
                                    e.preventDefault(); // 드래그가 글자 선택으로 새는 것 차단
                                    startDrag(l);
                                  }}
                                  onPointerEnter={() => {
                                    if (drag.current) applyDrag(l);
                                  }}
                                  onKeyDown={(e) => {
                                    if (skip || (e.key !== " " && e.key !== "Enter")) return;
                                    e.preventDefault();
                                    toggle(l);
                                  }}
                                  className={`hover:bg-bg-soft focus-visible:ring-primary flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 outline-none select-none focus-visible:ring-1 ${
                                    on ? "text-primary font-bold" : "text-text-dim"
                                  }`}
                                >
                                  {/* 체크 표시는 **그림만** — 판정·조작은 위 행이 한다(중복 토글 방지). */}
                                  <input
                                    type="checkbox"
                                    checked={on}
                                    readOnly
                                    tabIndex={-1}
                                    aria-hidden
                                    className="accent-primary pointer-events-none mt-0.5 size-3.5 shrink-0"
                                  />
                                  <span className="leading-snug">{l}</span>
                                </div>
                              );
                            })
                          : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
