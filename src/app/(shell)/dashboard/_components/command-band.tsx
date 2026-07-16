/**
 * ① EYWA 운영실 헤더 — 다크 ink 표면 위 역할별 인사말 + 오늘 브리핑 + 핵심 4지표.
 * Daylight 라이트 페이지 위 '계기판' 액센트(테마 플립 아님). 밴드 전용 강조색은
 * 로컬 상수(라이트그린/danger-light) — 다크 표면 전용이라 globals 토큰 추가 안 함.
 */
const KO_DATE_FULL = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
});

import type { ReactNode } from "react";
import { EnrollmentChangeModal } from "./enrollment-change-modal";
import type { EnrollmentChangeStudent } from "@/features/dashboard/server/queries";

const ACCENT_GREEN = "#5dcaa5"; // 다크 위 출석 강조 (forest green은 대비 부족)
const ACCENT_DANGER = "#f09595"; // 다크 위 미수 경고

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
  const parts = KO_DATE_FULL.formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const eyebrow = `EYWA 운영실 · ${get("year")}.${get("month")}.${get("day")} ${get("weekday")}`;
  const deltaText = enrollment
    ? enrollment.delta === 0
      ? "±0"
      : enrollment.delta > 0
        ? `+${enrollment.delta}`
        : `${enrollment.delta}`
    : "±0";
  const outstandingDisplay = formatOutstandingAmount(billing?.outstanding ?? 0);
  const metricCount = Number(enrollment !== null) + Number(attendance !== null) + (billing ? 2 : 0);
  const metricGrid =
    metricCount >= 4
      ? "grid-cols-2 sm:grid-cols-4"
      : metricCount === 3
        ? "grid-cols-2 sm:grid-cols-3"
        : metricCount === 2
          ? "grid-cols-2"
          : "grid-cols-1";

  return (
    <section
      className="bg-ink relative overflow-hidden rounded-2xl px-6 py-5 text-white"
      aria-labelledby="assistant-home-title"
    >
      <svg
        className="pointer-events-none absolute -top-8 right-0 opacity-10"
        width="200"
        height="200"
        viewBox="0 0 200 200"
        aria-hidden="true"
      >
        {[95, 72, 49, 26].map((r) => (
          <circle key={r} cx="120" cy="80" r={r} fill="none" stroke="#fff" strokeWidth="1" />
        ))}
        <circle cx="120" cy="80" r="8" fill="var(--gold)" />
      </svg>

      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-gold font-mono text-[10px] tracking-wider uppercase">{eyebrow}</p>
          <h2 id="assistant-home-title" className="mt-2 text-[25px] font-extrabold tracking-tight">
            안녕하세요, {name} {honorific}님.
          </h2>
          <p className="mt-1 text-[12px] text-white/55">Eywa가 지금 필요한 판단과 실행 순서를 정리했습니다.</p>
        </div>

        {metricCount > 0 ? (
          <div className={`grid gap-x-7 gap-y-4 lg:gap-x-8 ${metricGrid}`}>
            {enrollment ? (
              <BandMetric
                label="재원"
                value={String(enrollment.count)}
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
              <BandMetric
                label="출석"
                value={attendance.rate == null ? "—" : String(Math.round(attendance.rate))}
                unit={attendance.rate == null ? "" : "%"}
                valueColor={attendance.rate == null ? undefined : ACCENT_GREEN}
                sub={
                  attendance.asOf ? (
                    <div className="mt-1 font-mono text-[10px] text-white/45">{attendance.asOf}</div>
                  ) : undefined
                }
              />
            ) : null}
            {billing ? (
              <>
                <BandMetric
                  label="수납"
                  value={billing.paymentRate == null ? "—" : String(Math.round(billing.paymentRate))}
                  unit={billing.paymentRate == null ? "" : "%"}
                />
                <BandMetric
                  label="이번 달 미수"
                  value={outstandingDisplay.value}
                  unit={outstandingDisplay.unit}
                  valueColor={billing.outstanding > 0 ? ACCENT_DANGER : undefined}
                  sub={
                    billing.unpaidCount > 0 ? (
                      <div className="mt-1 font-mono text-[10px] text-white/45">{billing.unpaidCount}건</div>
                    ) : undefined
                  }
                />
              </>
            ) : null}
          </div>
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

function BandMetric({
  label,
  value,
  unit,
  sub,
  valueColor,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: ReactNode;
  valueColor?: string;
}) {
  return (
    <div>
      <div className="font-mono text-[10px] tracking-wider uppercase text-white/45">{label}</div>
      <div
        className="num mt-1.5 text-[26px] font-extrabold leading-none tracking-tight"
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
        {unit ? <span className="text-[12px] font-medium text-white/45">{unit}</span> : null}
      </div>
      {sub ?? null}
    </div>
  );
}
