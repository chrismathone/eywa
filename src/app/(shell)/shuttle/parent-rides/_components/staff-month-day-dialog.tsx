"use client";

import { useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatKoreanDate } from "@/lib/date-kst";
import { TONE_TEXT } from "@/lib/design/semantic-color";
import { MARK } from "@/features/shuttle/parent/month-mark";
import { needsAttention, staffDayDetail, type StaffDayDetail, type StaffDirDetail, type StaffMonthRow } from "@/features/shuttle/parent/staff-month";
import type { Season } from "@/features/shuttle/types";
import { StaffRideEdit } from "./staff-ride-edit";

const RECORD: Record<StaffDirDetail["records"][number], string> = { boarded: "탑승", extra: "추가 탑승", missed: "미탑승" };

/** "1호차 2회차 · 칠성초 정문 18:20" → "칠성초 정문 18:20" — 모달엔 어디·몇 시만(사용자 2026-10-16 "평소/그날 자리 말고 어디→어디 몇 시→몇 시만"). */
const place = (label: string) => label.replace(/^.*·\s*/, "");

/** 한 방향(등원·하원) 한 덩어리 — 표시 · 바뀐 곳("어디 몇 시 → 어디 몇 시") · 안 탐 사유 · 탑승 기록 · 바꾼 사람. */
function DirBlock({ d, future }: { d: StaffDirDetail; future: boolean }) {
  const m = d.mark ? MARK[d.mark] : null;
  const dirName = d.direction === "in" ? "등원" : "하원";
  const from = d.regular.map(place).join(" / ");
  return (
    <div className="bg-bg-soft flex min-w-0 flex-col gap-1 rounded-lg px-3 py-2 text-sm">
      <p className="flex items-baseline gap-2">
        <span className="text-text-dim font-bold">{dirName}</span>
        <b className={m ? m.tone : "text-text-dim"}>{m ? `${m.glyph} ${m.label}` : future ? "평소대로" : "기록 없음"}</b>
      </p>
      {d.added.map((a, i) => (
        <div key={i} className="break-keep">
          <p>
            {from ? <span className="text-text-dim">{from} → </span> : null}
            <b className={MARK.changed.tone}>{a.label ? place(a.label) : "자리 정보 없음"}</b>
            {from ? null : <span className="text-text-faint"> (새로 탐)</span>}
          </p>
          {a.memo || a.actor ? (
            <p className="text-text-dim text-xs">
              {a.memo}
              {a.actor ? <span className="text-text-faint">{a.memo ? " · " : ""}{a.actor}</span> : null}
            </p>
          ) : null}
        </div>
      ))}
      {d.skip ? (
        <p className="break-keep">
          <b className={MARK.skip.tone}>안 탐</b>
          {d.skip.memo ? <span className="text-text-dim"> — {d.skip.memo}</span> : null}
          {d.skip.actor ? <span className="text-text-faint"> ({d.skip.actor})</span> : null}
        </p>
      ) : null}
      {d.records.length > 0 ? <p className="text-text-dim">탑승 기록 · {d.records.map((r) => RECORD[r]).join(", ")}</p> : null}
    </div>
  );
}

/** 아이 한 명의 그날 — 이름 줄 + 등원·하원 두 덩어리. */
function StudentDay({ row, detail }: { row: StaffMonthRow; detail: StaffDayDetail }) {
  return (
    <section className="border-line-faint flex flex-col gap-1.5 border-b pb-3 last:border-b-0 last:pb-0">
      <h3 className="flex items-baseline gap-2">
        <span className="font-bold">{row.name}</span>
        {row.schoolGrade ? <span className="text-text-faint text-xs">{row.schoolGrade}</span> : null}
        {detail.absent ? <span className={cn("text-xs font-bold", TONE_TEXT.caution)}>결석</span> : null}
      </h3>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        <DirBlock d={detail.in} future={detail.future} />
        <DirBlock d={detail.out} future={detail.future} />
      </div>
    </section>
  );
}

export type DayDialogTarget = { date: string; studentId?: string };

/**
 * 직원 '학부모 등하원 → 월별' 상세 모달(사용자 2026-10-16 "날짜 내역을 클릭하면 모달로 상세히 · 아이별 한눈에도 확실히").
 * - 달력 날짜 → 그날 학원 전체: **챙길 일**(미탑승·결석·안 탐·변경) 아이 먼저, 그다음 탄 아이, 나머지는 이름만.
 * - 표 칸(아이 × 날짜) → 그 아이의 그날만.
 * 🔑 재료는 월별 표가 이미 가진 줄(`StaffMonthRow`)뿐 — 서버를 다시 부르지 않는다.
 * ✏️ [관리자 수정하기](사용자 2026-10-20 — [그날 일별로 보기]를 없애고 이 자리에) → 같은 창 안에서 아이 고르기 → 배차 → 이동/결석(`StaffRideEdit`).
 *    오늘~앞날만(지난 날은 그날의 기록) · 등하원을 바꿀 권한(`canRecordBoarding`)이 있을 때만.
 * 🔑 사유·바꾼 사람은 직원 화면에만 있다(학부모 월별은 사유를 내보내지 않는다).
 */
