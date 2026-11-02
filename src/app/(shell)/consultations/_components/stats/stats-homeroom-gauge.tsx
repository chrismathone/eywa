"use client";

import { useState } from "react";
import { Pill } from "@/components/atoms/pill";
import { useSubjectMaps } from "@/features/owner/operations-context";
import type { HomeroomMonth, HomeroomTeacher } from "@/features/consultations/homeroom-model";
import { bucketLabel, pct } from "@/features/consultations/stats-model";
import { HomeroomGaugeModal } from "./stats-homeroom-gauge-modal";

const fmt = (n: number) => n.toLocaleString("ko-KR");
const mLabel = (ym: string) => bucketLabel(`${ym}-01`, "month");
/** 카드에 세우는 달 수 — 지난달 + 이번 달(진행 중). 기간이 길어져도 카드 폭이 그대로다(달별 전부는 '표' 보기). */
const GAUGE_MONTHS = 2;

// 반원 게이지 기하 — 중심(100,100) · 바깥 90 · 안 62. 값 0%가 왼쪽 끝, 100%가 오른쪽 끝.
const CX = 100;
const CY = 100;
const R_OUT = 90;
const R_IN = 62;
const BANDS = 5;
const GAP = 1.2; // 칸 사이 틈(% 단위)

function point(v: number, r: number): [number, number] {
  const a = Math.PI * (1 - v / 100);
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
}

/** 값 구간 [from, to](%)의 도넛 조각 경로. */
function arc(from: number, to: number): string {
  const [x1, y1] = point(from, R_OUT);
  const [x2, y2] = point(to, R_OUT);
  const [x3, y3] = point(to, R_IN);
  const [x4, y4] = point(from, R_IN);
  return `M${x1},${y1} A${R_OUT},${R_OUT} 0 0 1 ${x2},${y2} L${x3},${y3} A${R_IN},${R_IN} 0 0 0 ${x4},${y4} Z`;
}

/** 칸 색 — 낮은 쪽 초록에서 높은 쪽 파랑으로(원장이 보낸 시안의 계기판). 의미색 토큰만 섞는다. */
const bandColor = (i: number) => `color-mix(in srgb, var(--green) ${100 - (i * 100) / (BANDS - 1)}%, var(--blue))`;

/**
 * 반원 계기판 — 5칸(20%씩)을 바늘이 가리키는 값까지 칠한다. 값이 없으면(그 달 대상 0명) 칸은 회색, 바늘 없음.
 * 글자는 SVG 밖 HTML로 둔다(Pretendard 부분 글꼴이 SVG 글자를 못 잡는다, gotchas #3).
 */
export function RateGauge({ rate, label }: { rate: number | null; label: string }) {
  const v = rate === null ? null : Math.max(0, Math.min(100, rate));
  const bands = Array.from({ length: BANDS }, (_, i) => {
    const from = (i * 100) / BANDS + (i === 0 ? 0 : GAP / 2);
    const to = ((i + 1) * 100) / BANDS - (i === BANDS - 1 ? 0 : GAP / 2);
    return { i, from, to };
  });
  const tip = v === null ? null : point(v, R_OUT - 8);
  return (
    <svg viewBox="0 0 200 110" className="mx-auto block w-full max-w-48" role="img" aria-label={`${label} ${v === null ? "대상 없음" : `${Math.round(v)}%`}`}>
      {bands.map((b) => (
        <path key={`bg${b.i}`} d={arc(b.from, b.to)} fill="var(--muted)" />
      ))}
      {v !== null
        ? bands
            .filter((b) => v > b.from)
            .map((b) => <path key={`on${b.i}`} d={arc(b.from, Math.min(b.to, v))} fill={bandColor(b.i)} />)
        : null}
      {tip ? (
        <>
          <line x1={CX} y1={CY} x2={tip[0]} y2={tip[1]} stroke="var(--foreground)" strokeWidth={5} strokeLinecap="round" />
          <circle cx={CX} cy={CY} r={6} fill="var(--foreground)" />
        </>
      ) : null}
    </svg>
  );
}

