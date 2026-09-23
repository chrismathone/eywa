"use client";

// 교시 블록 카드 — 헤더(교시·시각·강사·강의실) + 수업계획 표 + 학생 로스터.
// 고아 슬롯(시간표 변경으로 스케줄에 없는 시각)은 데이터 보존을 위해 흐린 경고와 함께 표시(소실 금지).
import { memo } from "react";
import type { ClassSheetWeekData } from "../server/queries";
import type { GridSlot } from "../lib/grid";
import type { PlanLineDTO } from "../server/actions";
import type { SheetHandlers } from "./sheet-client";
import type { SheetSaveStore } from "./use-sheet-saves";
import { PlanTable } from "./plan-table";
import { RosterTable } from "./roster-table";
import type { RosterGroupKey } from "../lib/roster-order";
import { rosterFormOf, type SheetMark } from "../lib/roster-form";
import { teacherNameFor } from "@/features/teacher-view/teacher-name";
import { useTeacherNames } from "@/features/teacher-view/teacher-names-context";
import { useSheetLang, useSheetT } from "@/features/teacher-view/lang-context";
// 강의실 이름도 표기만 영문으로(원장 2026-09-04) — 건물 이름만 로마자, 호수는 그대로.
import { roomNameFor } from "@/features/teacher-view/room-name";

