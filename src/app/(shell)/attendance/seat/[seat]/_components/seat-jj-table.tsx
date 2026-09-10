"use client";

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
import {
  PrevAbsenceHint,
  SeatMarkTriad,
  SeatMemoMark,
  SeatNotePopover,
  SeatPeriodHints,
  type SeatPeriodHintData,
} from "./seat-mark-extras";

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

type JjTableProps = {
  rosters: SeatClassRoster[];
  plan?: SeatPlanContext;
  statusOf: (classId: string, student: SeatClassRoster["students"][number]) => SeatStatus | null;
  noteOf: (classId: string, student: SeatClassRoster["students"][number]) => string | null;
  onSaveNote: (classId: string, studentId: string, note: string, status: SeatStatus | null) => void;
  /** 사유 칸을 그릴 것인가 — 비로그인 PIN 화면은 false(그 경로는 사유를 조회하지 않는다). */
  showReason: boolean;
  /** 같은 날 교시 사이 신호(앞 교시 결석 · 다음 교시) — 표시 전용. */
  hints: SeatPeriodHintData;
  onSave: (classId: string, studentId: string, next: SeatStatus | null, prev: SeatStatus | null) => void;
  onSaveField: (classId: string, studentId: string, field: JjMarkField, value: string) => void;
  onFillClass: (classId: string) => void;
  readOnly: boolean;
  pending: boolean;
};

/**
 * JJ실 출석부 — 반은 **가로**, 학생은 반 안에서 **세로**.
 * 전폭 표로 쌓으면 이름 칸이 창을 밀어 가로가 비고 반은 아래로만 길어진다.
 */
export function SeatJjTable(props: JjTableProps) {
  // 계획을 하나라도 그리면 **모든 열**을 그 폭으로 넓힌다 — 열마다 폭이 다르면 나란한 표가 어긋난다.
  const anyPlan = props.rosters.some((r) => props.plan?.plans[r.classId]);
  return (
    <div
      className="grid items-start gap-3 overflow-x-auto"
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
          statusOf={props.statusOf}
          noteOf={props.noteOf}
          onSaveNote={props.onSaveNote}
          showReason={props.showReason}
          hints={props.hints}
          onSave={props.onSave}
          onSaveField={props.onSaveField}
          onFillClass={props.onFillClass}
          readOnly={props.readOnly}
          pending={props.pending}
        />
      ))}
    </div>
  );
}

