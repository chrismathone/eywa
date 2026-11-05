"use client";
import Link from "next/link";
import { tipProps } from "@/components/hover-tip/tip";

import { useCallback, useRef, useState } from "react";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { SlotPlanBlock } from "@/features/class-sheets/components/slot-plan-block";
import type { PlanWriteApi } from "@/features/class-sheets/components/plan-api";
import type { CarryPatch } from "@/features/class-sheets/lib/carry-marks";
import type { SeatClassPlan } from "@/features/attendance/seat/server/jj-plan";
import {
  isJjMarkField,
  JJ_MARK_MAXLEN,
  JJ_PLAN_COL_MIN_PX,
  jjClassColumns,
  jjSeatTextCols,
  type JjMarkField,
} from "@/features/attendance/seat/jj-fields";
import { ROSTER_FIXED_LABEL } from "@/features/class-sheets/lib/roster-form";
import { AttitudeCheck } from "@/features/class-sheets/components/attitude-check";
import { seatNoteTitle } from "@/features/attendance/seat/note-title";
import type { SeatClassRoster } from "@/features/attendance/seat/server/queries";
import type { SeatStatus } from "@/features/attendance/seat/server/actions";
import { seatCellKey } from "@/features/attendance/seat/prev-period";
import { SeatMarkTriad, SeatMemoMark, SeatNotePopover } from "./seat-mark-extras";
import { writeLockedPlaceholder } from "@/lib/write-lock";
import { SeatPeriodHints, type SeatPeriodHintData } from "./seat-period-hints";

const INPUT =
  "border-line focus:border-primary h-8 w-full rounded-lg border bg-card px-2 text-sm font-semibold outline-none disabled:opacity-60";

/**
 * 진도(수업계획) 구획을 그리는 데 필요한 것 한 묶음 — **없으면 구획 자체가 안 생긴다**.
 * 🔴 화면 조건은 게이트가 아니다(#77) — 어느 반이 여기 실리는지는 **서버**가 정하고(로그인은
 *    `loadSeatJjPlans`의 `requireEcsClassAccess`, 비로그인 PIN은 `loadPublicSeatJjPlans`의 명단
 *    화이트리스트), 저장할 때 그 게이트를 **다시** 통과한다.
 */
export type SeatPlanContext = {
  /** 반 id → 그 교시 계획. **키가 없는 반은 계획을 볼 권한이 없는 반**이다. */
  plans: Record<string, SeatClassPlan>;
  /** 저장이 나갈 문 — 로그인 `ECS_PLAN_API` / 공개 PIN `seatPlanApi(seat)`. 안정 참조. */
  api: PlanWriteApi;
  tenantId: string;
  /** 저널 문서 키의 사용자 축. 공개 PIN 화면은 계정이 없어 자리 키를 쓴다. */
  userId: string;
  /** 저널·presence 문서 키의 주차(월요일) — 영어 시트와 같은 값이어야 두 화면이 서로를 본다. */
  weekMonday: string;
  date: string;
  slotStart: string;
  /** 내용 복사가 채운 듣기 레벨·누적 암기 단어수 — 학생 칸 화면 상태에 머지한다. */
  onCarried: (classId: string, patches: CarryPatch[]) => void;
  /** 복사 전에 비울 학생 칸 저장 큐(디바운스) — 안 비우면 화면과 DB가 갈린다. */
  flushFields: () => Promise<unknown>;
};

