import Link from "next/link";
import { canManageSalary } from "@/features/payroll/server/salary-access";
import { currentPeriod } from "@/features/billing/calc";
import { getTeacherSettlementView } from "@/features/payroll/server/settlement-queries";
import { getClassSalaryRows } from "@/features/payroll/server/class-salary-queries";
import { ClassSalaryRowForm } from "./class-salary-row";
import {
  NET_MULTIPLIER,
  PLATFORM_FEE_RATE,
  type SettlementStatus,
  type TeacherSettlement,
} from "@/features/payroll/settlement";
import { Pill } from "@/components/atoms/pill";
import { TeacherCompEditor } from "./teacher-comp-editor";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { BillingMonthNav } from "./billing-month-nav";
import { FaceNote } from "./face-note";

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
  // 급여 = 원장·총괄 전용 PII(감사 D6). 그 밖에는 화면 자체를 막는다.
  if (!(await canManageSalary())) {
    return (
      <div className="border-line text-text-dim rounded-2xl border border-dashed p-10 text-center text-sm">
        강사 정산(급여)은 <b>원장</b>만 열람할 수 있습니다.
      </div>
    );
  }

  const p = period && /^\d{4}-\d{2}$/.test(period) ? period : currentPeriod();
  const [view, classRows] = await Promise.all([getTeacherSettlementView(p), getClassSalaryRows()]);
  const isComputable = (r: TeacherSettlement) => r.status === "computed";
  const hrefFor = (per: string) => `/billing?tab=payroll&period=${per}`;

  return (
    <section className="space-y-4">
      {/* 툴바(지시서 §10) — 월 이동은 공용 BillingMonthNav(옛 h-8 text-xs 화살표 링크 대체) · 집계는 값으로 오른쪽에. */}
      <div className="flex flex-wrap items-center gap-2.5 px-1">
        <BillingMonthNav period={p} hrefFor={hrefFor} ariaLabel="정산 월 선택" />
        {view.rows.length > 0 ? (
          <div className="text-text-dim ml-auto flex flex-wrap items-center gap-2 text-sm">
            <span>
              산정 <b className="num text-foreground">{view.totals.teacherCount}</b>명 · 산정 급여 합{" "}
              <b className="num text-foreground">{fmtWon(view.totals.settledTotal)}</b>
            </span>
            {view.totals.pendingCount > 0 ? <Pill color="amber">보류 {view.totals.pendingCount}</Pill> : null}
          </div>
        ) : null}
      </div>

      {/* 산식 설명은 접힌 2차(§4). 🔴 아래 "현재 배분율" 경고는 숫자의 뜻을 바꾸는 사실이라 접지 않는다. */}
      <FaceNote>
        저장된 <b>분배 스냅샷</b>(시수 검증)을 담당 강사별로 묶어 급여 방식(비율제/급여제/혼합)을 적용합니다.
        산식은 <b>지급 기준액 × {NET_MULTIPLIER}(결제 수수료 {(PLATFORM_FEE_RATE * 100).toFixed(1)}% 차감) × 배분율</b>이며,
        <b>지급 기준액 = 실제 수업분과 청구액 중 작은 값</b>입니다(덜 수업했으면 한 만큼, 더 수업했어도 청구액이 상한).
        {" "}<b>EiE 월 고정은 확정한 월 수강료 × {NET_MULTIPLIER} × 배분율</b>이며, 출석 회차로 금액을 바꾸지 않습니다.
        이 화면은 <b>참고용</b>으로, 급여로 자동 기록되지 않습니다.
      </FaceNote>
      {/* ⚠️ 배분율은 users에 **현재 값 한 벌**만 있다. 구 급여 시트 실측(김윤하 18개월)에서 비율이 달마다
          바뀌었다(25.03~25.09 44/44/46/48/50 · 25.08 42/42/44/46/48 · 25.11~26.06 45/45/45/48/50 ·
          26.01·26.07 43/43/43/46/48). 지난 달을 열면 **그때 비율이 아니라 지금 비율**로 계산되므로 그 사실을 밝힌다.
          월별 동결은 Phase 2(payroll_records 확정 스냅샷) 몫. */}
      <p className="text-amber px-1 text-sm leading-relaxed">
        배분율은 <b>현재 설정값</b>으로 계산합니다. 과거 달을 열어도 그 달에 적용했던 비율이 아니라 지금 비율이
        쓰이므로, 이미 지급이 끝난 달의 실제 금액과 다를 수 있습니다(월별 비율 동결은 급여 확정 기능에서 다룹니다).
      </p>

      {view.splitCount === 0 ? (
        <section className="rounded-lg border border-line p-4">
          <h2 className="text-base font-bold">정산을 준비해 주세요</h2>
          <p className="mt-1 text-sm">이 달 저장된 분배 스냅샷이 없습니다.</p>
          <ol className="mt-3 grid gap-2 sm:grid-cols-3">
            <li className="rounded-md bg-bg-soft p-3"><Link href={`/billing?tab=sessions&period=${p}`} className="text-primary font-bold hover:underline">1. 회차 확정 →</Link><p className="mt-1 text-xs">학생별 회차·단가 확인</p></li>
            <li className="rounded-md bg-bg-soft p-3"><Link href={`/billing?tab=verify&period=${p}`} className="text-primary font-bold hover:underline">2. 시수 검증 →</Link><p className="mt-1 text-xs">실제 수업 확인 후 분배 스냅샷 저장</p></li>
            <li className="rounded-md bg-bg-soft p-3"><b>3. 강사 정산</b><p className="mt-1 text-xs">이 화면에서 강사별 산정 결과 확인</p></li>
          </ol>
        </section>
      ) : (
        <DragScrollArea className="border-line rounded-2xl border">
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="border-line text-text-dim border-b text-sm [&_th]:font-bold">
                <th className="px-3 py-2 text-left">강사</th>
                <th className="px-3 py-2 text-right">담당 반</th>
                <th className="px-3 py-2 text-right">청구 총액</th>
                <th className="px-3 py-2 text-right" title="실제 수업분과 청구액 중 작은 값 — 비율이 곱해지는 기준">
                  지급 기준
                </th>
                <th className="px-3 py-2 text-right" title={`지급 기준액 × ${NET_MULTIPLIER} — 수수료를 뗀 금액`}>
                  수수료 차감
                </th>
                <th className="px-3 py-2 text-right">실측(신호)</th>
                <th className="px-3 py-2 text-left">급여 방식</th>
                <th className="px-3 py-2 text-right">산정 급여</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => (
                <tr key={r.teacherId ?? "unassigned"} className="border-line/60 border-b last:border-0">
                  <td className="text-foreground px-3 py-2">{r.teacherName}</td>
                  <td className="num text-text-dim px-3 py-2 text-right">{r.classCount}</td>
                  <td className="num px-3 py-2 text-right">{fmtWon(r.confirmedTotal)}</td>
                  <td className="num px-3 py-2 text-right">{fmtWon(r.payableTotal)}</td>
                  <td className="num text-text-dim px-3 py-2 text-right">{fmtWon(r.netBase)}</td>
                  <td className="num text-text-dim px-3 py-2 text-right">
                    {fmtWon(r.actualTotal)}
                    {r.diffTotal !== 0 ? (
                      <span className={r.diffTotal > 0 ? "text-danger" : "text-amber"}>
                        {" "}
                        ({r.diffTotal > 0 ? "+" : "−"}
                        {fmtWon(Math.abs(r.diffTotal)).replace("원", "")})
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {/* ⚠️ groupRates는 TeacherCompEditor가 아직 받지 않는다(2026-07-22). 넘기면 타입 에러로
                        **프로덕션 빌드 전체가 실패**해 배포가 멈춘다(실제로 멈춰 있었다 — 신규 라우트 404).
                        과정별 배분율 편집을 이 편집기에 붙일 때 **자식 props와 함께** 되살릴 것. */}
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
                <td className="text-text-dim px-3 py-2" colSpan={7}>
                  산정 급여 합계 (미설정·미배정 제외)
                </td>
                <td className="num px-3 py-2 text-right font-bold">{fmtWon(view.totals.settledTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </DragScrollArea>
      )}

      {/* 반별 과정·배분율 — 원장 전용 설정. splits가 없어도 미리 지정할 수 있게 활성 반 전체를 보여준다.
          정렬은 '지정이 필요한 것부터'(미분류 → 반 이름). */}
      <details className="border-line rounded-2xl border">
        <summary className="text-foreground cursor-pointer px-4 py-3 text-sm font-bold">
          반별 과정·배분율 설정
          <span className="text-text-faint ml-2 text-xs font-normal">
            {classRows.filter((c) => !c.manualGroup && !c.autoGroup).length}개 반이 미분류 · 총 {classRows.length}개 반
          </span>
        </summary>
        <p className="text-text-dim px-4 pb-2 text-xs leading-relaxed">
          비율 우선순위는 <b>반별 → 과정별 → 강사 기본</b>입니다. 과정은 반 이름으로 자동 판정하며
          (<code className="text-xs">초등M…</code>·<code className="text-xs">수능</code>·
          <code className="text-xs">특강</code>), 이름에 근거가 없는 반(<code className="text-xs">JP1</code> 등)은
          <b> 추정하지 않고 미분류</b>로 두니 직접 지정해 주세요.
        </p>
        <div className="max-h-[28rem] overflow-y-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-bg-soft/60 sticky top-0">
              <tr className="border-line text-text-dim border-b text-sm [&_th]:font-bold">
                <th className="px-3 py-2 text-left">반</th>
                <th className="px-3 py-2 text-left">담당</th>
                <th className="px-3 py-2 text-left">적용 과정</th>
                <th className="px-3 py-2 text-left">설정</th>
              </tr>
            </thead>
            <tbody>
              {classRows.map((c) => (
                <ClassSalaryRowForm key={c.classId} row={c} />
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
