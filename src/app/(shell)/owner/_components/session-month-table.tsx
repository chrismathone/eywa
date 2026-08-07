"use client";

import { Check, TriangleAlert } from "@/components/icons/eywa-icon-compat";
import type { verifyPeriodShape } from "@/features/periods/verify";

export type Row = { month: number; start: string; end: string };
type Check = ReturnType<typeof verifyPeriodShape>;

const INPUT = "border-border bg-card text-foreground rounded-md border px-2 py-1 text-sm tabular-nums";

/**
 * 세션 12행 표 — 시작·끝만 치면 되고, 오른쪽 칸이 "월~금 각 4회"를 실시간으로 검산한다.
 * 검산은 **경고만** 한다(막지 않는다) — 방학·휴원으로 일부러 짧은 달이 있고, 법정공휴일과
 * 학원 휴원일이 달라 기계 판단이 틀릴 수 있다.
 */
export function SessionMonthTable({
  rows,
  checks,
  errByMonth,
  onChange,
}: {
  rows: readonly Row[];
  checks: Map<number, Check>;
  errByMonth: Map<number, string>;
  onChange: (month: number, patch: Partial<Row>) => void;
}) {
  return (
    <div className="border-line overflow-hidden rounded-xl border">
      <table className="w-full text-sm">
        <colgroup>
          <col className="w-14" />
          <col className="w-28" />
          <col className="w-28" />
          <col />
        </colgroup>
        <thead className="bg-surface text-text-dim">
          <tr>
            <th className="px-2 py-1.5 text-left text-[11px] font-bold">월</th>
            <th className="px-2 py-1.5 text-left text-[11px] font-bold">시작</th>
            <th className="px-2 py-1.5 text-left text-[11px] font-bold">끝</th>
            <th className="px-2 py-1.5 text-left text-[11px] font-bold">수업 횟수 (월~금 각 4회 기준)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const check = checks.get(r.month);
            const err = errByMonth.get(r.month);
            const filled = r.start.trim() && r.end.trim();
            return (
              <tr key={r.month} className="border-line border-t">
                <td className="text-text-dim px-2 py-1 text-[12px] font-bold">{r.month}월</td>
                <td className="px-2 py-1">
                  <input
                    value={r.start}
                    onChange={(e) => onChange(r.month, { start: e.target.value })}
                    placeholder="3/6"
                    aria-label={`${r.month}월 세션 시작일`}
                    aria-invalid={err ? true : undefined}
                    className={`${INPUT} w-24`}
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    value={r.end}
                    onChange={(e) => onChange(r.month, { end: e.target.value })}
                    placeholder="4/2"
                    aria-label={`${r.month}월 세션 끝일`}
                    aria-invalid={err ? true : undefined}
                    className={`${INPUT} w-24`}
                  />
                </td>
                <td className="px-2 py-1 text-[12px]">
                  {!filled ? (
                    <span className="text-text-faint">세션 없음 (달력월로 표시됩니다)</span>
                  ) : err ? (
                    <span className="text-danger">{err}</span>
                  ) : check?.ok ? (
                    // 넘침(공휴일 보정으로 5회가 된 요일)은 결함이 아니라 사실 안내 — 통과로 두고 회색 설명만.
                    <span className="text-green inline-flex items-start gap-1">
                      <Check className="mt-0.5 size-3.5 shrink-0" />
                      {check.note ? (
                        <span>
                          모든 요일 4회 이상 <span className="text-text-faint">· {check.note}</span>
                        </span>
                      ) : (
                        <span>월·화·수·목·금 각 4회</span>
                      )}
                    </span>
                  ) : check ? (
                    <span className="text-amber inline-flex items-start gap-1">
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                      <span>{check.warning}</span>
                    </span>
                  ) : (
                    <span className="text-danger">날짜를 읽을 수 없습니다 (예: 3/6~4/2)</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
