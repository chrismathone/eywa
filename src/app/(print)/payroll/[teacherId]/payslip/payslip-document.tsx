import {
  formatRate,
  payDateLabel,
  periodTitle,
  rateBreakdownLabel,
  workPeriodLabel,
} from "@/features/payroll/payslip";
import { formatWithdrawalRate } from "@/features/payroll/payslip-metrics";
import { SALARY_GROUPS } from "@/features/payroll/salary-group";
import { EMPTY_MARK, won, wonOrDash, type PayslipData } from "@/features/payroll/payslip-view";

/** 값이 없으면 '미입력'을 명시한다 — 빈 칸은 "0"이나 "없음"으로 오해된다. */
function Val({ v }: { v: string | null | undefined }) {
  const s = (v ?? "").trim();
  return s ? <>{s}</> : <span className="text-[var(--muted-fg,#767676)]">미입력</span>;
}

/** 'YYYY-MM-DD' → 'YYYY.MM.DD' — 시트 표기(점 구분)에 맞춘다. 형식이 다르면 원문 그대로. */
function dotDate(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.replace(/-/g, ".") : s || null;
}

/** 명세서 표의 한 칸(라벨 + 값). */
function Cell({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <>
      <th scope="row" className="border border-black/70 bg-black/[0.04] px-2 py-1.5 text-left font-medium">
        {label}
      </th>
      <td className={`border border-black/70 px-2 py-1.5 ${mono ? "num" : ""}`}>{children}</td>
    </>
  );
}