export function StaffMonthDayDialog({
  target,
  rows,
  today,
  season,
  canEdit,
  onClose,
}: {
  target: DayDialogTarget;
  rows: StaffMonthRow[];
  today: string;
  season: Season;
  canEdit: boolean;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const picked = target.studentId ? rows.filter((r) => r.id === target.studentId) : rows;
  const items = picked.flatMap((row) => {
    const detail = staffDayDetail(row, target.date, today);
    return detail ? [{ row, detail }] : [];
  });
  const holiday = items[0]?.detail.holiday ?? null;
  const single = Boolean(target.studentId);
  const past = target.date < today;
  const editable = canEdit && !holiday && !past;
  const attention = items.filter((x) => needsAttention(x.detail));
  const rode = items.filter((x) => !needsAttention(x.detail) && (x.detail.in.mark === "rode" || x.detail.out.mark === "rode"));
  const rest = items.filter((x) => !needsAttention(x.detail) && x.detail.in.mark !== "rode" && x.detail.out.mark !== "rode");

  return (
    <Dialog open onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="z-[90] max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {formatKoreanDate(target.date)}
            {single && items[0] ? ` · ${items[0].row.name}` : ""}
          </DialogTitle>
          <DialogDescription>
            {holiday
              ? `학원이 쉬는 날 · ${holiday}`
              : single
                ? "그날 등원·하원 — 바뀐 곳(어디 몇 시 → 어디 몇 시) · 사유 · 바꾼 사람 · 탑승 기록입니다."
                : `셔틀 ${items.length}명 · 챙길 일 ${attention.length}명 · 탔음 ${rode.length}명`}
          </DialogDescription>
        </DialogHeader>

        {editing ? (
          <StaffRideEdit
            date={target.date}
            season={season}
            initialStudent={single && items[0] ? { id: items[0].row.id, name: items[0].row.name, schoolGrade: items[0].row.schoolGrade } : null}
            shuttleIds={new Set(rows.map((r) => r.id))}
            onBack={() => setEditing(false)}
          />
        ) : holiday ? null : single ? (
          items[0] ? <StudentDay row={items[0].row} detail={items[0].detail} /> : null
        ) : (
          <div className="flex flex-col gap-4">
            {attention.length > 0 ? (
              <div className="flex flex-col gap-3">
                <h3 className={cn("text-sm font-bold", TONE_TEXT.caution)}>챙길 일 {attention.length}명</h3>
                {attention.map((x) => (
                  <StudentDay key={x.row.id} row={x.row} detail={x.detail} />
                ))}
              </div>
            ) : null}
            {rode.length > 0 ? (
              <div className="flex flex-col gap-3">
                <h3 className={cn("text-sm font-bold", MARK.rode.tone)}>탔음 {rode.length}명</h3>
                {rode.map((x) => (
                  <StudentDay key={x.row.id} row={x.row} detail={x.detail} />
                ))}
              </div>
            ) : null}
            {rest.length > 0 ? (
              <div className="flex flex-col gap-1">
                <h3 className="text-text-dim text-sm font-bold">
                  {target.date > today ? "바뀐 것 없음" : "기록·변경 없음"} {rest.length}명
                </h3>
                <p className="text-text-dim text-sm break-keep">{rest.map((x) => x.row.name).join(", ")}</p>
              </div>
            ) : null}
            {items.length === 0 ? <p className="text-text-dim text-sm">이 날 셔틀 기록이 없습니다.</p> : null}
          </div>
        )}

        {editing ? null : (
          <div className="flex flex-col gap-1">
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="border-line flex h-11 flex-1 items-center justify-center rounded-lg border text-sm font-bold">
                닫기
              </button>
              {editable ? (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="bg-primary text-primary-foreground flex h-11 flex-1 items-center justify-center rounded-lg text-sm font-bold"
                >
                  관리자 수정하기
                </button>
              ) : null}
            </div>
            {canEdit && !holiday && past ? <p className="text-text-faint text-center text-xs">지난 날짜는 그날의 기록이라 수정할 수 없어요.</p> : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
