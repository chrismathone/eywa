"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ATTENDANCE_RATE_LEVELS, type AttendanceSalaryRates } from "@/features/attendance/salary-rates";
import { saveAttendanceSalaryRates } from "@/features/attendance/server/salary-rates-actions";

/** Only mounted by the authorized administrator server page. */
export function SalaryRatesButton({ teacherId, teacherName, month, rates, classes }: {
  teacherId: string; teacherName: string; month: string; rates: AttendanceSalaryRates;
  classes: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const next: AttendanceSalaryRates = { regular: {}, special: {}, classes: { ...rates.classes } };
    for (const kind of ["regular", "special"] as const) {
      for (const level of ATTENDANCE_RATE_LEVELS) {
        const raw = String(data.get(`${kind}:${level}`) ?? "").trim();
        if (raw) next[kind][level] = Number(raw);
      }
    }
    for (const cls of classes) {
      const raw = String(data.get(`class:${cls.id}`) ?? "").trim();
      if (raw) next.classes[cls.id] = Number(raw); else delete next.classes[cls.id];
    }
    setError("");
    startTransition(async () => {
      try {
        const result = await saveAttendanceSalaryRates({ teacherId, month, rates: next });
        if (!result.ok) { setError(result.error ?? "저장하지 못했습니다"); return; }
        setOpen(false);
        router.refresh();
      } catch { setError("저장하지 못했습니다. 다시 시도해 주세요."); }
    });
  }
  const input = "border-line bg-card w-20 rounded border px-2 py-1 text-right text-sm";
  return <>
    <button type="button" onClick={() => { setError(""); setOpen(true); }} className="border-line bg-card rounded border px-2 py-0.5 text-xs">비율 설정</button>
    <Dialog open={open} onOpenChange={(value) => { if (!pending) setOpen(value); }}>
      <DialogContent className="z-[90] sm:max-w-lg">
        <DialogTitle>{teacherName} · 급여 비율</DialogTitle>
        <DialogDescription>실급여 = 시수 × 단가 × 0.911 × 비율. 학생 학년에 맞는 정규·특강 비율을 적용합니다.</DialogDescription>
        <form onSubmit={(e) => { e.preventDefault(); submit(e.currentTarget); }}>
          <table className="w-full text-sm">
            <thead><tr><th className="text-left">수업 구분</th>{ATTENDANCE_RATE_LEVELS.map((level) => <th key={level}>{level}</th>)}</tr></thead>
            <tbody>{(["regular", "special"] as const).map((kind) => <tr key={kind}>
              <th className="py-2 text-left">{kind === "regular" ? "정규" : "특강"}</th>
              {ATTENDANCE_RATE_LEVELS.map((level) => <td key={level} className="py-2 text-center">
                <input aria-label={`${kind === "regular" ? "정규" : "특강"} ${level} 비율`} name={`${kind}:${level}`} type="number" min="0" max="100" step="0.01" placeholder="미설정" defaultValue={rates[kind][level] ?? ""} className={input} /> %
              </td>)}
            </tr>)}</tbody>
          </table>
          <details className="border-line mt-3 border-t pt-3">
            <summary className="cursor-pointer text-sm font-bold">반별 예외 비율</summary>
            <p className="text-text-dim my-2 text-xs">입력한 반은 위 비율보다 우선합니다. 비우면 정규·특강의 학년별 비율을 따릅니다.</p>
            {classes.map((cls) => <label key={cls.id} className="my-1 flex items-center justify-between gap-2 text-xs">
              <span>{cls.name}</span><span className="shrink-0"><input aria-label={`${cls.name} 비율`} name={`class:${cls.id}`} type="number" min="0" max="100" step="0.01" placeholder="기본 적용" defaultValue={rates.classes[cls.id] ?? ""} className={input} /> %</span>
            </label>)}
          </details>
          <p className="text-text-dim mt-3 text-xs">빈 비율은 미설정입니다. 단가나 비율이 없으면 실급여는 ‘—’로 표시합니다.</p>
          {error ? <p role="alert" className="text-danger mt-2 text-sm">{error}</p> : null}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" disabled={pending} onClick={() => setOpen(false)} className="border-line rounded border px-3 py-1 text-sm">취소</button>
            <button type="submit" disabled={pending} className="bg-primary rounded px-3 py-1 text-sm text-white">{pending ? "저장 중…" : "저장"}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
