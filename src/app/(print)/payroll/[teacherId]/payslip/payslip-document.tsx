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

/**
 * 원장 시트의 **실제 색**(xlsx 셀 서식에서 그대로 추출). 장식이 아니라 의미가 실려 있어 그대로 옮긴다:
 *  · BAND   머리글 2줄(회사명·제목) 밴드
 *  · LABEL  모든 라벨 칸
 *  · ALERT  빨강 굵게 = **지급총액**과 **퇴원 지표**(원장이 훑을 때 먼저 걸려야 하는 값)
 *  · INPUT  노랑 = '내신분석'(사람이 채워야 하는 칸이라는 표식)
 *  · RATE   비율표 5칸을 과정별로 갈라 칠한다(같은 숫자여도 어느 과정인지 색으로 구분)
 * ⚠️ 인쇄에서도 나온다 — globals.css가 `print-color-adjust: exact`를 전역으로 강제한다.
 */
const SHEET = {
  band: "#F4CCCC",
  label: "#DCDADA",
  alert: "#FF0000",
  input: "#FFFF00",
  rate: { 초등: "#FFF2CC", 중등: "#FCE5CD", 고등: "#F4CCCC", 수능: "#D0E0E3", 특강: "#CFE2F3" },
} as const;

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

/**
 * 명세서 표의 한 칸(라벨 + 값).
 * `alert` = 시트에서 빨강 굵게인 칸 · `input` = 노랑(사람이 채우는 칸).
 */
