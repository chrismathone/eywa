/**
 * ① 커맨드 밴드 — 다크 ink 표면 위 인사말 + 재원/출석/수납/미수 4지표 한 줄.
 * Daylight 라이트 페이지 위 '계기판' 액센트(테마 플립 아님). 밴드 전용 강조색은
 * 로컬 상수(라이트그린/danger-light) — 다크 표면 전용이라 globals 토큰 추가 안 함.
 */
const KO_DATE_FULL = new Intl.DateTimeFormat("ko-KR", {
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
  name,
  enrolled,
  enrolledDelta,
  attendanceRate,
  paymentRate,
  unpaidCount,
  newStudents,
  withdrawn,
}: {
  name: string;
  enrolled: number;
  enrolledDelta: number;
  attendanceRate: number | null;
  paymentRate: number | null;
  unpaidCount: number;
  newStudents: EnrollmentChangeStudent[];
  withdrawn: EnrollmentChangeStudent[];
}) {
  const parts = KO_DATE_FULL.formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const eyebrow = `${get("year")}.${get("month")}.${get("day")} ${get("weekday")} · 학원 17일째`;
  const deltaText = enrolledDelta === 0 ? "±0" : enrolledDelta > 0 ? `+${enrolledDelta}` : `${enrolledDelta}`;

  return (
    <section className="bg-ink relative overflow-hidden rounded-2xl px-6 py-5 text-white">
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
          <h1 className="mt-2 text-[25px] font-extrabold tracking-tight">안녕하세요, {name} 원장님.</h1>
          <p className="mt-1.5 text-[12px] text-white/50">
            {unpaidCount > 0 ? `오늘은 미수 ${unpaidCount}건만 챙기면 됩니다.` : "오늘도 잘 부탁드립니다."}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-x-7 gap-y-4 sm:grid-cols-4 lg:gap-x-8">
          <BandMetric
            label="재원"
            value={String(enrolled)}
            unit="명"
            sub={
              <EnrollmentChangeModal
                deltaText={deltaText}
                newStudents={newStudents}
                withdrawn={withdrawn}
              />
            }
          />
          <BandMetric
            label="출석"
            value={attendanceRate == null ? "—" : String(Math.round(attendanceRate))}
            unit={attendanceRate == null ? "" : "%"}
            valueColor={attendanceRate == null ? undefined : ACCENT_GREEN}
          />
          <BandMetric
            label="수납"
            value={paymentRate == null ? "—" : String(Math.round(paymentRate))}
            unit={paymentRate == null ? "" : "%"}
          />
          <BandMetric
            label="미수"
            value={String(unpaidCount)}
            unit="건"
            valueColor={unpaidCount > 0 ? ACCENT_DANGER : undefined}
          />
        </div>
      </div>
    </section>
  );
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
