"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ATTENDANCE_RATE_LEVELS, type AttendanceSalaryRates } from "@/features/attendance/salary-rates";
import { saveAttendanceSalaryRates } from "@/features/attendance/server/salary-rates-actions";
import { WORKDAYS } from "@/features/staff/resume";
import type { WorkDay } from "@/features/staff/employment";

/**
 * Only mounted by the authorized administrator server page.
 * `mixed` = 계약구분 '혼합'(근로 + 용역, 원장 2026-10-16) — 대상 학년이 곧 용역 학년이라 전부 고를 수 없고, 근로 요일 칸이 선다.
 */
export function SalaryRatesButton({ teacherId, teacherName, month, rates, classes, mixed = false }: {
  teacherId: string; teacherName: string; month: string; rates: AttendanceSalaryRates;
  classes: { id: string; name: string }[]; mixed?: boolean;
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
    // 대상 학년 — 전부 고르면 '전체'(저장하지 않는다). 하나도 안 고르면 아무도 계산되지 않으므로 받지 않는다.
    const picked = ATTENDANCE_RATE_LEVELS.filter((level) => data.get(`level:${level}`) === "on");
    if (picked.length === 0) { setError("대상 학년을 하나 이상 골라 주세요"); return; }
    // 혼합 계약 — 전부 고르면 근로 몫이 없어진다(프리랜서와 같다).
    if (mixed && picked.length === ATTENDANCE_RATE_LEVELS.length) { setError("혼합 계약은 용역 학년만 골라 주세요(전부 고르면 프리랜서와 같습니다)"); return; }
    if (picked.length < ATTENDANCE_RATE_LEVELS.length) next.levels = picked;
    if (data.get("includeSpecial") === "on") next.includeSpecial = true;
    // 근로 요일 — 이 창에서 **바꿨을 때만** 보낸다(비우면 `[]` = 정하지 않음). 안 보내면 서버가 저장된 값을 그대로 둔다 — 열어 둔 다른 창
    // (출석부 ↔ 직원 상세)에서 비율만 고쳐 저장해도 그 사이 바꾼 근로 요일이 옛 값으로 덮이지 않게(적대 리뷰 2026-10-16).
    if (mixed) {
      const picked = WORKDAYS.filter((d) => data.get(`workday:${d.key}`) === "on").map((d) => d.key as WorkDay);
      if (picked.join("|") !== (rates.workDays ?? []).join("|")) next.workDays = picked;
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
        <DialogDescription>실급여 = 시수 × 단가 × 0.911 × 비율(시수 × 단가가 청구액보다 많으면 청구액으로 계산 — 여럿이 나눠 맡는 반은 청구액 중 이 선생님 몫). 학생 학년에 맞는 정규·특강 비율을 적용합니다.</DialogDescription>
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
          {/* 대상 학년(원장 2026-10-07 — 고등학생에게만 프리랜서를 적용하는 선생님). 기준은 학생 학년이다(반 이름 아님). */}
          <div role="group" aria-label="대상 학년" className="border-line mt-3 border-t pt-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-sm font-bold">대상 학년</span>
              {ATTENDANCE_RATE_LEVELS.map((level) => <label key={level} className="inline-flex items-center gap-1 text-sm">
                <input type="checkbox" name={`level:${level}`} defaultChecked={!rates.levels?.length || rates.levels.includes(level)} />
                {level}
              </label>)}
            </div>
            <label className="mt-2 flex items-center gap-1 text-sm">
              <input type="checkbox" name="includeSpecial" defaultChecked={rates.includeSpecial === true} />
              특강은 학년 제한 없이 포함
            </label>
            <p className="text-text-dim mt-2 text-xs break-keep">고른 학년의 학생만 실급여와 급여명세서(출석부 별지 포함)에 들어갑니다. 특강 포함을 켜면 다른 학년의 특강도 계산합니다. 이 선생님에게만 적용하며, 단가·배분율·청구액 상한은 그대로 따릅니다.{mixed ? " 혼합 계약이라 고른 학년이 용역(프리랜서) 몫입니다." : ""}</p>
          </div>
          {mixed ? (
            <div role="group" aria-label="근로 요일" className="border-line mt-3 border-t pt-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-sm font-bold">근로 요일</span>
                {WORKDAYS.map((d) => <label key={d.key} className="inline-flex items-center gap-1 text-sm">
                  <input type="checkbox" name={`workday:${d.key}`} defaultChecked={rates.workDays?.includes(d.key as WorkDay) ?? false} />
                  {d.label}
                </label>)}
              </div>
              <p className="text-text-dim mt-2 text-xs break-keep">혼합 계약의 근로 몫 요일입니다. 강사평가 근태는 이 요일만 셉니다(나머지 요일은 프리랜서처럼 세지 않습니다). 비우면 모든 요일을 셉니다. 금액에는 쓰지 않습니다.</p>
            </div>
          ) : null}
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
