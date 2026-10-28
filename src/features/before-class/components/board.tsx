"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Toolbar, ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { shortDateLabel } from "../dates";
import { isBlankCheck, needsSupplement, type BeforeClassCheck } from "../items";
import { saveBeforeClassCheck } from "../server/actions";
import { checkKey, type RosterStudent } from "../types";
import { CheckTable } from "./check-table";
import { MonthTable } from "./month-table";

/**
 * 반 하나 × 달 하나의 작업면 — 달 자료를 한 번 받아 두고 날짜·보기 전환은 화면 안에서 한다(서버 왕복 없음, B7).
 * 칸을 바꾸면 화면이 먼저 바뀌고 저장은 뒤에서 한다. 같은 학생·날짜 칸의 저장은 **차례대로** 보낸다 — 빠르게 여러 번
 * 누르면 늦게 도착한 옛 값이 새 값을 덮을 수 있어서다. 저장이 실패하면 그 칸을 서버가 마지막으로 확인한 값으로 되돌린다.
 */
export function ChecklistBoard({
  classId, dates, students, initialChecks, initialDate, today, canEdit,
}: {
  classId: string;
  dates: string[];
  students: RosterStudent[];
  initialChecks: Record<string, BeforeClassCheck>;
  initialDate: string | null;
  today: string;
  canEdit: boolean;
}) {
  const [checks, setChecks] = useState(initialChecks);
  const [date, setDate] = useState(initialDate);
  const [view, setView] = useState<"check" | "month">("check");
  const queues = useRef(new Map<string, Promise<unknown>>());
  // 서버가 확인한 마지막 값 — 실패하면 화면을 여기로 되돌린다(저장된 적 없는 값을 남기지 않는다).
  const saved = useRef(new Map<string, BeforeClassCheck | undefined>(Object.entries(initialChecks)));

  const change = (studentId: string, next: BeforeClassCheck) => {
    if (!date || !canEdit) return;
    const key = checkKey(studentId, date);
    setChecks((c) => {
      const copy = { ...c };
      if (isBlankCheck(next)) delete copy[key];
      else copy[key] = next;
      return copy;
    });
    const run = async () => {
      const res = await saveBeforeClassCheck({ classId, studentId, date, missed: next.missed, absent: next.absent, card: next.card });
      if (res.ok) {
        saved.current.set(key, isBlankCheck(next) ? undefined : next);
        return;
      }
      toast.error(res.error);
      // 그 사이 같은 칸을 또 바꿨으면 그 값을 지킨다(이 저장의 값이 아직 화면에 있을 때만 되돌린다).
      setChecks((c) => {
        const stillMine = isBlankCheck(next) ? !(key in c) : c[key] === next;
        if (!stillMine) return c;
        const copy = { ...c };
        const last = saved.current.get(key);
        if (last) copy[key] = last;
        else delete copy[key];
        return copy;
      });
    };
    const chained = (queues.current.get(key) ?? Promise.resolve()).then(run, run);
    queues.current.set(key, chained);
  };

  const dayStudents = date ? students.filter((s) => s.activeDates.includes(date)) : [];
  const dayChecks = Object.fromEntries(dayStudents.map((s) => [s.id, date ? checks[checkKey(s.id, date)] : undefined]));
  const supplement = dayStudents.filter((s) => { const c = dayChecks[s.id]; return c ? needsSupplement(c) : false; }).length;
  const absent = dayStudents.filter((s) => dayChecks[s.id]?.absent).length;

  return (
    <div className="space-y-3">
      <Toolbar>
        <ToolbarSegment label="보기">
          <ToolbarSegmentItem active={view === "check"} onClick={() => setView("check")}>체크</ToolbarSegmentItem>
          <ToolbarSegmentItem active={view === "month"} onClick={() => setView("month")}>월별 현황</ToolbarSegmentItem>
        </ToolbarSegment>
        {view === "check" && dates.length > 0 ? (
          <ToolbarSegment label="수업일" wrap>
            {dates.map((d) => (
              <ToolbarSegmentItem key={d} active={d === date} onClick={() => setDate(d)}>{shortDateLabel(d)}</ToolbarSegmentItem>
            ))}
          </ToolbarSegment>
        ) : null}
      </Toolbar>

      {dates.length === 0 ? (
        <p className="text-text-dim px-1 py-6 text-sm">이 달에는 이 반의 수업일이 없습니다.</p>
      ) : view === "month" ? (
        <MonthTable dates={dates} students={students} checks={checks} today={today} onPickDate={(d) => { setDate(d); setView("check"); }} />
      ) : (
        <>
          <p className="text-text-dim px-1 text-sm">
            {date ? shortDateLabel(date) : ""} · 학생 {dayStudents.length}명 · 보충 필요 {supplement}명 · 결석 {absent}명
            {canEdit ? " · 체크한 칸 = 미흡(누르면 바로 저장)" : " · 보기 전용"}
          </p>
          <CheckTable students={dayStudents} checks={dayChecks} canEdit={canEdit} onChange={change} />
        </>
      )}
    </div>
  );
}
