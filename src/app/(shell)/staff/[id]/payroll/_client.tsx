"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Calculator, Check, Loader2, Save } from "@/components/icons/aywa-icon-compat";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { submitAction } from "@/components/forms/submit-action";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import {
  autoComputePayroll,
  markPayrollPaid,
  upsertPayroll,
  type MarkPaidState,
  type SavePayrollState,
} from "@/features/payroll/server/actions";
import type {
  PayrollCalcResult,
  PayrollRecord,
} from "@/features/payroll/server/queries";
import { writeLockedNote, writeLockedPlaceholder } from "@/lib/write-lock";

const KRW = new Intl.NumberFormat("ko-KR");

function shiftMonth(period: string, delta: number): string {
  const [y, m] = period.split("-").map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function SaveBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      저장
    </Button>
  );
}

function AutoBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Calculator className="size-4" />}
      자동 계산값으로 저장
    </Button>
  );
}

export function PayrollClient({
  userId,
  period,
  autoCalc,
  history,
  canWrite,
}: {
  userId: string;
  period: string;
  /** null = 자동 계산 재료(단가·담당 반·시간표·출결)를 못 읽었다 — 0원으로 보이지 않고 "계산 못 함"으로. */
  autoCalc: PayrollCalcResult | null;
  history: PayrollRecord[];
  /**
   * 정산 저장·자동 계산·지급 완료 표시를 할 수 있는가 — page.tsx가 서버 액션(upsertPayroll 등)과 **같은 식**으로 계산한 값
   * (super_admin 또는 canManageStaff && canWriteTenant(staff)). false면 쓰기 단추는 그리지 않고 입력칸은 잠근다(원장 2026-11-05).
   */
  canWrite: boolean;
}) {
  const existing = history.find((r) => r.period === period) ?? null;

  const [state, formAction] = useActionState<SavePayrollState, FormData>(upsertPayroll, undefined);
  // 자동 계산 실패(재료 조회 실패로 저장 거절 등)도 보여 준다 — 예전엔 결과를 버려 거절돼도 아무 말이 없었다.
  const [autoState, autoAction] = useActionState<SavePayrollState, FormData>(autoComputePayroll, undefined);

  const [baseAmount, setBaseAmount] = useState(existing?.baseAmount ?? autoCalc?.baseAmount ?? 0);
  const [hoursWorked, setHoursWorked] = useState(existing?.hoursWorked ?? autoCalc?.hoursWorked ?? 0);
  const [hourlyAmount, setHourlyAmount] = useState(
    existing?.hourlyAmount ?? autoCalc?.hourlyAmount ?? 0,
  );
  const [bonus, setBonus] = useState(existing?.bonus ?? 0);
  const [deduction, setDeduction] = useState(existing?.deduction ?? 0);

  const total = baseAmount + hourlyAmount + bonus - deduction;

  return (
    <div className="space-y-6">
      {/* 월 selector */}
      {/* ⚠️ 툴바엔 카드 껍데기를 두지 않는다(툴바 규약). */}
      <div className="flex items-center justify-between px-1 py-1">
        <div className="flex items-center gap-2">
          <Link
            href={`?period=${shiftMonth(period, -1)}`}
            className="text-muted-foreground hover:text-foreground border-line inline-flex size-8 items-center justify-center rounded-lg border"
            aria-label="이전 달"
          >
            <EyIcon name="chevronLeft" size={14} />
          </Link>
          <h2 className="text-foreground num text-base font-bold">{period}</h2>
          <Link
            href={`?period=${shiftMonth(period, 1)}`}
            className="text-muted-foreground hover:text-foreground border-line inline-flex size-8 items-center justify-center rounded-lg border"
            aria-label="다음 달"
          >
            <EyIcon name="chevronRight" size={14} />
          </Link>
        </div>
        <div className="text-muted-foreground text-xs">
          {existing
            ? existing.paidAt
              ? `${new Date(existing.paidAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })} 지급 완료`
              : "저장됨 (미지급)"
            : "미정산"}
        </div>
      </div>

      {/* 자동 계산 카드 */}
      <section className="bg-card border-border rounded-2xl border p-5">
        {autoCalc ? (
          <>
            <header className="mb-3 flex items-baseline justify-between">
              <div>
                <p className="eyebrow">자동 계산 (출석 × 시급)</p>
                <h3 className="text-foreground mt-1 text-sm font-bold">
                  담당 반 {autoCalc.classCount}개 · {autoCalc.hoursWorked}시간
                </h3>
              </div>
              <span className="text-foreground num text-xl font-bold">
                {KRW.format(autoCalc.baseAmount + autoCalc.hourlyAmount)}원
              </span>
            </header>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <StatBox label="기본급" value={`${KRW.format(autoCalc.baseAmount)}원`} />
              <StatBox label="시간 정산" value={`${KRW.format(autoCalc.hourlyAmount)}원`} />
              <StatBox label="근무 시간" value={`${autoCalc.hoursWorked}h`} highlight="text-chart-2" />
            </div>
            {canWrite ? (
              <form action={autoAction} className="mt-4">
                <input type="hidden" name="userId" value={userId} />
                <input type="hidden" name="period" value={period} />
                <AutoBtn />
              </form>
            ) : null}
            {autoState?.error ? <p className="text-chart-4 mt-3 text-sm">{autoState.error}</p> : null}
          </>
        ) : (
          <div>
            <p className="eyebrow">자동 계산 (출석 × 시급)</p>
            <p className="text-chart-4 mt-1 text-sm font-bold">자동 계산을 하지 못했습니다</p>
            <p className="text-muted-foreground mt-1 text-sm">
              단가·담당 반·시간표·출결 중 하나를 읽지 못했습니다. 0원으로 계산하지 않았습니다 — 잠시 뒤 새로고침해 주세요.
            </p>
          </div>
        )}
      </section>

      {/* 수동 정산 폼 */}
      <section className="bg-card border-border rounded-2xl border p-5">
        <header className="mb-3">
          <p className="eyebrow">수동 정산</p>
          <h3 className="text-foreground mt-1 text-sm font-bold">{canWrite ? "상세 항목 입력" : "상세 항목"}</h3>
          {/* 숫자칸은 값이 차 있어 placeholder로 알릴 수 없다 — 양식 머리에 한 줄로 알린다. */}
          {canWrite ? null : <p className="text-text-dim mt-1 text-xs">{writeLockedNote("staff")}</p>}
          {canWrite && !autoCalc && !existing ? (
            <p className="text-chart-4 mt-1 text-xs">자동 계산을 하지 못해 칸이 0으로 비어 있습니다 — 저장하면 직접 입력한 값 그대로 저장됩니다.</p>
          ) : null}
        </header>
        <form onSubmit={(e) => submitAction(e, formAction)} className="space-y-3">
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="period" value={period} />

          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <NumField
              label="기본급"
              name="baseAmount"
              disabled={!canWrite}
              value={baseAmount}
              onChange={setBaseAmount}
            />
            <NumField
              label="근무 시간"
              name="hoursWorked"
              disabled={!canWrite}
              value={hoursWorked}
              onChange={setHoursWorked}
              step="0.5"
            />
            <NumField
              label="시간 정산"
              name="hourlyAmount"
              disabled={!canWrite}
              value={hourlyAmount}
              onChange={setHourlyAmount}
            />
            <NumField label="보너스" name="bonus" value={bonus} onChange={setBonus} disabled={!canWrite} />
            <NumField
              label="공제"
              name="deduction"
              value={deduction}
              onChange={setDeduction}
              disabled={!canWrite}
            />
            <div className="space-y-1">
              <label className="text-muted-foreground block text-xs font-medium">합계</label>
              <p className="text-foreground num text-base font-bold">{KRW.format(total)}원</p>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-muted-foreground block text-xs font-medium">메모</label>
            <textarea
              name="notes"
              rows={2}
              defaultValue={existing?.notes ?? ""}
              disabled={!canWrite}
              placeholder={canWrite ? undefined : writeLockedPlaceholder("staff")}
              className="border-border bg-card text-foreground w-full rounded-md border px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          {state?.error ? <p className="text-chart-4 text-sm">{state.error}</p> : null}

          {canWrite ? (
            <div className="flex items-center justify-end gap-2 pt-2">
              <SaveBtn />
              {existing && !existing.paidAt ? <MarkPaidButton recordId={existing.id} userId={userId} /> : null}
            </div>
          ) : null}
        </form>
      </section>

      {/* 히스토리 */}
      {history.length > 0 ? (
        <section className="bg-card border-border rounded-2xl border">
          <header className="border-border border-b px-5 py-3">
            <h3 className="text-foreground text-sm font-bold">정산 이력</h3>
          </header>
          <DragScrollArea>
          <table className="w-full text-sm">
            <thead className="bg-bg-soft/40 [&_th]:whitespace-nowrap">
              <tr>
                <th className="micro px-4 py-2 text-left">기간</th>
                <th className="micro px-4 py-2 text-right">합계</th>
                <th className="micro px-4 py-2 text-right">지급</th>
                <th className="micro px-4 py-2 text-left">메모</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {history.map((r) => (
                <tr key={r.id} className="hover:bg-bg-soft/30">
                  <td className="num px-4 py-2 text-xs">{r.period}</td>
                  <td className="num px-4 py-2 text-right text-xs font-medium">
                    {KRW.format(r.total)}원
                  </td>
                  <td className="num px-4 py-2 text-right text-xs">
                    {r.paidAt ? (
                      <span className="text-chart-2">
                        {new Date(r.paidAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}
                      </span>
                    ) : (
                      <span className="text-chart-4">미지급</span>
                    )}
                  </td>
                  <td className="text-muted-foreground px-4 py-2 text-xs">{r.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </DragScrollArea>
        </section>
      ) : null}
    </div>
  );
}

function StatBox({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: string;
}) {
  return (
    <div className="bg-bg-soft/30 border-border rounded-md border px-3 py-2">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={`num text-foreground mt-0.5 font-bold ${highlight ?? ""}`}>{value}</p>
    </div>
  );
}

function NumField({
  label,
  name,
  value,
  onChange,
  step,
  disabled = false,
}: {
  label: string;
  name: string;
  value: number;
  onChange: (v: number) => void;
  step?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-muted-foreground block text-xs font-medium">{label}</label>
      <input
        name={name}
        type="number"
        step={step ?? "1000"}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        disabled={disabled}
        className="border-border bg-card text-foreground num w-full rounded-md border px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
      />
    </div>
  );
}

function MarkPaidBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
      지급 완료 표시
    </Button>
  );
}

function MarkPaidButton({ recordId, userId }: { recordId: string; userId: string }) {
  const [, action] = useActionState<MarkPaidState, FormData>(markPayrollPaid, undefined);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={recordId} />
      <input type="hidden" name="userId" value={userId} />
      <MarkPaidBtn />
    </form>
  );
}