/**
 * 수업계획 구획의 **접힘** — '전체' 보기에서만 온다(없으면 늘 펼친 채 = 교시 하나 보기, 종전 그대로).
 * 🔴 **반마다 따로**다(원장 2026-09-18 *"각각의 수업이 펼치기 접기가 되어야함. 당일"*) — 교시 한 덩어리로 묶으면
 *    한 반의 계획을 보려고 그 교시 반 전부를 펴야 한다.
 * 🔑 `mountedOf`는 한 번 펼친 뒤로 계속 참이다 — 접을 때 블록을 **내리지 않고 감추기만** 한다.
 *    내렸다가 다시 올리면 블록이 첫 화면의 서버 줄(`initialLines`)로 되살아나 방금 고친 칸이 옛 값으로
 *    보이고, 그 옛 값이 CAS 기대값이 되어 다음 입력이 거짓 충돌로 뜬다(`SlotPlanBlock` 머리 주석 ⚠️).
 */
export type SeatPlanFold = {
  /** 이 반의 계획이 지금 펼쳐져 있나. */
  openOf: (classId: string) => boolean;
  /** 이 반의 블록을 한 번이라도 올렸나 — 올린 적 없으면 그리지 않는다(저널·저장 큐·presence가 블록마다 붙는다). */
  mountedOf: (classId: string) => boolean;
  /** 이 반의 계획 저장 충돌 수 — 접힌 버튼이 그 수를 붉게 말한다(접힌 채 두면 저장이 멈춘 걸 아무도 모른다). */
  conflictsOf: (classId: string) => number;
  toggle: (classId: string) => void;
};

type JjTableProps = {
  rosters: SeatClassRoster[];
  plan?: SeatPlanContext;
  planFold?: SeatPlanFold;
  /** 반마다 계획 저장 충돌 수 — 접을 수 있는 보기('전체')만 넘긴다(접힌 블록 안의 충돌 표시는 안 보인다). */
  onPlanConflicts?: (classId: string, count: number) => void;
  statusOf: (classId: string, student: SeatClassRoster["students"][number]) => SeatStatus | null;
  noteOf: (classId: string, student: SeatClassRoster["students"][number]) => string | null;
  onSaveNote: (classId: string, studentId: string, note: string, status: SeatStatus | null) => void;
  /** 사유 칸을 그릴 것인가 — 비로그인 PIN 화면은 false(그 경로는 사유를 조회하지 않는다). */
  showReason: boolean;
  /** 같은 날 교시 사이 신호(앞 교시 결석 · 다음 교시) — 표시 전용. */
  hints: SeatPeriodHintData;
  onSave: (classId: string, studentId: string, next: SeatStatus | null, prev: SeatStatus | null) => void;
  /** `before` = 이 입력 직전에 화면이 보던 값(감사로그의 이전 값). */
  onSaveField: (classId: string, studentId: string, field: JjMarkField, value: string, before: string | null) => void;
  onFillClass: (classId: string) => void;
  readOnly: boolean;
  /**
   * 자리 출석부 **읽기 권한**(보드의 `readOnlyReason === "permission"`, 원장 2026-11-05) — 출결 세 단추 대신 상태 글자,
   * 잠긴 입력칸 placeholder에 권한 안내(`writeLockedPlaceholder("seat_attendance")`). 지난 날짜 잠금과 사유가 달라 따로 받는다.
   */
  writeLocked?: boolean;
  pending: boolean;
};

/** JJ실 안내 한 줄 — 교시 하나 보기는 보드가, '전체' 보기는 위에서 한 번만 적는다(교시마다 반복 금지). */
export function SeatJjNote() {
  return <p className="text-text-dim px-1 text-xs">듣기 레벨·누적 암기 단어수는 영어 시트 JJ 칸과 같은 기록입니다.</p>;
}

/**
 * JJ실 출석부 — 반은 **가로**, 학생은 반 안에서 **세로**.
 * 전폭 표로 쌓으면 이름 칸이 창을 밀어 가로가 비고 반은 아래로만 길어진다.
 */
