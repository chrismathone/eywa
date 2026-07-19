/**
 * ① 운영실 히어로 — 라이트 인사말 + KPI 스탯카드 그리드 (2026-07-19 상용 톤 재구성).
 * 구판 "다크 ink 계기판 밴드"(잔글씨 지표 산개)는 장식에 그쳐 폐기 — 상용 SaaS 문법
 * (큰 인사말 + 카드형 지표: 라벨/아이콘 칩/큰 숫자/보조 라인)으로 재구성.
 * 시맨틱 컬러는 값이 아니라 아이콘 칩·보조 라인에 — 숫자는 잉크로 차분하게(미수만 danger).
 */
const KO_DATE_FULL = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "long",
  day: "numeric",
  weekday: "long",
});

import { BigStat } from "@/components/atoms/big-stat";
import { EyIcon } from "@/components/icons/eywa-icons";
import { EnrollmentChangeModal } from "./enrollment-change-modal";
import type { EnrollmentChangeStudent } from "@/features/dashboard/server/queries";

export function CommandBand({
  identity,
  metrics,
  enrollmentChanges,
}: {
  identity: {
    name: string;
    /** 로그인 사용자 호칭 — 본인 직급(job_title) 우선, 없으면 역할 기반(원장/관리자/실장/선생…). */
    honorific: string;
  };
  metrics: {
    enrollment: { count: number; delta: number } | null;
    attendance: {
      rate: number | null;
      /** 출석 서브 라벨 — 과거 폴백이면 "M/D 기준", 스테일이면 "M/D 이후 기록 없음". */
      asOf: string | null;
    } | null;
    billing: {
      paymentRate: number | null;
      unpaidCount: number;
      /** 이번 달 미수 총액(원) — 원장에겐 '몇 건'보다 '얼마' */
      outstanding: number;
    } | null;
  };
  enrollmentChanges: {
    newCount: number;
    withdrawnCount: number;
    newStudents: EnrollmentChangeStudent[];
    withdrawn: EnrollmentChangeStudent[];
  } | null;
}) {
  const { name, honorific } = identity;
  const { enrollment, attendance, billing } = metrics;
  const newStudents = enrollmentChanges?.newStudents ?? [];
  const withdrawn = enrollmentChanges?.withdrawn ?? [];
  const dateLabel = KO_DATE_FULL.format(new Date());
  const deltaText = enrollment
    ? enrollment.delta === 0
      ? "±0"
      : enrollment.delta > 0
        ? `+${enrollment.delta}`
        : `${enrollment.delta}`
    : "±0";
  const outstandingDisplay = formatOutstandingAmount(billing?.outstanding ?? 0);

  return (
    <section aria-labelledby="assistant-home-title">
      {/* 인사말 — 큰 타이포 위계(날짜 → 인사 → 안내) */}
      <div className="px-1">
        <p className="text-text-dim text-[13px] font-medium">{dateLabel}</p>
        <h2
          id="assistant-home-title"
          className="text-foreground mt-1 text-[26px] font-bold tracking-tight"
        >
          안녕하세요, {name} {honorific}님
        </h2>
        <p className="text-text-dim mt-1 text-[14px]">
          오늘 필요한 판단과 실행 순서를 정리해 두었어요.
        </p>
      </div>

      {/* KPI 카드 그리드 — BigStat(문법 ②) 공용 atom */}
      <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-4">
        {enrollment ? (
          <BigStat
            label="재원생"
            icon={<EyIcon name="users" size={16} />}
            tone="blue"
            value={enrollment.count.toLocaleString("ko-KR")}
            unit="명"
            sub={
              <EnrollmentChangeModal
                deltaText={deltaText}
                newCount={enrollmentChanges?.newCount ?? 0}
                withdrawnCount={enrollmentChanges?.withdrawnCount ?? 0}
                newStudents={newStudents}
                withdrawn={withdrawn}
              />
            }
          />
        ) : null}
        {attendance ? (
          <BigStat
            label="오늘 출석률"
            icon={<EyIcon name="check" size={16} />}
            tone="primary"
            value={attendance.rate == null ? "—" : String(Math.round(attendance.rate))}
            unit={attendance.rate == null ? "" : "%"}
            sub={attendance.asOf ?? undefined}
          />
        ) : null}
        {billing ? (
          <>
            <BigStat
              label="수납률"
              icon={<EyIcon name="chart" size={16} />}
              tone="gold"
              value={billing.paymentRate == null ? "—" : String(Math.round(billing.paymentRate))}
              unit={billing.paymentRate == null ? "" : "%"}
            />
            <BigStat
              label="이번 달 미수"
              icon={<EyIcon name="wallet" size={16} />}
              tone={billing.outstanding > 0 ? "danger" : "neutral"}
              value={outstandingDisplay.value}
              unit={outstandingDisplay.unit}
              valueClass={billing.outstanding > 0 ? "text-danger" : undefined}
              sub={billing.unpaidCount > 0 ? `${billing.unpaidCount}건` : undefined}
            />
          </>
        ) : null}
      </div>
    </section>
  );
}

export function formatOutstandingAmount(amount: number): { value: string; unit: "원" | "만원" } {
  if (amount < 10_000) return { value: Math.max(0, amount).toLocaleString("ko-KR"), unit: "원" };
  return {
    value: (amount / 10_000).toLocaleString("ko-KR", { maximumFractionDigits: 1 }),
    unit: "만원",
  };
}

