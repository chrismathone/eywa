import type { IjwStanding, IjwStandingMetric } from "../contract";
import { Meter } from "./jj-sheet-parts";

/**
 * 인재원 **단어 순위**·**학습 배지** — 학부모 카드의 그림 자리 `[단어백분위]`·`[학습배지]`(원장 2026-10-26).
 * 원장: *"(기본모드 기준) 누적단어 수 — 학년 백분위, 반 백분위 / 장기기억단어 수 — 학년 백분위, 반 백분위"* +
 * *"단어 암기 수준에 따라 부여하는 배지 … 보고서에 넣을수도 뺄수도"*.
 * 숫자는 인재원이 센 값 그대로다(aywa가 백분위를 다시 계산하지 않는다 — 전 학생 자료는 인재원에만 있다).
 * ⚠️ 훅·"use client" 없이 순수 프레젠테이션 — 서버 카드(/r·인쇄·ClassNote 캡처)와 원스크린 미리보기가 같이 그린다.
 */

/** 1234 → "1,234" — 실행 환경 로캘과 무관하게(서버·브라우저가 같은 글자를 내야 하이드레이션이 안 깨진다). */
export function groupDigits(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * 비교 한 칸의 문구 — 이름(`label`) · 큰 값(`value`+`unit`) · 아래 줄(`sub`) · 막대(`fill`).
 * - 학년 = **"초5 학년 백분위" · 93**(14명 중 1등). 원장 2026-10-28 *"초5 백분위 93 이러니까 잘 안 읽혀서"* — 이름과 숫자를
 *   한 줄에 붙이지 않고 이름은 작게, 숫자는 크게 가른다.
 * - 반 = **"반 등수" · 1등**(8명 중). 원장 2026-10-28 *"반이름 삭제 반 등수 x 이런식으로"* — 반 이름(`중등E_초5 의치대`)은
 *   학부모가 읽을 말이 아니다. 막대는 학년과 같은 백분위로 채운다(칸끼리 같은 눈금).
 * 백분위 = 100 − 인재원 상위 %(원장 2026-10-27 *"상위 몇퍼 … 백분위로 변경"* — 꼴찌도 '상위 100%'라 좋은 말처럼 읽혔다).
 * 🔑 숫자는 인재원 상위 %에서 바로 바꾼다(전 학생 자료가 없어 다시 계산하지 않는다).
 */
/** 이보다 적은 학년은 백분위 대신 등수(1~4명 — 옛 인재원 최소 인원 5명과 같은 선). */
export const SMALL_COHORT = 5;

export function compareText(c: { label: string; rank: number; of: number; topPct: number }, kind: "학년" | "반") {
  const top = Math.min(100, Math.max(1, Math.round(c.topPct)));
  const pct = 100 - top;
  if (kind === "반") return { label: "반 등수", value: groupDigits(c.rank), unit: "등", sub: `${groupDigits(c.of)}명 중`, fill: pct };
  const grade = c.label.trim();
  // 인원이 적은 학년(원장 2026-10-28 *"인원 적어도 무조건 나오게"* — 인재원이 최소 5명을 없앴다)은 백분위가 거짓말을 한다
  // (1명 중 1등 = 백분위 0). {@link SMALL_COHORT}명 미만이면 반처럼 등수로 적는다.
  if (c.of < SMALL_COHORT)
    return { label: grade ? `${grade} 학년 등수` : "학년 등수", value: groupDigits(c.rank), unit: "등", sub: `${groupDigits(c.of)}명 중`, fill: Math.round((Math.max(0, c.of - c.rank + 1) / Math.max(1, c.of)) * 100) }; // 막대 = 몇 명을 앞섰나(1명 중 1등 = 가득)
  return { label: grade ? `${grade} 학년 백분위` : "학년 백분위", value: String(pct), unit: "", sub: `${groupDigits(c.of)}명 중 ${groupDigits(c.rank)}등`, fill: pct };
}

const FRAME = "bg-card border-line shadow-card rounded-2xl border px-5 py-4";

function MetricRow({ label, unit, m }: { label: string; unit: string; m: IjwStandingMetric }) {
  const cmps = [
    m.grade ? { key: "학년", ...compareText(m.grade, "학년") } : null,
    m.class ? { key: "반", ...compareText(m.class, "반") } : null,
  ].filter((c): c is NonNullable<typeof c> => c !== null);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-text-dim text-base font-bold">{label}</span>
        <span className="text-foreground tabular-nums">
          <span className="text-3xl leading-none font-black">{groupDigits(m.value)}</span>
          <span className="text-text-dim ml-0.5 text-base font-bold">{unit}</span>
        </span>
      </div>
      {cmps.length ? (
        <div className="grid grid-cols-2 gap-2">
          {cmps.map((c) => (
            <div key={c.key} className="bg-bg-soft flex min-w-0 flex-col gap-1.5 rounded-xl px-3 py-2.5">
              <span className="text-text-dim text-sm font-bold break-keep">{c.label}</span>
              <span className="text-primary tabular-nums">
                <span className="text-2xl leading-none font-black">{c.value}</span>
                {c.unit ? <span className="ml-0.5 text-base font-bold">{c.unit}</span> : null}
              </span>
              <Meter pct={c.fill} size="sm" />
              <span className="text-text-dim text-xs tabular-nums">{c.sub}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** `[단어백분위]` — 누적 단어 · 장기기억 단어 두 줄, 줄마다 학년·반 백분위. 그릴 게 없으면 null. */
export function JjStandingCard({ standing }: { standing: IjwStanding }) {
  const rows = [
    standing.seenWords ? { key: "seen", label: "누적 단어", m: standing.seenWords } : null,
    standing.longTermWords ? { key: "long", label: "장기기억 단어", m: standing.longTermWords } : null,
  ].filter((r): r is NonNullable<typeof r> => r !== null && (!!r.m.grade || !!r.m.class));
  if (!rows.length) return null;
  return (
    <section className={FRAME}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        {/* 인재원이 주는 계산 기준 문장(`basis`)은 싣지 않는다 — 원장 2026-10-27 *"이거 내용 삭제"*(학부모가 읽을 말이 아니다). */}
        <h3 className="text-foreground text-lg font-black">단어 학습 순위</h3>
      </div>
      <div className="divide-line flex flex-col gap-4 divide-y [&>*:not(:first-child)]:pt-4">
        {rows.map((r) => (
          <MetricRow key={r.key} label={r.label} unit="개" m={r.m} />
        ))}
      </div>
    </section>
  );
}

/** 배지 이름의 학년만 — 인재원은 `"초4 과정 통과"`로 준다(2026-10-26 실측). 꼬리가 없어도("중1") 같은 답. */
export function badgeGradeLabel(label: string): string {
  return label.trim().replace(/\s*과정\s*통과\s*$/, "").trim();
}

/** `[학습배지]` — 통과한 학년 과정 배지. 인재원이 그림 주소를 주면 그 그림, 아니면 글자 배지. */
export function JjBadgeCard({ badge }: { badge: NonNullable<IjwStanding["badge"]> }) {
  const label = badgeGradeLabel(badge.label);
  if (!label) return null;
  return (
    <section className={`${FRAME} flex items-center gap-4`}>
      {badge.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- 인재원 배지 그림(외부 절대 주소, 공개/인쇄 카드)
        <img src={badge.imageUrl} alt={`${label} 배지`} className="size-20 shrink-0 object-contain" />
      ) : (
        <span
          aria-hidden
          className="bg-report-accent text-primary-deep ring-primary flex size-20 shrink-0 items-center justify-center rounded-full text-xl font-black ring-4"
        >
          {label}
        </span>
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-text-dim text-sm font-bold">학습 레벨 배지</p>
        <p className="text-foreground text-2xl leading-tight font-black break-keep">{label} 과정 통과</p>
        <p className="text-text-dim text-xs break-keep">그 학년 단어를 빠짐없이 학습하면 받는 배지입니다.</p>
      </div>
    </section>
  );
}