export const PeriodBlock = memo(function PeriodBlock({
  date,
  slot,
  data,
  lines,
  marks,
  attendance,
  store,
  handlers,
  canEdit,
  collapsedGroups,
  onToggleGroup,
  shouting = false,
  onShouting,
  hideRoster = false,
  flat = false,
}: {
  date: string;
  slot: GridSlot;
  data: ClassSheetWeekData;
  lines: PlanLineDTO[];
  marks: Record<string, SheetMark>;
  attendance: Record<
    string,
    { status: string; note: string | null; units: number | null; slot: string | null }
  >;
  store: SheetSaveStore;
  handlers: SheetHandlers;
  canEdit: boolean;
  /** 접어 둔 로스터 섹션 — **시트 전체 공유**(카드마다 따로면 나란한 카드의 줄맞춤이 어긋난다). */
  collapsedGroups: readonly RosterGroupKey[];
  onToggleGroup: (key: RosterGroupKey) => void;
  /**
   * 이 교시에 **Shouting을 했는가**(0230a) — 체크박스 상태. EiE 반에서만 그린다.
   * (원장 2026-08-27: 인재원 영어는 샤우팅을 아예 쓰지 않고, EiE는 수업계획 '구분'이 아니라 이 체크로 남긴다.)
   */
  shouting?: boolean;
  /**
   * 체크 토글. **없으면 체크 자체를 안 그린다**(= EiE가 아닌 반).
   * ⚠️ 인자를 (날짜, 교시, 값)으로 받는 이유: 부모가 카드마다 인라인 람다를 만들면 `memo`가 매번 깨진다.
   */
  onShouting?: (date: string, slotStart: string, next: boolean) => void;
  /**
   * 로스터 생략 — 오늘 면(today-class-sheet)이 명단을 **통합 표 한 번**으로 그리므로 교시 카드는
   * 머리(교시·시각·일괄 입력)+계획만 낸다(원장 2026-08-11 "목록은 왜 여러 번?"). 주간 시트는 기본값.
   */
  hideRoster?: boolean;
  /**
   * 카드 껍데기(잉크 테두리·라운드·그림자·패딩)를 벗는다 — 오늘 면은 교시들이 **한 카드 안에서
   * 세로선으로** 갈리므로(원장 2026-08-11 "줄로 교시 구분") 교시마다 상자를 또 두르면 선이 두 겹이 되고
   * 카드 안에 카드가 생긴다. 주간 시트는 기본값(카드 한 장 = 수업 하나, 원장 2026-08-10).
   */
  flat?: boolean;
}) {
  // 키에 날짜 포함 — 같은 시각이라도 평일/주말 교시 번호가 다르다(주말은 별도 교시표).
  const periodLabel = data.periodLabelBySlot[`${date}|${slot.slotStart}`] ?? null;
  // teacherLabel은 로더에서 이미 해석된 표시명(시간표와 동일 문자열). 라벨 우선은 **시간표 3뷰와 같은
  // 순서**라 두 화면이 같은 이름을 보여준다 — 뒤집지 말 것(실측: 라벨과 FK가 서로 다른 사람을 가리키는
  // 슬롯이 존재해, FK 우선으로 바꾸면 시간표와 어긋난 이름이 ECS에만 뜬다. 상세는 changelog 2026-07-29).
  // 🔴 영어 화면에서는 그 강사의 **영어 이름**으로 바꿔 적는다(원장 2026-09-03) — 판정은
  //    [`teacherNameFor`](@/features/teacher-view/teacher-name) 한 곳이고 표에 없으면 한국어 그대로다.
  //    ⚠️ 라벨엔 자리(LAB·JJ)도 들어오는데 표에 없으니 저절로 안 바뀐다.
  const teacherNames = useTeacherNames();
  const lang = useSheetLang();
  const t = useSheetT();
  const teacher = teacherNameFor(
    slot.teacherLabel ??
      (slot.teacherId ? (data.teacherNames[slot.teacherId] ?? null) : null) ??
      data.classTeacherName,
    teacherNames,
    lang,
  );
  return (
    // ⚠️ cursor-default 필수 — 바깥 DragScrollArea가 컨테이너에 cursor-grab(펼친 손)을 깔아서,
    // 안 덮으면 카드를 **끌어서 옮길 수 있는 것처럼** 보인다(teacher-grid 선례·원장 지적 2026-07-29).
    //
    // ⚠️ `cursor-auto`로 바꾸지 말 것(검토 후 기각): auto는 텍스트 위에서 I빔이 되는데, 이 컨테이너는
    // 5px 넘게 끌면 팬으로 전환하며 `userSelect:none`을 걸어(drag-scroll-area.tsx:128) **드래그 선택이
    // 아예 불가능**하다 — I빔은 못 하는 일을 약속하는 거짓 어포던스가 된다. 중립적인 화살표가 정직하다.
    // 선택이 실제로 되는 곳(input·textarea)은 skip() 대상이라 UA I빔을 그대로 유지한다(실측 확인).
    // `grid-rows-subgrid` + `row-span-3` — 부모(sheet-grid)가 교시 행마다 깔아 둔 세 트랙
    // (머리 / 계획 / 로스터)에 이 카드의 세 구획을 그대로 올린다. 그래야 계획 줄 수가 달라도
    // **같은 행의 모든 카드에서 학생 표가 같은 높이에서 시작**한다(원장 2026-08-04).
    // ⚠️ 자식이 정확히 이 셋이어야 한다 — 여기에 형제 요소를 더하면 넷째가 다음 교시 행 트랙으로
    //    흘러 카드가 겹친다. 새 구획이 필요하면 세 구획 **안에** 넣거나 부모 트랙 수를 함께 늘릴 것.
    // ⚠️ `h-full`은 쓰지 않는다(부모가 span으로 높이를 정한다).
    // 🔴 카드 외곽선 = **진한 잉크 테두리**(원장 2026-08-10: *"모든 박스에 진한 검은색 테두리 …
    //    사진 하나가 수업카드 1개"*). shadow만으로는 흰 배경 위에서 카드가 어디서 끝나는지 안 보였고,
    //    가로로 여러 요일이 늘어선 시트에선 그게 곧 "어느 교시 얘기인지"가 안 보인다는 뜻이었다.
    // ⚠️ 이 테두리는 **카드에만**. 안쪽 입력칸까지 잉크로 두르면 격자가 검게 뒤덮여 카드 경계가 묻힌다.
    <article
      className={`row-span-3 grid cursor-default grid-rows-subgrid ${
        flat ? "" : "bg-card border-foreground shadow-card rounded-2xl border p-2.5"
      }`}
    >
      {/* 카드 머리 — 원본 시트의 회색 교시 칸(1교시 / 03:00~03:40)과 같은 위계. 교시=칩, 시각=옆 숫자.
          ⚠️ 글자는 **전부 굵게 + foreground**(원장 2026-08-06 "전체 텍스트를 굵게할것 (잘보이게)").
             시각·강의실이 dim 보통굵기라 한 발짝만 떨어져도 안 읽혔다 — 여기서 위계를 다시 낮추지 말 것. */}
      <header className="border-line-strong flex flex-wrap items-center gap-x-2 gap-y-1 border-b pb-1.5">
        {periodLabel ? (
          <span className="bg-bg-soft text-foreground rounded-md px-1.5 py-0.5 text-sm font-bold">
            {periodLabel}
          </span>
        ) : null}
        <span className="text-foreground num text-sm font-bold whitespace-nowrap">
          {slot.slotStart}
          {slot.slotEnd ? ` ~ ${slot.slotEnd}` : ""}
        </span>
        {teacher ? (
          <span className="border-line-strong text-foreground rounded-full border px-2 py-0.5 text-xs font-bold whitespace-nowrap">
            {teacher}
          </span>
        ) : null}
        {slot.roomLabel ? (
          <span className="text-foreground text-xs font-bold whitespace-nowrap">
            {roomNameFor(slot.roomLabel, lang)}
          </span>
        ) : null}
        {/* 🔴 '시간 변경됨' 배지는 없앴다 — 원장 2026-09-23 *"앞으로 안뜨게하면 되고 이전 데이터들은 무시해"*.
            `buildWeekGrid`가 2026-09-22부터 고아 교시를 아예 안 내려보내 어차피 죽은 가지였다(`scheduled`
            게이트 자체는 Shouting 등 다른 소비처가 아직 쓰므로 그대로 둔다). 기록은 지우지 않는다. */}
        {/* Shouting 체크 — **EiE 반만**(부모가 onShouting을 줄 때만 그린다). 머리 줄 오른쪽 끝, 구분선 위
            (원장 2026-08-27 "우상단에 우측정렬해서 구분선 위쪽에"). 라벨까지 눌리게 label로 감싼다. */}
        {onShouting ? (
          <label
            className={`ml-auto flex shrink-0 items-center gap-1 text-xs font-bold whitespace-nowrap ${
              canEdit && slot.scheduled ? "cursor-pointer" : "cursor-default opacity-60"
            }`}
            title={t("plan.shouting.title")}
          >
            <input
              type="checkbox"
              className="size-3.5 shrink-0 accent-primary"
              checked={shouting}
              disabled={!canEdit || !slot.scheduled}
              onChange={(e) => onShouting(date, slot.slotStart, e.target.checked)}
            />
            <span className={shouting ? "text-primary" : "text-text-dim"}>{t("landing.col.shouting")}</span>
          </label>
        ) : null}
      </header>

      <PlanTable
        date={date}
        slotStart={slot.slotStart}
        lines={lines}
        skillAreas={data.skillAreas}
        store={store}
        handlers={handlers}
        canEdit={canEdit && slot.scheduled}
        showExamTerm={!data.isEie}
      />

      {!hideRoster && slot.roster.length > 0 ? (
        <RosterTable
          date={date}
          slotStart={slot.slotStart}
          roster={slot.roster}
          data={data}
          marks={marks}
          attendance={attendance}
          handlers={handlers}
          canEdit={canEdit}
          collapsedGroups={collapsedGroups}
          onToggleGroup={onToggleGroup}
          // JJ(집중자율수업실) 교시는 전용 폼 — 판정은 슬롯 라벨 하나(원장 2026-08-13).
          // ⚠️ `teacher`(위 폴백)로 판정하지 말 것: 라벨이 없으면 반 담임 이름으로 떨어져 자리가 아니게 된다.
          form={rosterFormOf(slot.teacherLabel)}
        />
      ) : null}
    </article>
  );
});