export function SeatJjTable(props: JjTableProps) {
  // 계획을 하나라도 그리면 **모든 열**을 그 폭으로 넓힌다 — 열마다 폭이 다르면 나란한 표가 어긋난다.
  const anyPlan = props.rosters.some((r) => props.plan?.plans[r.classId]);
  return (
    /**
     * 두 배치가 있다 — 어느 쪽인지는 `planFold`(접을 수 있는 보기인가)가 정한다.
     * ① 접기가 없는 보기(교시 하나·공개 PIN): **속살까지 줄맞춤 = `grid-rows-subgrid`**(원장 2026-09-10 ⑦: 세 카드의
     *    수업계획 블록 높이가 달라 아래 표 머리가 서로 다른 높이에서 시작했다). 행을 셋(머리·계획·표)으로 못박고 카드가
     *    그 행을 물려받는다. 이 배치에서 `items-start`를 쓰면 카드가 내용 높이로 줄어들어 줄맞춤이 죽는다.
     * ② 접을 수 있는 보기('전체', 반마다 접는다 — 원장 2026-09-18): **줄맞춤을 쓰지 않는다**(`items-start`). 행 높이가
     *    열끼리 묶이면 한 반만 폈을 때 나머지 카드의 계획 행이 펼친 높이만큼 **빈 칸**으로 남는다. 접힌 카드는 제 높이로
     *    선다(다 접힌 기본 상태에선 카드 모양이 같아 저절로 맞는다).
     */
    <div
      className={`grid gap-3 overflow-x-auto ${props.planFold ? "items-start" : "grid-rows-[auto_auto_auto]"}`}
      style={{
        gridTemplateColumns: jjClassColumns(
          props.rosters.length,
          anyPlan ? JJ_PLAN_COL_MIN_PX : undefined,
        ),
      }}
    >
      {props.rosters.map((r) => (
        <SeatJjClass
          key={r.classId}
          roster={r}
          plan={props.plan}
          planFold={props.planFold}
          onPlanConflicts={props.onPlanConflicts}
          statusOf={props.statusOf}
          noteOf={props.noteOf}
          onSaveNote={props.onSaveNote}
          showReason={props.showReason}
          hints={props.hints}
          onSave={props.onSave}
          onSaveField={props.onSaveField}
          onFillClass={props.onFillClass}
          readOnly={props.readOnly}
          writeLocked={props.writeLocked}
          pending={props.pending}
        />
      ))}
    </div>
  );
}

