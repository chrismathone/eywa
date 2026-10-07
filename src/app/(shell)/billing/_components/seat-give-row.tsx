"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { loadSeatGiveSheet, saveSeatGives, type SeatGiveSheet } from "@/features/attendance/server/seat-give-actions";
import { seatGiveKey, type SeatGiveChange } from "@/features/attendance/seat-give";
import { formatSessionUnits } from "@/features/attendance/session-units";

/**
 * 회차 확정의 **JJ실 줄**(원장 2026-10-07 *"지금 회차 확정에 JJ가 없으니까 이 고생을 하고 있는데, 회차 확정에 JJ반이 생기면 거기서 주면
 * 그냥 쉽게 해결할 수 있는것 같은데?"* → 선택: JJ 줄 + 날짜 골라 주기). JJ실 교시가 있는 반의 묶음 맨 아래에 한 줄 서고,
 * [선생님에게 주기]를 누르면 그 달 JJ실 기록이 날짜별로 뜬다 — 대신 수업한 날짜에 선생님을 고르면 그 날 시수가 그 선생님 몫이 된다
 * (JJ실 −, 선생님 + · 출석부 시수 · 실급여 · 명세서 모두). 날짜를 펼치면 학생마다 따로 고를 수 있다.
 *
 * 🔴 권한자 화면에만 선다(서버가 재료를 줄 때만). 저장 액션이 같은 문을 다시 본다(#77).
 * 🔴 줄은 **반마다 하나**다 — 학생마다 세우면 표가 두 배로 길어진다. 학생별 선택은 창 안에서 한다.
 * ⚠️ 표는 창을 열 때 읽는다(반 × 한 달 기록) — 회차 확정 첫 화면에 싣지 않는다(B7).
 */
const JJ = ""; // 'JJ실 그대로'
const MIXED = "mixed"; // 교시마다 몫이 다르다(건드리지 않으면 그대로 둔다)
const VARIES = "varies"; // 그 날짜의 학생마다 다르다(날짜 줄 표시용)
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