export function MonthGauge({ ym, m, current }: { ym: string; m: HomeroomMonth; current: boolean }) {
  const rate = pct(m.self, m.target);
  const label = current ? `${mLabel(ym)}(진행 중)` : mLabel(ym);
  return (
    <span className="block min-w-0 flex-1 text-center" title={`담임 상담 ${m.self} · 담임 아닌 직원이 상담 ${m.other} · 미상담 ${m.none}`}>
      <span className="block text-muted-foreground mb-1 text-xs font-medium">{label}</span>
      <RateGauge rate={rate} label={label} />
      <span className="block num mt-1 text-xl leading-tight font-bold">{rate === null ? "—" : `${Math.round(rate)}%`}</span>
      <span className="block num text-muted-foreground text-xs">
        {m.self}/{m.target}명
      </span>
    </span>
  );
}

/** 담임 한 명 = 카드 한 장 — 지난달·이번 달 상담률 계기판 + 학생 수·퇴원·미상담. 카드를 누르면 상세 모달(달별 계기판·학생 표). */
function TeacherGaugeCard({ t, months, prevMonth, onOpen }: { t: HomeroomTeacher; months: string[]; prevMonth: string; onOpen: () => void }) {
  const subjects = useSubjectMaps();
  const last = t.months.length - 1;
  const now = t.months[last]!;
  const start = Math.max(0, months.length - GAUGE_MONTHS);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="border-line hover:bg-bg-soft flex flex-col gap-2 rounded-2xl border p-3 text-left"
      title={`${t.classNames.join(", ")} — 누르면 학생별 상세를 엽니다`}
    >
      <span className="flex items-center gap-1.5">
        <span className="text-foreground text-sm font-bold">{t.name}</span>
        {t.subjects.map((k) => (
          <Pill key={k} color={subjects.colorOf(k)}>
            {subjects.labelOf(k)}
          </Pill>
        ))}
      </span>
      <span className="flex gap-2">
        {months.slice(start).map((ym, i) => (
          <MonthGauge key={ym} ym={ym} m={t.months[start + i]!} current={start + i === last} />
        ))}
      </span>
      <span className="border-line grid grid-cols-3 gap-1 border-t pt-2 text-center text-xs">
        <span>
          <span className="text-muted-foreground block">학생</span>
          <span className="num font-medium">
            {fmt(t.prev.students)} → {fmt(t.students.length)}
          </span>
        </span>
        <span title={t.prev.withdrawn.map((s) => s.name).join(", ")}>
          <span className="text-muted-foreground block">{mLabel(prevMonth)} 퇴원</span>
          <span className="num font-medium">{t.prev.withdrawn.length > 0 ? `${fmt(t.prev.withdrawn.length)}명` : "—"}</span>
        </span>
        <span title={now.other > 0 ? `담임 아닌 직원 상담 ${now.other}명` : undefined}>
          <span className="text-muted-foreground block">이번 달 미상담</span>
          <span className={`num font-bold ${now.none > 0 ? "text-danger" : "text-muted-foreground"}`}>{fmt(now.none)}명</span>
        </span>
      </span>
    </button>
  );
}

/** 게이지 보기(원장 2026-11-02 — 시안 사진의 계기판 디자인) — 표와 같은 담임·같은 정렬·같은 골라 보기를 카드로. */
export function HomeroomGaugeGrid({
  teachers,
  months,
  prevMonth,
}: {
  teachers: readonly HomeroomTeacher[];
  months: string[];
  prevMonth: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  // 골라 보기로 그 담임이 빠지면 모달도 닫힌다(없는 사람의 상세가 떠 있지 않게).
  const opened = teachers.find((t) => t.id === openId) ?? null;
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3">
        {teachers.map((t) => (
          <TeacherGaugeCard key={t.id} t={t} months={months} prevMonth={prevMonth} onOpen={() => setOpenId(t.id)} />
        ))}
      </div>
      <HomeroomGaugeModal t={opened} months={months} prevMonth={prevMonth} onClose={() => setOpenId(null)} />
    </>
  );
}