function SeatJjClass({
  roster: r,
  plan,
  planFold,
  onPlanConflicts,
  statusOf,
  noteOf,
  onSaveNote,
  showReason,
  hints,
  onSave,
  onSaveField,
  onFillClass,
  readOnly,
  writeLocked = false,
  pending,
}: Omit<JjTableProps, "rosters"> & { roster: SeatClassRoster }) {
  const cols = jjSeatTextCols();
  // 잠긴 칸의 안내 — 권한 때문이면 권한을 말한다(지난 날짜 잠금은 보드 위 한 줄이 이미 말한다).
  const lockedPlaceholder = writeLocked ? writeLockedPlaceholder("seat_attendance") : undefined;
  const left = r.students.filter((s) => statusOf(r.classId, s) === null).length;
  const slotPlan = plan?.plans[r.classId];
  const canEditEcs = !!slotPlan?.canEdit;
  // 참조 고정 — 계획 블록이 `memo`라 인라인 화살표를 넘기면 memo가 매 렌더 깨진다.
  const onCarried = plan?.onCarried;
  const classId = r.classId;
  const handleCarried = useCallback(
    (patches: CarryPatch[]) => onCarried?.(classId, patches),
    [onCarried, classId],
  );
  const handleConflicts = useCallback(
    (count: number) => onPlanConflicts?.(classId, count),
    [onPlanConflicts, classId],
  );
  // 진도(수업계획) 블록 — 권한이 없는 반은 `plan.plans[classId]`가 없어 null이다(구획 자체가 안 생긴다).
  const planBlock =
    plan && slotPlan ? (
      <SlotPlanBlock
        classId={r.classId}
        api={plan.api}
        tenantId={plan.tenantId}
        userId={plan.userId}
        weekMonday={plan.weekMonday}
        planDate={plan.date}
        slotStart={plan.slotStart}
        initialLines={slotPlan.lines}
        skillAreas={slotPlan.skillAreas}
        // 🔴 지난 날짜 보기(readOnly)에서는 진도도 못 고친다 — 출결만 막고 계획을 열어 두면
        //    "지난 날짜는 보기만" 안내가 거짓말이 된다. 쓰기 자격은 서버가 다시 본다(#77).
        canEdit={slotPlan.canEdit && !readOnly}
        showExamTerm={slotPlan.showExamTerm}
        onCarried={handleCarried}
        flushHost={plan.flushFields}
        onConflicts={onPlanConflicts ? handleConflicts : undefined}
      />
    ) : null;
  const planOpen = planFold ? planFold.openOf(classId) : true;
  const planConflictN = planFold ? planFold.conflictsOf(classId) : 0;
  return (
    <section
      // ⚠️ `gap-3` — subgrid는 부모 격자의 12px 간격을 물려주지만 flex는 안 준다(재리뷰 2026-09-18: 카드 안 간격이 0이 됐다).
      className={`border-line min-w-0 overflow-hidden rounded-2xl border ${
        planFold ? "flex flex-col gap-3" : "row-span-3 grid grid-rows-subgrid"
      }`}
    >
      <header className="bg-bg-soft border-line flex flex-wrap items-center gap-2 border-b px-3 py-1.5 text-sm">
        <span className="min-w-0 truncate font-bold" title={r.className}>
          {r.className}
        </span>
        <span className="text-text-faint text-xs tabular-nums">{r.students.length}명</span>
        <span className="text-text-faint text-xs tabular-nums">~{r.end}</span>
        <Link
          href={`/ecs/${r.classId}${canEditEcs ? "" : "?readonly=1"}`}
          target="_blank"
          rel="noreferrer"
          className="border-line bg-card text-primary ml-auto rounded-full border px-2 py-0.5 text-xs font-semibold hover:bg-bg-soft"
          title={canEditEcs ? "내 담당 반 ECS" : "읽기 전용 ECS"}
        >
          ECS{canEditEcs ? "" : " (읽기 전용)"}
        </Link>
        {!readOnly && left > 0 ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => onFillClass(r.classId)}
            className="border-line bg-card text-primary rounded-full border px-2 py-0.5 text-xs font-semibold disabled:opacity-50"
          >
            이 반 출석
          </button>
        ) : null}
      </header>
      {/* 진도(수업계획) — ECS 교시 카드와 **같은 순서**(머리 → 진도 → 학생)이고 같은 기록·같은 저장 경로다.
          권한이 없는 반은 `plan.plans[classId]`가 없어 이 구획 자체가 안 생긴다. */}
      {planBlock ? (
        planFold ? (
          /**
           * 접는 배치 — 계획 자리에 **가로로 긴 접기 줄**을 두고 그 아래에 블록을 편다(원장 2026-09-18 *"각각의 수업이
           * 펼치기 접기가 되어야함"* · *"펼치기가 어딨어?"*). 🔴 머리에 버튼으로 넣지 않는다 — 머리는 반 이름·인원·ECS·
           * '이 반 출석'으로 이미 빠듯해 버튼 하나에 두 줄로 꺾이고(재리뷰 2026-09-18), 같은 이름의 버튼이 교시×반만큼
           * 서서 어느 반인지 못 가른다(그래서 접근 이름에 반 이름을 붙인다).
           * 🔴 감추기는 안쪽 div에만(`hidden`) — 한 번 올린 블록은 내리지 않는다(`SeatPlanFold` 주석).
           */
          <div className="-mt-3 min-w-0">
            <button
              type="button"
              aria-expanded={planOpen}
              // 접근 이름 = 화면 글자 + 반 이름(WCAG 2.5.3 — 충돌 건수도 이름에 싣는다, 재리뷰 2026-09-18).
              aria-label={`${r.className} 수업계획 ${planOpen ? "접기" : "펼치기"}${
                !planOpen && planConflictN > 0 ? ` · 저장 충돌 ${planConflictN}건` : ""
              }`}
              onClick={() => planFold.toggle(classId)}
              title={
                planOpen
                  ? "이 반의 수업계획을 접습니다 — 적어 둔 내용은 그대로입니다"
                  : planConflictN > 0
                    ? "수업계획에 저장이 멈춘 칸이 있습니다 — 펼쳐서 충돌한 칸의 서버값/내 값을 고르세요"
                    : "이 반의 수업계획을 펼칩니다"
              }
              // `-outline-offset-2` — 카드가 `overflow-hidden`이라 밖으로 나가는 포커스 링은 좌우가 잘린다.
              className={`border-line flex w-full items-center justify-between border-b px-3 py-1 text-xs font-semibold focus-visible:-outline-offset-2 ${
                planOpen ? "bg-bg-soft text-text-dim" : planConflictN > 0 ? "bg-card text-danger" : "bg-card text-primary"
              }`}
            >
              <span>
                {planOpen
                  ? "수업계획 접기"
                  : planConflictN > 0
                    ? `수업계획 펼치기 · 저장 충돌 ${planConflictN}건`
                    : "수업계획 펼치기"}
              </span>
              <span aria-hidden="true">{planOpen ? "▴" : "▾"}</span>
            </button>
            {planFold.mountedOf(classId) ? <div hidden={!planOpen}>{planBlock}</div> : null}
          </div>
        ) : (
          planBlock
        )
      ) : planFold ? null : (
        // 🔴 줄맞춤 배치에선 계획 구획이 없는 카드도 **그 행을 차지해야** 한다 — 안 그러면 표가 계획 행으로 올라와
        //    옆 카드와 다시 어긋난다(권한 없는 반·랩실이 그 경우다). 접는 배치(flex)엔 행이 없어 자리를 안 만든다.
        <div />
      )}
      <table className="w-full table-fixed border-collapse text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-[var(--line-faint)]">
        {/* 여섯 칸 — 영어 시트 JJ 폼과 **같은 순서**(이름 · 출결 · 태도 · 자유 입력 · 특이사항).
            ⚠️ 폭은 %다(시트는 px). 이 표는 반 수만큼 열이 갈리는 격자 안에 들어가 폭이 고정이 아니다.
            특이사항은 width 없는 마지막 <col>이라 **잔여를 받는다**(시트와 같은 규약). */}
        <colgroup>
          <col style={{ width: "20%" }} />
          {/* 출결 버튼을 한 줄에 배치하면서도 ECS 링크를 함께 보여주도록 폭을 압축한다.
              두 글자 라벨 3개 + 간격이 들어갈 최소치를 유지한다.
              ⚠️ 사유 입력칸이 팝업으로 내려가 이 칸의 세로 높이는 오히려 줄었다. */}
          <col style={{ width: "20%" }} />
          <col style={{ width: "10%" }} />
          {cols.map((c) => (
            <col key={c.field} style={{ width: c.field === "memorizedWords" ? "11%" : "10%" }} />
          ))}
          <col />
        </colgroup>
        <thead>
          <tr className="bg-bg-soft text-foreground text-xs">
            {/* 이름 열은 본문도 가운데다(원장 2026-09-10) — 머리와 좌우 여백을 맞춘다. */}
            <th className="px-1 py-1.5 text-center font-bold">이름</th>
            <th className="px-1 py-1.5 text-center font-bold">출결</th>
            <th className="px-1 py-1.5 text-center font-bold" title="이 교시의 수업 태도 — 누를 때마다 5단 눈금을 돕니다">
              {ROSTER_FIXED_LABEL.attitude}
            </th>
            {cols.map((c) => (
              <th key={c.field} className="px-1 py-1.5 text-center leading-tight font-bold" title={c.title}>
                {c.label}
              </th>
            ))}
            <th className="px-1 py-1.5 text-center font-bold whitespace-nowrap">{ROSTER_FIXED_LABEL.progressNote}</th>
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {r.students.map((s) => {
            const cur = statusOf(r.classId, s);
            // 사유 메모는 줄 전체의 툴팁(원장 2026-08-28 "마우스 오버시 결석사유") — 출결 버튼처럼
            // 자기 title이 없는 칸은 이걸 물려받는다. 자기 title을 가진 칸(이름)은 여기서 이어 붙인다.
            const noteTitle = seatNoteTitle(cur, s.note);
            return (
              <tr key={s.id} {...tipProps(noteTitle)}>
                {/* 이름 칸 — **가운데 정렬 + 좌우 여백 최소**(원장 2026-09-10: *"이름도 가운데정렬시켜주고
                    여백 최소화"*). 두 줄(이름 / 학교학년) 모두 가운데다.
                    ⚠️ 세로 여백은 그대로 둔다 — 줄 높이는 옆 칸의 출결 버튼이 정하고, 그 탭 타겟을 줄이면
                       폰에서 못 누른다(지시도 '좌우 여백'이었다). */}
                <td className="px-1 py-1.5 text-center">
                  <p
                    className="truncate font-bold"
                    {...tipProps(noteTitle ? { title: s.name, lines: [noteTitle] } : null)}
                    title={noteTitle ? undefined : s.name}
                  >
                    {s.name}
                  </p>
                  <p className="text-text-dim truncate text-xs">
                    {schoolGradeLabel(s.school, s.grade) || " "}
                  </p>
                </td>
                {/* 출결 칸 — 세 버튼 + 사유 팝업 + 메모 삼각형. 줄마다 제 상태·앵커를 가져야 해서
                    **작은 컴포넌트**로 뺀다(map 안에서는 ref를 못 만든다). */}
                <JjAttendanceCell
                  classId={r.classId}
                  student={s}
                  cur={cur}
                  note={noteOf(r.classId, s)}
                  noteTitle={noteTitle}
                  showReason={showReason}
                  readOnly={readOnly}
                  writeLocked={writeLocked}
                  pending={pending}
                  hints={hints}
                  onSave={onSave}
                  onSaveNote={onSaveNote}
                />
                {/* 태도 — 영어 시트와 **같은 부품**(5단 눈금 순환). 옛 자유입력 값도 그대로 보여준다. */}
                <td className="px-1 py-1.5">
                  <AttitudeCheck
                    value={s.attitude ?? null}
                    studentName={s.name}
                    canEdit={!readOnly}
                    onSet={(next) => onSaveField(r.classId, s.id, "attitude", next ?? "", s.attitude ?? null)}
                  />
                </td>
                {cols.map((c) => {
                  const field = c.field;
                  if (!isJjMarkField(field)) return null;
                  return (
                    <td key={field} className="px-1 py-1.5">
                      <input
                        className={INPUT}
                        value={s[field] ?? ""}
                        disabled={readOnly}
                        placeholder={lockedPlaceholder}
                        maxLength={JJ_MARK_MAXLEN[field]}
                        aria-label={`${s.name} ${c.label}`}
                        title={c.title}
                        onChange={(e) => onSaveField(r.classId, s.id, field, e.target.value, s[field] ?? null)}
                      />
                    </td>
                  );
                })}
                <td className="px-1 py-1.5">
                  <input
                    className={INPUT}
                    value={s.progressNote ?? ""}
                    disabled={readOnly}
                    placeholder={lockedPlaceholder}
                    maxLength={JJ_MARK_MAXLEN.progressNote}
                    aria-label={`${s.name} ${ROSTER_FIXED_LABEL.progressNote}`}
                    title="이 교시의 특이사항 — 영어 시트 JJ 칸과 같은 기록입니다"
                    onChange={(e) =>
                      onSaveField(r.classId, s.id, "progressNote", e.target.value, s.progressNote ?? null)
                    }
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/**
 * JJ실 **출결 칸** 한 줄 — 세 버튼(출석·결석·지각) + 사유 팝업 + 메모 삼각형.
 *
 * 🔴 랩실 카드와 **같은 부품**(`SeatMarkTriad`·`SeatNotePopover`·`SeatMemoMark`)을 쓴다 — 두 화면에
 *    각자 그리면 한쪽만 고쳐진다(2026-09-08 `seatMarkOf` 사고와 같은 결).
 * 🔑 줄마다 제 팝업 상태와 **앵커 ref**가 필요해서 작은 컴포넌트로 뺐다(`map` 안에서는 ref를 못 만든다).
 * ⚠️ 사유 팝업은 **공개 PIN 화면에서 안 열린다**(`showReason=false`) — 그 경로는 사유를 조회조차 안 한다.
 */
function JjAttendanceCell({
  classId,
  student: s,
  cur,
  note,
  noteTitle,
  showReason,
  readOnly,
  writeLocked,
  pending,
  hints,
  onSave,
  onSaveNote,
}: {
  classId: string;
  student: SeatClassRoster["students"][number];
  cur: SeatStatus | null;
  note: string | null;
  noteTitle: string | null;
  showReason: boolean;
  readOnly: boolean;
  /** 읽기 권한 — 세 단추 대신 상태 글자(`JjTableProps.writeLocked`). */
  writeLocked: boolean;
  pending: boolean;
  hints: SeatPeriodHintData;
  onSave: (classId: string, studentId: string, next: SeatStatus | null, prev: SeatStatus | null) => void;
  onSaveNote: (classId: string, studentId: string, note: string, status: SeatStatus | null) => void;
}) {
  const anchorRef = useRef<HTMLTableCellElement | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const canNote = showReason && !readOnly;

  return (
    <td ref={anchorRef} className="relative px-1 py-1.5" {...tipProps(noteTitle)}>
      <SeatNotePopover
        open={noteOpen}
        onOpenChange={setNoteOpen}
        anchorRef={anchorRef}
        note={note}
        status={cur}
        studentName={s.name}
        onSave={(text) => onSaveNote(classId, s.id, text, cur)}
      >
        {/* 🔴 우클릭 = 상태를 안 바꾸고 사유·특이사항만([[#97]] 규약). `preventDefault`는 못 여는 칸에서도. */}
        <div
          onContextMenu={(e) => {
            e.preventDefault();
            if (canNote) setNoteOpen(true);
          }}
        >
          <SeatMarkTriad
            cur={cur}
            studentName={s.name}
            disabled={readOnly || pending}
            statusOnly={writeLocked}
            onMark={(next) => {
              // 고른 것을 다시 누르면 미체크로([[#103]]). 결석·지각을 새로 고르면 사유 창이 이어서.
              const same = cur === next;
              onSave(classId, s.id, same ? null : next, cur);
              setNoteOpen(!same && canNote && (next === "absent" || next === "late"));
            }}
          />
        </div>
      </SeatNotePopover>
      {showReason ? <SeatMemoMark note={note} /> : null}
      <div className="mt-1">
        {/* 같은 날 교시 사이 신호 — 앞 교시 결석 · 다음 행선지(표시 전용, 랩실과 같은 부품). */}
        <SeatPeriodHints
          prevAbsentStart={hints.prevAbsentByCell?.[seatCellKey(classId, s.id)]}
          nextStart={hints.nextStartByStudent?.[s.id]}
          nextRoom={hints.nextRoomByStudent?.[s.id]}
          last={hints.lastByStudent?.[s.id]}
          seatName={hints.seatName}
          cur={cur}
        />
      </div>
    </td>
  );
}