function SeatJjClass({
  roster: r,
  plan,
  statusOf,
  noteOf,
  onSaveNote,
  showReason,
  hints,
  onSave,
  onSaveField,
  onFillClass,
  readOnly,
  pending,
}: Omit<JjTableProps, "rosters"> & { roster: SeatClassRoster }) {
  const cols = jjSeatTextCols();
  const left = r.students.filter((s) => statusOf(r.classId, s) === null).length;
  const slotPlan = plan?.plans[r.classId];
  // 참조 고정 — 계획 블록이 `memo`라 인라인 화살표를 넘기면 memo가 매 렌더 깨진다.
  const onCarried = plan?.onCarried;
  const classId = r.classId;
  const handleCarried = useCallback(
    (patches: CarryPatch[]) => onCarried?.(classId, patches),
    [onCarried, classId],
  );
  return (
    <section className="border-line min-w-0 overflow-hidden rounded-2xl border">
      <header className="bg-bg-soft border-line flex flex-wrap items-center gap-2 border-b px-3 py-1.5 text-sm">
        <span className="min-w-0 truncate font-bold" title={r.className}>
          {r.className}
        </span>
        <span className="text-text-faint text-xs tabular-nums">{r.students.length}명</span>
        <span className="text-text-faint text-xs tabular-nums">~{r.end}</span>
        {!readOnly && left > 0 ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => onFillClass(r.classId)}
            className="border-line bg-card text-primary ml-auto rounded-full border px-2.5 py-0.5 text-xs font-semibold disabled:opacity-50"
          >
            이 반 출석
          </button>
        ) : null}
      </header>
      {/* 진도(수업계획) — ECS 교시 카드와 **같은 순서**(머리 → 진도 → 학생)이고 같은 기록·같은 저장 경로다.
          권한이 없는 반은 `plan.plans[classId]`가 없어 이 구획 자체가 안 생긴다. */}
      {plan && slotPlan ? (
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
        />
      ) : null}
      <table className="w-full table-fixed border-collapse text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-[var(--line-faint)]">
        {/* 여섯 칸 — 영어 시트 JJ 폼과 **같은 순서**(이름 · 출결 · 태도 · 자유 입력 · 특이사항).
            ⚠️ 폭은 %다(시트는 px). 이 표는 반 수만큼 열이 갈리는 격자 안에 들어가 폭이 고정이 아니다.
            특이사항은 width 없는 마지막 <col>이라 **잔여를 받는다**(시트와 같은 규약). */}
        <colgroup>
          <col style={{ width: "22%" }} />
          {/* 출결 — 2026-09-10: **세 버튼(출석·결석·지각)이 같은 폭으로 한 줄에** 서야 해서 20%→27%.
              두 글자 라벨 3개 + 간격이 들어갈 최소치다(실측: 440px 열 기준 칸당 ≈32px, 두 글자 28px +
              좌우 2px. 더 좁히면 글자가 칸을 넘는다, [[#116]]).
              🔑 늘린 몫은 **잔여를 받는 마지막 특이사항 칸**에서만 나온다(다른 칸은 안 줄어든다).
              ⚠️ 사유 입력칸이 팝업으로 내려가 이 칸의 세로 높이는 오히려 줄었다. */}
          <col style={{ width: "25%" }} />
          <col style={{ width: "14%" }} />
          {cols.map((c) => (
            <col key={c.field} style={{ width: c.field === "memorizedWords" ? "14%" : "12%" }} />
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
              <tr key={s.id} title={noteTitle ?? undefined}>
                {/* 이름 칸 — **가운데 정렬 + 좌우 여백 최소**(원장 2026-09-10: *"이름도 가운데정렬시켜주고
                    여백 최소화"*). 두 줄(이름 / 학교학년) 모두 가운데다.
                    ⚠️ 세로 여백은 그대로 둔다 — 줄 높이는 옆 칸의 출결 버튼이 정하고, 그 탭 타겟을 줄이면
                       폰에서 못 누른다(지시도 '좌우 여백'이었다). */}
                <td className="px-1 py-1.5 text-center">
                  <p className="truncate font-bold" title={noteTitle ? `${s.name} · ${noteTitle}` : s.name}>
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
                    onSet={(next) => onSaveField(r.classId, s.id, "attitude", next ?? "")}
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
                        maxLength={JJ_MARK_MAXLEN[field]}
                        aria-label={`${s.name} ${c.label}`}
                        title={c.title}
                        onChange={(e) => onSaveField(r.classId, s.id, field, e.target.value)}
                      />
                    </td>
                  );
                })}
                <td className="px-1 py-1.5">
                  <input
                    className={INPUT}
                    value={s.progressNote ?? ""}
                    disabled={readOnly}
                    maxLength={JJ_MARK_MAXLEN.progressNote}
                    aria-label={`${s.name} ${ROSTER_FIXED_LABEL.progressNote}`}
                    title="이 교시의 특이사항 — 영어 시트 JJ 칸과 같은 기록입니다"
                    onChange={(e) => onSaveField(r.classId, s.id, "progressNote", e.target.value)}
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
  pending: boolean;
  hints: SeatPeriodHintData;
  onSave: (classId: string, studentId: string, next: SeatStatus | null, prev: SeatStatus | null) => void;
  onSaveNote: (classId: string, studentId: string, note: string, status: SeatStatus | null) => void;
}) {
  const anchorRef = useRef<HTMLTableCellElement | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const canNote = showReason && !readOnly;

  return (
    <td ref={anchorRef} className="relative px-1 py-1.5" title={noteTitle ?? undefined}>
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
            onMark={(next) => {
              // 고른 것을 다시 누르면 미체크로([[#103]]). 결석·지각을 새로 고르면 사유 창이 이어서.
              const same = cur === next;
              onSave(classId, s.id, same ? null : next, cur);
              setNoteOpen(!same && canNote && (next === "absent" || next === "late"));
            }}
          />
        </div>
      </SeatNotePopover>
      {showReason ? <SeatMemoMark note={note} status={cur} /> : null}
      <div className="mt-1">
        <PrevAbsenceHint prev={s.prevAbsence} cur={cur} />
        {/* 같은 날 교시 사이 신호 — 앞 교시 결석 · 다음 행선지(표시 전용, 랩실과 같은 부품). */}
        <SeatPeriodHints
          prevAbsentStart={hints.prevAbsentByCell?.[seatCellKey(classId, s.id)]}
          nextStart={hints.nextStartByStudent?.[s.id]}
          nextRoom={hints.nextRoomByStudent?.[s.id]}
          seatName={hints.seatName}
          cur={cur}
        />
      </div>
    </td>
  );
}
