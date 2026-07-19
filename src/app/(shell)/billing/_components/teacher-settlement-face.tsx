import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { currentPeriod } from "@/features/billing/calc";
import { getTeacherSettlementView } from "@/features/payroll/server/settlement-queries";
import type { SettlementStatus, TeacherSettlement } from "@/features/payroll/settlement";
import { EyIcon } from "@/components/icons/eywa-icons";
import { TeacherCompEditor } from "./teacher-comp-editor";

function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y!, (m ?? 1) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const fmtWon = (n: number) => `${n.toLocaleString("ko-KR")}원`;

const STATUS_NOTE: Record<Exclude<SettlementStatus, "computed">, string> = {
  unset: "급여 방식 미설정",
  unassigned: "담당 강사 미배정",
  missing_rate: "배분율 미입력",
  missing_base: "기본급 미입력",
};

/**
 * 강사 정산(참고) 면 — 급여 연계 v1. **원장 전용, 읽기전용**(payroll_records 미기록).
 * 저장된 splits 스냅샷을 담당 강사(teacher_id) 단위로 묶어 급여 정책(비율제/급여제/혼합)을 적용.
 * 지급 기준 = 청구(confirmed), 실측/diff는 신호로만(P1/P2). docs/payroll-linkage-plan.md.
 */
export async function TeacherSettlementFace({ period }: { period?: string }) {
  const user = await getCurrentUser();
  // 급여 = 원장 전용 PII. master 외에는 화면 자체를 막는다.
  if (!user || user.systemRole !== "master") {
    return (
      <div className="border-line text-text-dim rounded-lg border border-dashed p-10 text-center text-sm">
        강사 정산(급여)은 <b>원장</b>만 열람할 수 있습니다.
      </div>
    );
  }

  const p = period && /^\d{4}-\d{2}$/.test(period) ? period : currentPeriod();
  const view = await getTeacherSettlementView(p);
  const [y, m] = p.split("-");
  const isComputable = (r: TeacherSettlement) => r.status === "computed";

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href={`/billing?tab=payroll&period=${shiftPeriod(p, -1)}`}
            className="border-line text-text-dim hover:text-foreground rounded-md border px-2 py-1 text-xs"
            aria-label="이전 달"
          >
            <EyIcon name="chevronLeft" size={14} />
          </Link>
          <span className="text-foreground num text-sm font-bold">
            {y}년 {Number(m)}월
          </span>
          <Link
            href={`/billing?tab=payroll&period=${shiftPeriod(p, 1)}`}
            className="border-line text-text-dim hover:text-foreground rounded-md border px-2 py-1 text-xs"
            aria-label="다음 달"
          >
            <EyIcon name="chevronRight" size={14} />
          </Link>
        </div>
        {view.rows.length > 0 ? (
          <div className="text-text-dim flex flex-wrap items-center gap-2 text-xs">
            <span>
              산정 <b className="num text-foreground">{view.totals.teacherCount}</b>명 · 산정 급여 합{" "}
              <b className="num text-foreground">{fmtWon(view.totals.settledTotal)}</b>
            </span>
            {view.totals.pendingCount > 0 ? (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-800">
                보류 {view.totals.pendingCount}
              </span>
            ) : null}
          </div>
        ) : null}
      </header>

      <p className="text-text-dim text-xs leading-relaxed">
        저장된 <b>분배 스냅샷</b>(시수 검증)을 담당 강사별로 묶어 급여 방식(비율제/급여제/혼합)을 적용합니다.
        지급 기준은 <b>청구 금액</b>이며, 실측·차이는 검토 신호로만 표시하고 어느 값도 자동 반영하지 않습니다.
        이 화면은 <b>참고용</b>으로, 급여로 자동 기록되지 않습니다.
      </p>

      {view.splitCount === 0 ? (
        <div className="border-border text-text-dim rounded-lg border border-dashed p-10 text-center text-sm">
          이 달 저장된 분배 스냅샷이 없습니다.{" "}
          <Link href={`/billing?tab=verify&period=${p}`} className="text-primary underline-offset-2 hover:underline">
            시수 검증
          </Link>
          에서 분배 스냅샷을 저장하면 여기서 강사 정산이 산정됩니다. (그 전에{" "}
          <Link href={`/billing?tab=sessions&period=${p}`} className="text-primary underline-offset-2 hover:underline">
            회차 확정
          </Link>
          이 필요합니다.)
        </div>
      ) : (
        <div className="border-line overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="border-line text-text-dim border-b text-xs">
                <th className="px-3 py-2 text-left font-medium">강사</th>
                <th className="px-3 py-2 text-right font-medium">담당 반</th>
                <th className="px-3 py-2 text-right font-medium">청구 총액</th>
                <th className="px-3 py-2 text-right font-medium">실측(신호)</th>
                <th className="px-3 py-2 text-left font-medium">급여 방식</th>
                <th className="px-3 py-2 text-right font-medium">산정 급여</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => (
                <tr key={r.teacherId ?? "unassigned"} className="border-line/60 border-b last:border-0">
                  <td className="text-foreground px-3 py-2">{r.teacherName}</td>
                  <td className="num text-text-dim px-3 py-2 text-right">{r.classCount}</td>
                  <td className="num px-3 py-2 text-right">{fmtWon(r.confirmedTotal)}</td>
                  <td className="num text-text-dim px-3 py-2 text-right">
                    {fmtWon(r.actualTotal)}
                    {r.diffTotal !== 0 ? (
                      <span className={r.diffTotal > 0 ? "text-red-700" : "text-amber-700"}>
                        {" "}
                        ({r.diffTotal > 0 ? "+" : "−"}
                        {fmtWon(Math.abs(r.diffTotal)).replace("원", "")})
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {r.teacherId ? (
                      <TeacherCompEditor
                        userId={r.teacherId}
                        salaryType={r.salaryType}
                        commissionRate={r.commissionRate}
                        monthlyBase={r.monthlyBase}
                      />
                    ) : (
                      <span className="text-text-faint text-xs">—</span>
                    )}
                  </td>
                  <td className="num px-3 py-2 text-right font-bold">
                    {isComputable(r) ? (
                      <span className="text-foreground">{fmtWon(r.settlement!)}</span>
                    ) : (
                      <span className="text-amber-700 text-xs font-normal">
                        {STATUS_NOTE[r.status as Exclude<SettlementStatus, "computed">]}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-line bg-bg-soft/50 border-t text-xs">
                <td className="text-text-dim px-3 py-2" colSpan={5}>
                  산정 급여 합계 (미설정·미배정 제외)
                </td>
                <td className="num px-3 py-2 text-right font-bold">{fmtWon(view.totals.settledTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