export function PayslipDocument({ data }: { data: PayslipData }) {
  const { teacher, amounts, rates, adjustments, company } = data;
  const contract = teacher.contractPeriod;
  // 설명 문장의 예시로 쓸 기본 비율 하나 — 5개를 전부 나열하면 한 줄이 명세서를 넘긴다.
  const firstBase = SALARY_GROUPS.map((g) => rates.base[g]).find((v) => v !== undefined) ?? rates.baseDefault;
  /**
   * 과정별 비율이 비어 있으면 **기본 비율**이 실제로 적용된다(computeTierSettlement의 defaultRate 폴백).
   * 표에 'ㅡ'만 찍으면 "비율 없이 계산됐다"는 거짓말이 된다 — 적용된 값을 그대로 보인다.
   */
  const shownBase = (g: (typeof SALARY_GROUPS)[number]) => rates.base[g] ?? rates.baseDefault ?? undefined;
  const shownApplied = (g: (typeof SALARY_GROUPS)[number]) => rates.applied[g] ?? rates.appliedDefault ?? undefined;
  /**
   * 🔴 수업료를 못 냈으면 **금액 칸을 전부** 이걸로 채운다. 수업료만 가리고 지급총액·실수령액에 ₩0을
   *    찍으면 "겉보기 정상인 ₩0 명세서"가 인쇄된다(적대 리뷰가 잡은 치명 버그).
   */
  const unknown = <span className="text-red-700">산정 불가</span>;
  const ok = data.settlement !== null;

  return (
    <>
      {/* 내부 확인용 — 종이에는 찍지 않는다(명세서는 강사에게 주는 문서다). */}
      {data.warnings.length > 0 ? (
        <div className="print:hidden mb-6 rounded-lg border border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-semibold">발행 전 확인</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {data.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.frozen ? (
        <p className="print:hidden mb-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          발행 완료된 명세서입니다 — 아래 값은 <b>발행 시점에 동결된 스냅샷</b>이며 지금 다시 계산한 값이 아닙니다
          {adjustments.issuedAt ? ` (발행 ${adjustments.issuedAt.slice(0, 10)})` : ""}.
        </p>
      ) : null}

      <p className="text-sm">회사명 : {company.name}</p>
      <div className="mt-1 flex items-baseline justify-between">
        <p className="text-sm font-medium">{periodTitle(data.period)}</p>
        <h1 className="text-lg font-bold tracking-tight">프리랜서 강의용역수수료 명세서</h1>
        <p className="w-24" aria-hidden />
      </div>

      <table className="mt-4 w-full table-fixed border-collapse text-[13px] leading-snug">
        {/* 🔑 칸마다 **필요한 폭이 다르다** — 6칸을 같은 폭으로 나누면 어딘가는 반드시 접힌다.
            실측(210mm·13px 기준)으로 잡은 값이고, 라벨/값을 균등 분배로 되돌리지 말 것:
              A 라벨 "수업료 총액"(6자) · C 라벨 "소득세 3.3%"(가장 김) · E 라벨 "계약형태"(가장 짧음)
              D 값 "2025.03.02~2026.02.28"(21자 ≈163px, 여기가 폭을 지배한다) · F 값 계좌번호 */}
        <colgroup>
          <col className="w-[14%]" />
          <col className="w-[15%]" />
          <col className="w-[13%]" />
          <col className="w-[24%]" />
          <col className="w-[12%]" />
          <col className="w-[22%]" />
        </colgroup>
        <tbody>
          <tr>
            <Cell label="이름">{teacher.name}</Cell>
            <Cell label="주민번호" mono>
              <Val v={teacher.residentRegNo} />
            </Cell>
            <Cell label="계약형태">
              <Val v={teacher.employmentType} />
            </Cell>
          </tr>
          <tr>
            <Cell label="근무기간">
              <Val v={workPeriodLabel(data.period)} />
            </Cell>
            <Cell label="계약기간">
              {contract ? (
                <>
                  <span className="whitespace-nowrap">
                    {dotDate(contract.start)}~{dotDate(contract.end)}
                  </span>
                  {/* 저장된 계약이 없어 입사일+1년으로 **계산한** 값이면 그렇다고 밝힌다(사실과 추정 구분). */}
                  {contract.stored ? null : <span className="ml-1 text-[11px]">(입사일 기준 추정)</span>}
                </>
              ) : (
                <Val v={null} />
              )}
            </Cell>
            <Cell label="부서">
              <Val v={teacher.department} />
            </Cell>
          </tr>
          <tr>
            {/* 시트의 '내신분석' 칸 = 강사별 블로그 작성일. 라벨은 시트 표기를 그대로 쓴다. */}
            <Cell label="내신분석">
              <Val v={adjustments.blogWrittenOn} />
            </Cell>
            <Cell label="입사일">
              <Val v={dotDate(teacher.hireDate)} />
            </Cell>
            <Cell label="지급일">
              <Val v={payDateLabel(data.period)} />
            </Cell>
          </tr>

          <tr>
            <th colSpan={2} className="border border-black/70 bg-black/[0.07] px-2 py-1.5 text-left font-semibold">
              지급 내역
            </th>
            <th colSpan={2} className="border border-black/70 bg-black/[0.07] px-2 py-1.5 text-left font-semibold">
              공제 내역
            </th>
            <Cell label="입금은행">
              <Val v={teacher.bankName} />
            </Cell>
          </tr>
          <tr>
            <Cell label="수업료 총액" mono>
              {ok ? won(amounts.tuition) : unknown}
            </Cell>
            <Cell label="기타공제" mono>
              {wonOrDash(amounts.otherDeduction)}
            </Cell>
            <Cell label="계좌번호" mono>
              <Val v={teacher.accountNumber} />
            </Cell>
          </tr>
          <tr>
            <Cell label="인센티브" mono>
              {wonOrDash(amounts.incentive)}
            </Cell>
            <Cell label="소득세 3.3%" mono>
              {ok ? won(amounts.withholding) : unknown}
            </Cell>
            <Cell label="실수령액" mono>
              {ok ? (
                <strong className={amounts.netPay < 0 ? "text-red-700" : undefined}>{won(amounts.netPay)}</strong>
              ) : (
                unknown
              )}
            </Cell>
          </tr>
          <tr>
            <Cell label="지급총액" mono>
              {ok ? <strong>{won(amounts.grossPay)}</strong> : unknown}
            </Cell>
            <Cell label="공제총액" mono>
              {ok ? won(amounts.deductionTotal) : unknown}
            </Cell>
            <th scope="row" className="border border-black/70 bg-black/[0.04] px-2 py-1.5 text-left font-medium">
              총 시수
            </th>
            <td className="num border border-black/70 px-2 py-1.5">
              {ok ? `${data.settlement!.unitsTotal}T` : unknown}
            </td>
          </tr>
        </tbody>
      </table>

      <ClassMetrics data={data} />

      {/* 배분율 — 패널티가 있으면 기본·차감·적용을 모두 밝힌다(강사가 왜 줄었는지 알아야 한다). */}
      <table className="mt-5 w-full border-collapse text-center text-[13px]">
        <thead>
          <tr>
            <th className="border border-black/70 bg-black/[0.04] px-2 py-1 font-medium">배분율</th>
            {SALARY_GROUPS.map((g) => (
              <th key={g} className="border border-black/70 bg-black/[0.04] px-2 py-1 font-medium">
                {g}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* 차감이 있을 때만 '기본' 줄을 함께 보인다 — 강사가 얼마에서 얼마로 줄었는지 한눈에 봐야 한다. */}
          {rates.penaltyPoints > 0 ? (
            <tr className="text-[var(--muted-fg,#767676)]">
              <td className="border border-black/70 px-2 py-1">기본</td>
              {SALARY_GROUPS.map((g) => (
                <td key={g} className="num border border-black/70 px-2 py-1 line-through">
                  {shownBase(g) === undefined ? EMPTY_MARK : `${formatRate(shownBase(g)!)}%`}
                </td>
              ))}
            </tr>
          ) : null}
          <tr>
            <td className="border border-black/70 px-2 py-1 font-medium">적용</td>
            {SALARY_GROUPS.map((g) => (
              <td key={g} className="num border border-black/70 px-2 py-1 font-medium">
                {shownApplied(g) === undefined ? EMPTY_MARK : `${formatRate(shownApplied(g)!)}%`}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      {rates.penaltyPoints > 0 ? (
        <p className="mt-1 text-[12px]">
          {adjustments.ratePenaltyReason?.trim() || "블로그 미작성"}으로 전 과정{" "}
          <b>−{formatRate(rates.penaltyPoints)}%p</b> 차감했습니다
          {firstBase !== null ? ` (예: ${rateBreakdownLabel(firstBase, rates.penaltyPoints)})` : ""}.
        </p>
      ) : null}

      <Signatures data={data} />
    </>
  );
}

function ClassMetrics({ data }: { data: PayslipData }) {
  const { metrics } = data;
  const year = data.period.slice(0, 4);
  return (
    <table className="mt-5 w-full table-fixed border-collapse text-[13px]">
      <colgroup>
        <col className="w-[15%]" />
        <col className="w-[35%]" />
        <col className="w-[22%]" />
        <col className="w-[28%]" />
      </colgroup>
      <thead>
        <tr>
          <th colSpan={2} className="border border-black/70 bg-black/[0.07] px-2 py-1.5 text-left font-semibold">
            {data.period.slice(5)}월 수업 내역
          </th>
          <th colSpan={2} className="border border-black/70 bg-black/[0.07] px-2 py-1.5 text-left font-semibold">
            {year}년 누적 수업 내역
          </th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <Cell label="수업인원">{metrics.studentsThisMonth}명</Cell>
          <Cell label="누적수업인원">{metrics.cumulativeStudents}명</Cell>
        </tr>
        <tr>
          <Cell label="퇴원생 수">{metrics.withdrawal.count}명</Cell>
          <Cell label={`${year} 퇴원생 수`}>{metrics.yearlyWithdrawals}명</Cell>
        </tr>
        <tr>
          <Cell label="퇴원생 명단">
            {metrics.withdrawal.names.length > 0 ? metrics.withdrawal.names.join(", ") : EMPTY_MARK}
          </Cell>
          <Cell label="월 평균 수업인원">{metrics.averageStudents}명</Cell>
        </tr>
        <tr>
          <Cell label="퇴원생율">{formatWithdrawalRate(metrics.withdrawal.rate)}</Cell>
          <Cell label="담당 반">{data.teacher.classes.length}개</Cell>
        </tr>
      </tbody>
    </table>
  );
}

function Signatures({ data }: { data: PayslipData }) {
  const signDate = payDateLabel(data.period) ?? "";
  const signers = (data.company.signerLabels ?? "").trim();
  return (
    <section className="mt-8">
      <p className="text-[13px]">위 내용을 확인합니다.</p>
      <table className="mt-2 w-full table-fixed border-collapse text-center text-[13px]">
        <colgroup>
          <col className="w-[12%]" />
          <col className="w-[29%]" />
          <col className="w-[29%]" />
          <col className="w-[30%]" />
        </colgroup>
        <tbody>
          <tr>
            <td className="border border-black/70 bg-black/[0.04] px-2 py-1.5" />
            <td className="border border-black/70 bg-black/[0.04] px-2 py-1.5 font-medium">담당자</td>
            <td className="border border-black/70 bg-black/[0.04] px-2 py-1.5 font-medium">원장</td>
            <td className="border border-black/70 bg-black/[0.04] px-2 py-1.5 font-medium">수령인</td>
          </tr>
          <tr>
            <th scope="row" className="border border-black/70 bg-black/[0.04] px-2 py-1.5 font-medium">
              날 짜
            </th>
            <td className="num border border-black/70 px-2 py-1.5">{signDate}</td>
            <td className="num border border-black/70 px-2 py-1.5">{signDate}</td>
            <td className="num border border-black/70 px-2 py-1.5">{signDate}</td>
          </tr>
          <tr>
            <th scope="row" className="border border-black/70 bg-black/[0.04] px-2 py-1.5 font-medium">
              서 명
            </th>
            <td className="h-14 whitespace-pre-line border border-black/70 px-2 py-1.5 align-middle">
              {signers ? signers.split(/\s*,\s*/).join("\n") : ""}
            </td>
            <td className="border border-black/70 px-2 py-1.5 align-middle">
              {data.company.representativeName ?? ""}
            </td>
            <td className="border border-black/70 px-2 py-1.5" />
          </tr>
        </tbody>
      </table>
    </section>
  );
}