function Cell({
  label,
  children,
  mono,
  alert,
  input,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
  alert?: boolean;
  input?: boolean;
}) {
  return (
    <>
      <th
        scope="row"
        className="border border-black/70 px-2 py-1.5 text-left font-medium"
        style={{ background: SHEET.label }}
      >
        {label}
      </th>
      <td
        className={`border border-black/70 px-2 py-1.5 ${mono ? "num" : ""} ${alert ? "font-bold" : ""}`}
        style={{ background: input ? SHEET.input : undefined, color: alert ? SHEET.alert : undefined }}
      >
        {children}
      </td>
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
  // 🔴 대상 학년을 좁힌 명세서 — 대상 밖 학년 칸은 **빈 칸**이다. 기본 비율로 메우면 계산에 쓰지 않은 비율이 찍힌다(적대 리뷰 2026-10-07).
  const outOfScope = (g: (typeof SALARY_GROUPS)[number]) =>
    !!data.sheetLevels?.length && (g === "초등" || g === "중등" || g === "고등") && !data.sheetLevels.includes(g);
  const shownBase = (g: (typeof SALARY_GROUPS)[number]) => (outOfScope(g) ? undefined : rates.base[g] ?? rates.baseDefault ?? undefined);
  const shownApplied = (g: (typeof SALARY_GROUPS)[number]) => (outOfScope(g) ? undefined : rates.applied[g] ?? rates.appliedDefault ?? undefined);
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

      {/* 머리글 2줄 = 시트의 분홍 밴드. 여기가 문서의 얼굴이라 색을 뺐더니 통째로 밋밋해졌다. */}
      <p className="border border-black/70 px-2 py-1.5 text-sm font-bold" style={{ background: SHEET.band }}>
        회사명 : {company.name}
      </p>
      <div
        className="flex items-baseline justify-between border border-t-0 border-black/70 px-2 py-2"
        style={{ background: SHEET.band }}
      >
        <p className="text-sm font-bold">{periodTitle(data.period)}</p>
        <h1 className="text-lg font-bold tracking-tight">프리랜서 강의용역수수료 명세서</h1>
        <p className="w-24" aria-hidden />
      </div>

      <table className="mt-4 w-full table-fixed border-collapse text-[13px] leading-snug">
        {/* 🔑 칸마다 **필요한 폭이 다르다** — 6칸을 같은 폭으로 나누면 어딘가는 반드시 접힌다.
            실측(210mm·13px 기준)으로 잡은 값이고, 라벨/값을 균등 분배로 되돌리지 말 것:
              A 라벨 "수업료 총액"(6자) · C 라벨 "지방세 0.3%"(가장 김) · E 라벨 "계약형태"(가장 짧음)
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
            {/* 라벨은 원장 시트 표기를 그대로 따른다(2026-08-14) — 값은 그대로고 문구만 맞춘 것이다. */}
            <Cell label="용역제공기간">
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
            {/* 시트도 이 칸을 '담당과목'이라 부르고 값은 리스트 탭의 **부서**를 끌어온다(수학과·영어과) —
                라벨만 시트에 맞추고 데이터 소스는 그대로 둔다(값을 갈아끼우지 않는다). */}
            <Cell label="담당과목">
              <Val v={teacher.department} />
            </Cell>
          </tr>
          <tr>
            {/* 시트의 '내신분석' 칸 = 강사별 블로그 작성일. 라벨은 시트 표기를 그대로 쓴다. */}
            <Cell label="내신분석" input>
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
            <th
              colSpan={2}
              className="border border-black/70 px-2 py-1.5 text-left font-semibold"
              style={{ background: SHEET.label }}
            >
              지급 내역
            </th>
            <th
              colSpan={2}
              className="border border-black/70 px-2 py-1.5 text-left font-semibold"
              style={{ background: SHEET.label }}
            >
              공제 내역
            </th>
            <Cell label="입금은행">
              <Val v={teacher.bankName} />
            </Cell>
          </tr>
          {/* 🔑 공제는 시트와 같은 4줄이다: 소득세 3% → 지방세 0.3% → 기타공제 → 공제총액(원장 2026-08-14).
              예전엔 '소득세 3.3%' 한 줄로 합쳐 놨는데, 그 안에 **지방세가 섞여 있어** 라벨이 사실과 달랐다.
              ⚠️ 계산은 손대지 않는다 — `withholding`(3.3%)이 진실이고 `incomeTax`+`localTax`가 그 분해다
              (payslip.ts: localTax = withholding − incomeTax라 **합이 절대 어긋나지 않는다**).
              ⚠️ 지급 항목은 3개뿐이라(시트의 '기타 지급'은 aywa에 없다) 아래 한 줄의 좌·우가 비어 있다 —
                 빈 칸을 채우려고 **없는 항목을 만들지 말 것**(값이 영영 'ㅡ'인 칸은 거짓 약속이다). */}
          <tr>
            <Cell label="수업료 총액" mono>
              {ok ? won(amounts.tuition) : unknown}
            </Cell>
            <Cell label="소득세 3%" mono>
              {ok ? won(amounts.incomeTax) : unknown}
            </Cell>
            <Cell label="계좌번호" mono>
              <Val v={teacher.accountNumber} />
            </Cell>
          </tr>
          <tr>
            <Cell label="인센티브" mono>
              {wonOrDash(amounts.incentive)}
            </Cell>
            <Cell label="지방세 0.3%" mono>
              {ok ? won(amounts.localTax) : unknown}
            </Cell>
            <th
              scope="row"
              className="border border-black/70 px-2 py-1.5 text-left font-medium"
              style={{ background: SHEET.label }}
            >
              총 시수
            </th>
            <td className="num border border-black/70 px-2 py-1.5">
              {/* 단위 글자 — 출석부 기준(프리랜서)은 그 출석부의 단위(영어 U · 수학 T · 섞이면 없음), 그 밖·옛 스냅샷은 종전대로 T. */}
              {ok ? `${data.settlement!.unitsTotal}${data.settlement!.unitSuffix === undefined ? "T" : data.settlement!.unitSuffix ?? ""}` : unknown}
            </td>
          </tr>
          <tr>
            <td colSpan={2} className="border border-black/70 px-2 py-1.5" />
            <Cell label="기타공제" mono>
              {wonOrDash(amounts.otherDeduction)}
            </Cell>
            <td colSpan={2} className="border border-black/70 px-2 py-1.5" />
          </tr>
          <tr>
            {/* 시트에서 유일하게 빨강 14pt인 칸 — 이 문서의 결론 숫자다. */}
            <Cell label="지급총액" mono alert={ok}>
              {ok ? won(amounts.grossPay) : unknown}
            </Cell>
            <Cell label="공제총액" mono>
              {ok ? won(amounts.deductionTotal) : unknown}
            </Cell>
            <Cell label="실수령액" mono>
              {ok ? (
                <strong className={amounts.netPay < 0 ? "text-red-700" : undefined}>{won(amounts.netPay)}</strong>
              ) : (
                unknown
              )}
            </Cell>
          </tr>
        </tbody>
      </table>

      <ClassMetrics data={data} />

      {/* 배분율 — 패널티가 있으면 기본·차감·적용을 모두 밝힌다(강사가 왜 줄었는지 알아야 한다). */}
      <table className="mt-5 w-full border-collapse text-center text-[13px]">
        <thead>
          <tr>
            <th className="border border-black/70 px-2 py-1 font-medium" style={{ background: SHEET.label }}>
              배분율
            </th>
            {SALARY_GROUPS.map((g) => (
              <th key={g} className="border border-black/70 px-2 py-1 font-bold" style={{ background: SHEET.label }}>
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
            {/* 과정별 파스텔 — 시트가 다섯 칸을 각각 다른 색으로 갈라 놨다(같은 숫자여도 어느 과정인지 보인다). */}
            {SALARY_GROUPS.map((g) => (
              <td
                key={g}
                className="num border border-black/70 px-2 py-1 font-bold"
                style={{ background: SHEET.rate[g] }}
              >
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
    <>
      <table className="mt-5 w-full table-fixed border-collapse text-[13px]">
      <colgroup>
        <col className="w-[15%]" />
        <col className="w-[35%]" />
        <col className="w-[22%]" />
        <col className="w-[28%]" />
      </colgroup>
      <thead>
        <tr>
          <th
            colSpan={2}
            className="border border-black/70 px-2 py-1.5 text-left font-semibold"
            style={{ background: SHEET.label }}
          >
            {data.period.slice(5)}월 수업 내역
          </th>
          <th
            colSpan={2}
            className="border border-black/70 px-2 py-1.5 text-left font-semibold"
            style={{ background: SHEET.label }}
          >
            {year}년 누적 수업 내역
          </th>
        </tr>
      </thead>
      {/* 🔑 시트에서 **퇴원 계열이 전부 빨강 굵게**다 — 원장이 훑을 때 먼저 걸려야 하는 값이라 그렇게
          칠해 둔 것이고, 색을 빼면 그 의도가 사라진다.
          🔴 **퇴원 항목은 인쇄에서 뺀다**(원장 2026-08-14: "인쇄시에 퇴원 관련 내용은 인쇄 안되도록 (내부 자료)").
             명세서는 강사에게 주는 문서인데 퇴원생 수·명단·퇴원생률은 학원 내부 지표다.
          ⚠️ 그래서 **행 구성을 바꿨다** — 예전엔 퇴원 칸이 '월 평균 수업인원'·'담당 반'과 같은 줄이라
             줄째로 숨기면 그 둘까지 사라졌다. 퇴원 계열만 아래 두 줄로 모아 그 줄만 숨긴다.
             ⚠️ 새 지표를 이 표에 넣을 땐 **퇴원 줄에 끼우지 말 것**(인쇄에서 함께 사라진다). */}
      <tbody>
        <tr>
          <Cell label="수업인원">{metrics.studentsThisMonth}명</Cell>
          <Cell label="누적수업인원">{metrics.cumulativeStudents}명</Cell>
        </tr>
        <tr>
          {/* 대상 학년을 좁힌 명세서는 그 학년 학생이 있는 반만 센다(수업인원과 같은 범위). */}
          <Cell label="담당 반">{metrics.scopedClassCount ?? data.teacher.classes.length}개</Cell>
          <Cell label="월 평균 수업인원">{metrics.averageStudents}명</Cell>
        </tr>
        <tr className="print:hidden">
          <Cell label="퇴원생 수" alert>
            {metrics.withdrawal.count}명
          </Cell>
          <Cell label={`${year} 퇴원생 수`} alert>
            {metrics.yearlyWithdrawals}명
          </Cell>
        </tr>
        <tr className="print:hidden">
          <Cell label="퇴원생 명단" alert>
            {metrics.withdrawal.names.length > 0 ? metrics.withdrawal.names.join(", ") : EMPTY_MARK}
          </Cell>
          <Cell label="퇴원생률" alert>
            {formatWithdrawalRate(metrics.withdrawal.rate)}
          </Cell>
        </tr>
      </tbody>
      </table>
      {/* 화면에만 — 종이에서 왜 두 줄이 사라지는지 보는 사람이 알아야 한다(모르면 "빠졌다"는 제보가 온다). */}
      <p className="print:hidden mt-1 text-[11px] text-[var(--muted-fg,#767676)]">
        퇴원 항목(퇴원생 수·명단·퇴원생률)은 <b>내부 자료</b>라 인쇄물에는 나오지 않습니다.
      </p>
    </>
  );
}

/**
 * 서명란 — 담당자 / **대표** / 수령인.
 * 🔴 2026-08-14: 원장 시트 사진("담당 / 원장 / 수령인")에 맞추려다 아래 결정을 되돌릴 뻔했다.
 *    **시트가 아니라 원장 지시가 이긴다** — 시트를 근거로 이 두 칸을 바꾸지 말 것.
 * ⚠️ 가운데 칸 라벨은 원장 지시로 `원장` → **`대표`**(2026-08-13). 이건 **이 문서의 서명 칸 이름**이라
 *    시스템 역할 표시 라벨("원장", CLAUDE.md 결정 로그)과 **별개**다 — 역할 라벨은 건드리지 않는다.
 * 🔑 수령인 = 이 명세서를 받는 그 강사다(빈칸으로 두면 누가 받는 문서인지 종이에 안 남는다).
 */
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
            <td className="border border-black/70 px-2 py-1.5" style={{ background: SHEET.label }} />
            <td className="border border-black/70 px-2 py-1.5 font-medium" style={{ background: SHEET.label }}>
              담당자
            </td>
            <td className="border border-black/70 px-2 py-1.5 font-medium" style={{ background: SHEET.label }}>
              대표
            </td>
            <td className="border border-black/70 px-2 py-1.5 font-medium" style={{ background: SHEET.label }}>
              수령인
            </td>
          </tr>
          <tr>
            <th
              scope="row"
              className="border border-black/70 px-2 py-1.5 font-medium"
              style={{ background: SHEET.label }}
            >
              날 짜
            </th>
            <td className="num border border-black/70 px-2 py-1.5">{signDate}</td>
            <td className="num border border-black/70 px-2 py-1.5">{signDate}</td>
            <td className="num border border-black/70 px-2 py-1.5">{signDate}</td>
          </tr>
          <tr>
            <th
              scope="row"
              className="border border-black/70 px-2 py-1.5 font-medium"
              style={{ background: SHEET.label }}
            >
              서 명
            </th>
            <td className="h-14 whitespace-pre-line border border-black/70 px-2 py-1.5 align-middle">
              {signers ? signers.split(/\s*,\s*/).join("\n") : ""}
            </td>
            <td className="border border-black/70 px-2 py-1.5 align-middle">
              {data.company.representativeName ?? ""}
            </td>
            {/* 수령인 = 명세서를 받는 강사 본인 — 이름은 자동, 서명은 사람이 한다. */}
            <td className="border border-black/70 px-2 py-1.5 align-middle">{data.teacher.name}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