const dayLabel = (date: string) => {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}(${DOW[new Date(`${date}T00:00:00Z`).getUTCDay()]})`;
};

export function SeatGiveRow({
  classId,
  className,
  period,
  given,
}: {
  classId: string;
  className: string;
  period: string;
  /** 이미 준 시수(선생님마다) — 한 줄 요약. */
  given: readonly { teacherId: string; name: string; units: number }[];
}) {
  const [sheet, setSheet] = useState<SeatGiveSheet | null>(null);
  const [error, setError] = useState("");
  const [loading, startLoading] = useTransition();
  const open = () => {
    setError("");
    startLoading(async () => {
      try {
        const result = await loadSeatGiveSheet({ classId, period });
        if (result.ok) setSheet(result.sheet);
        else setError(result.error);
      } catch {
        setError("JJ실 기록을 불러오지 못했습니다. 다시 눌러 주세요.");
      }
    });
  };
  return (
    <tr className="border-border/60 border-t" data-seat-give-row>
      <td />
      <td colSpan={10} className="px-3 py-1.5">
        <div className="sticky left-3 inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="text-foreground font-bold">└ JJ실</span>
          <span className="text-text-dim break-keep">
            {given.length > 0
              ? `선생님에게 준 시수 — ${given.map((g) => `${g.name} ${formatSessionUnits(g.units)}`).join(" · ")}`
              : "선생님에게 준 시수 없음"}
          </span>
          <button
            type="button"
            onClick={open}
            disabled={loading}
            className="border-line bg-card hover:bg-bg-soft rounded-md border px-2 py-0.5 text-xs font-bold disabled:opacity-50"
          >
            {loading ? "불러오는 중…" : "선생님에게 주기"}
          </button>
          {error ? <span role="alert" className="text-danger break-keep">{error}</span> : null}
        </div>
        {sheet ? <SeatGiveDialog className={className} sheet={sheet} onClose={() => setSheet(null)} /> : null}
      </td>
    </tr>
  );
}

function SeatGiveDialog({ className, sheet, onClose }: { className: string; sheet: SeatGiveSheet; onClose: () => void }) {
  const router = useRouter();
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const initial = (studentId: string, date: string): string | null => {
    const cell = sheet.cells[studentId]?.[date];
    if (!cell) return null; // 그 학생은 그 날 JJ실 기록이 없다
    return cell.holder === null ? JJ : cell.holder;
  };
  const [picked, setPicked] = useState<Record<string, string>>({});
  const valueOf = (studentId: string, date: string) => picked[seatGiveKey(studentId, date)] ?? initial(studentId, date);
  const studentsOn = (date: string) => sheet.students.filter((s) => sheet.cells[s.id]?.[date]);
  const dateValue = (date: string) => {
    const values = new Set(studentsOn(date).map((s) => valueOf(s.id, date)));
    return values.size === 1 ? [...values][0]! : VARIES;
  };
  const setDate = (date: string, value: string) =>
    setPicked((current) => {
      const next = { ...current };
      for (const s of studentsOn(date)) next[seatGiveKey(s.id, date)] = value;
      return next;
    });
  /** 그 날짜에서 고른 것을 전부 지운다 — 처음 상태(학생마다 다름 · 교시마다 다름 · 지금 담당이 아닌 선생님)가 무엇이었든 되돌아간다. */
  const resetDate = (date: string) =>
    setPicked((current) => {
      const next = { ...current };
      for (const s of studentsOn(date)) delete next[seatGiveKey(s.id, date)];
      return next;
    });
  const dateTouched = (date: string) => studentsOn(date).some((s) => valueOf(s.id, date) !== initial(s.id, date));
  const changes: SeatGiveChange[] = sheet.students.flatMap((s) =>
    sheet.dates.flatMap((date) => {
      const before = initial(s.id, date);
      const now = valueOf(s.id, date);
      return before === null || now === null || now === before || now === MIXED ? [] : [{ studentId: s.id, date, teacherId: now === JJ ? null : now }];
    }),
  );
  // 선택지 — 받을 수 있는 선생님 + (지금은 후보가 아니어도) 이미 받은 선생님.
  const holderIds = [...new Set(sheet.students.flatMap((s) => sheet.dates.map((date) => sheet.cells[s.id]?.[date]?.holder)).filter((h): h is string => !!h && h !== MIXED))];
  const extra = holderIds.filter((id) => !sheet.teachers.some((t) => t.id === id));
  // '교시마다 다름'·'학생마다 다름'은 지금 상태를 보여 주는 표시일 뿐 고를 수 없다 — 처음 상태로 돌아가려면 그 날짜의 [되돌리기].
  const options = (current: string | null) => (
    <>
      <option value={JJ}>JJ실 그대로</option>
      {sheet.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      {extra.map((id) => <option key={id} value={id} disabled>{sheet.names[id] ?? "선생님"}(지금 담당 아님)</option>)}
      {current === MIXED ? <option value={MIXED} disabled>교시마다 다름</option> : null}
      {current === VARIES ? <option value={VARIES} disabled>학생마다 다름</option> : null}
    </>
  );
  const select = "border-input bg-card rounded-md border px-2 py-1 text-xs";
  const [, month] = sheet.period.split("-");

  function save() {
    setError("");
    startSaving(async () => {
      try {
        const result = await saveSeatGives({ classId: sheet.classId, period: sheet.period, changes });
        if (!result.ok) {
          setError(result.error ?? "시수를 주지 못했습니다. 다시 눌러 주세요.");
          return;
        }
        toast.success(`${className} — JJ실 ${formatSessionUnits(result.units ?? 0)}시수(${result.changed ?? 0}칸)의 몫을 바꿨습니다`);
        onClose();
        router.refresh();
      } catch {
        setError("시수를 주지 못했습니다. 다시 눌러 주세요.");
      }
    });
  }

  return (
    <Dialog open onOpenChange={(value) => { if (!value && !saving) onClose(); }}>
      <DialogContent className="z-[90] max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogTitle>{className} · {Number(month)}월 JJ실 시수</DialogTitle>
        <DialogDescription className="break-keep">
          선생님이 JJ실 수업을 대신한 날짜에 그 선생님을 고르세요. 그 날 JJ실 시수가 그 선생님 몫이 됩니다(JJ실 −, 선생님 + · 출석부 시수와 실급여에 함께 반영).
          학생마다 다르면 날짜를 펼쳐 따로 고릅니다.
        </DialogDescription>
        {sheet.dates.length === 0 ? (
          <p className="text-text-dim py-4 text-sm break-keep">이 달에는 이 반의 JJ실 출결 기록이 없습니다. JJ실 출석부에 출결이 찍힌 뒤에 줄 수 있습니다.</p>
        ) : (
          <>
            {sheet.teachers.length === 0 ? (
              <p role="alert" className="text-danger text-sm break-keep">이 반을 맡은 선생님이 없어 줄 수 없습니다(되돌리기만 가능).</p>
            ) : null}
            <table className="w-full text-sm">
              <thead>
                <tr className="text-text-dim text-xs">
                  <th className="py-1 text-left font-medium">날짜</th>
                  <th className="py-1 text-left font-medium">JJ실 기록</th>
                  <th className="py-1 text-left font-medium">이 날 시수의 몫</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {sheet.dates.map((date) => {
                  const students = studentsOn(date);
                  const units = students.reduce((sum, s) => sum + (sheet.cells[s.id]?.[date]?.units ?? 0), 0);
                  const value = dateValue(date);
                  const isOpen = expanded.has(date);
                  return [
                    <tr key={date} className="border-line border-t">
                      <td className="num py-1.5 whitespace-nowrap">{dayLabel(date)}</td>
                      <td className="text-text-dim num py-1.5 text-xs whitespace-nowrap">{students.length}명 · {formatSessionUnits(Math.round(units * 10) / 10)}시수</td>
                      <td className="py-1.5">
                        <select aria-label={`${dayLabel(date)} 시수의 몫`} className={select} value={value ?? JJ} disabled={saving} onChange={(e) => { if (e.target.value !== MIXED && e.target.value !== VARIES) setDate(date, e.target.value); }}>
                          {options(value)}
                        </select>
                      </td>
                      <td className="py-1.5 text-right whitespace-nowrap">
                        {/* 잘못 고른 날짜를 창을 닫지 않고 처음 상태로 — 'JJ실 그대로'로 취소하면 이미 준 칸까지 되돌려 버린다. */}
                        {dateTouched(date) ? (
                          <button type="button" disabled={saving} className="text-primary mr-2 text-xs underline" aria-label={`${dayLabel(date)} 되돌리기`} onClick={() => resetDate(date)}>
                            되돌리기
                          </button>
                        ) : null}
                        <button type="button" className="text-text-dim hover:text-foreground text-xs underline" aria-expanded={isOpen}
                          onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(date)) next.delete(date); else next.add(date); return next; })}>
                          {isOpen ? "접기" : "학생별"}
                        </button>
                      </td>
                    </tr>,
                    isOpen ? (
                      <tr key={`${date}-students`}>
                        <td />
                        <td colSpan={3} className="pb-2">
                          <ul className="bg-bg-soft/50 space-y-1 rounded-lg px-2 py-1.5">
                            {students.map((s) => {
                              const current = valueOf(s.id, date);
                              return (
                                <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
                                  <span className="min-w-0 truncate">{s.name} <span className="text-text-dim num">{formatSessionUnits(sheet.cells[s.id]![date]!.units)}시수</span></span>
                                  <select aria-label={`${s.name} ${dayLabel(date)} 시수의 몫`} className={select} value={current ?? JJ} disabled={saving}
                                    onChange={(e) => { if (e.target.value !== MIXED) setPicked((cur) => ({ ...cur, [seatGiveKey(s.id, date)]: e.target.value })); }}>
                                    {options(current)}
                                  </select>
                                </li>
                              );
                            })}
                          </ul>
                        </td>
                      </tr>
                    ) : null,
                  ];
                })}
              </tbody>
            </table>
          </>
        )}
        {error ? <p role="alert" className="text-danger mt-2 text-sm break-keep">{error}</p> : null}
        <div className="mt-4 flex items-center justify-end gap-2">
          <span className="text-text-dim mr-auto text-xs">{changes.length > 0 ? `바꾼 칸 ${changes.length}개` : "바꾼 칸 없음"}</span>
          <button type="button" disabled={saving} onClick={onClose} className="border-line rounded border px-3 py-1 text-sm">닫기</button>
          <button type="button" disabled={saving || changes.length === 0} onClick={save} className="bg-primary rounded px-3 py-1 text-sm text-white disabled:opacity-50">
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
