/**
 * Greeting Card — 시안 사양: 우상단 트리링 SVG + 키커 + 30px 800 H1 + max-540 본문
 */
type Props = {
  name: string;
  enrolledStudents: number;
  attendanceDelta?: string | null;
  unpaidCount?: number;
};

const KO_DATE_FULL = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
});

function getOpenDays(): number {
  // 학원 오픈 17일째 placeholder (시드 재구성 단계 7에서 교체)
  return 17;
}

export function DashboardHero({ name, enrolledStudents, attendanceDelta, unpaidCount }: Props) {
  const today = new Date();
  const parts = KO_DATE_FULL.formatToParts(today);
  const year = parts.find((p) => p.type === "year")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";

  const eyebrow = `${year} · ${month} · ${day} · ${weekday} · 학원 ${getOpenDays()}일째`;

  return (
    <section className="bg-card border-line shadow-card relative overflow-hidden rounded-2xl border px-7 py-6">
      {/* 우상단 트리링 SVG 장식 */}
      <svg
        className="pointer-events-none absolute top-0 right-0 opacity-50"
        width="220"
        height="220"
        viewBox="0 0 220 220"
        aria-hidden="true"
      >
        {[100, 80, 60, 40, 20].map((r, i) => (
          <circle
            key={r}
            cx="110"
            cy="110"
            r={r}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="1"
            opacity={0.15 + i * 0.05}
          />
        ))}
        <circle cx="110" cy="110" r="5" fill="var(--gold)" />
      </svg>

      <div className="relative">
        <p className="text-primary font-mono text-[11px] tracking-wider uppercase">{eyebrow}</p>
        <h1 className="text-foreground mt-2.5 text-[30px] font-extrabold tracking-tight">
          안녕하세요, <span className="text-primary">{name}</span> 원장님.
        </h1>
        <p className="text-text-dim mt-3 max-w-[540px] text-[13px] leading-relaxed">
          오늘 재원생은 <span className="text-foreground num font-semibold">{enrolledStudents}명</span>이고,{" "}
          {attendanceDelta
            ? `출석률은 평소보다 ${attendanceDelta} 변동했어요.`
            : "출석률을 한번 살펴보세요."}{" "}
          {unpaidCount && unpaidCount > 0
            ? `미수금 ${unpaidCount}건이 남았어요.`
            : "이번 주도 잘 부탁드립니다."}
        </p>
      </div>
    </section>
  );
}
