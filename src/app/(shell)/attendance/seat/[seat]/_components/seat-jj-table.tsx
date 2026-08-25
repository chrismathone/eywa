"use client";

import { useCallback } from "react";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { SlotPlanBlock } from "@/features/class-sheets/components/slot-plan-block";
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
import type { SeatClassRoster } from "@/features/attendance/seat/server/queries";
import type { SeatStatus } from "@/features/attendance/seat/server/actions";
import { SEAT_LABEL, SEAT_TONE } from "./seat-status";

const INPUT =
  "border-line focus:border-primary h-8 w-full rounded-lg border bg-card px-2 text-[13px] font-semibold outline-none disabled:opacity-60";

/**
 * 진도(수업계획) 구획을 그리는 데 필요한 것 한 묶음 — **없으면 구획 자체가 안 생긴다**.
 * 🔴 공개 PIN 화면(`/seat/jj`)과 ECS 권한이 없는 계정에는 이 prop이 아예 안 내려온다
 *    (권한 판정은 서버 `loadSeatJjPlans`가 반마다 `requireEcsClassAccess`로 한다 — 화면 조건은 게이트가 아니다).
 */
export type SeatPlanContext = {
  /** 반 id → 그 교시 계획. **키가 없는 반은 계획을 볼 권한이 없는 반**이다. */
  plans: Record<string, SeatClassPlan>;
  tenantId: string;
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
      <header className="bg-bg-soft border-line flex flex-wrap items-center gap-2 border-b px-3 py-1.5 text-[13px]">
        <span className="min-w-0 truncate font-bold" title={r.className}>
          {r.className}
        </span>
        <span className="text-text-faint text-[11px] tabular-nums">{r.students.length}명</span>
        <span className="text-text-faint text-[11px] tabular-nums">~{r.end}</span>
        {!readOnly && left > 0 ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => onFillClass(r.classId)}
            className="border-line bg-card text-primary ml-auto rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold disabled:opacity-50"
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
      <table className="w-full table-fixed border-collapse text-[13px] [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-[var(--line-faint)]">
        <colgroup>
          <col style={{ width: "28%" }} />
          <col style={{ width: "20%" }} />
          {cols.map((c) => (
            <col key={c.field} />
          ))}
        </colgroup>
        <thead>
          <tr className="bg-bg-soft text-foreground text-[11px]">
            <th className="px-2 py-1.5 text-center font-bold">이름</th>
            <th className="px-1 py-1.5 text-center font-bold">출결</th>
            {cols.map((c) => (
              <th key={c.field} className="px-1 py-1.5 text-center leading-tight font-bold" title={c.title}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {r.students.map((s) => {
            const cur = statusOf(r.classId, s);
            return (
              <tr key={s.id}>
                <td className="px-2 py-1.5">
                  <p className="truncate font-bold" title={s.name}>
                    {s.name}
                  </p>
                  <p className="text-text-dim truncate text-[11.5px]">
                    {schoolGradeLabel(s.school, s.grade) || " "}
                  </p>
                </td>
                <td className="px-1 py-1.5">
                  <div className="flex flex-wrap items-center justify-center gap-1">
                    <button
                      type="button"
                      disabled={readOnly || pending}
                      onClick={() => onSave(r.classId, s.id, cur === "present" ? null : "present", cur)}
                      className={`min-w-[40px] rounded-lg border px-1.5 py-1 text-[12px] font-bold disabled:cursor-default ${
                        cur ? SEAT_TONE[cur] : "border-line bg-card border-dashed text-text-dim"
                      }`}
                    >
                      {cur ? SEAT_LABEL[cur] : "출석"}
                    </button>
                    {!readOnly && cur !== "absent" ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => onSave(r.classId, s.id, "absent", cur)}
                        aria-label={`${s.name} 결석`}
                        className="border-line bg-card text-text-faint hover:text-att-absent-ink grid size-6 place-items-center rounded-full border text-[10px] font-bold"
                      >
                        결
                      </button>
                    ) : null}
                  </div>
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
                        maxLength={JJ_MARK_MAXLEN}
                        aria-label={`${s.name} ${c.label}`}
                        title={c.title}
                        onChange={(e) => onSaveField(r.classId, s.id, field, e.target.value)}
                      />
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
