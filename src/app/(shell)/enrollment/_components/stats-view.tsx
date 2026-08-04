import Link from "next/link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { PATH_BUCKET_COLOR } from "@/features/enrollment/path-bucket";
import type { EnrollmentStats, SchoolPenetration } from "@/features/enrollment/server/stats-queries";
import { StatsTrend } from "./stats-trend";

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="bg-card shadow-card rounded-2xl p-4">
      <header className="mb-3">
        <h2 className="text-foreground text-sm font-bold">{title}</h2>
        {sub ? <p className="text-text-dim mt-0.5 text-xs">{sub}</p> : null}
      </header>
      {children}
    </section>
  );
}

/** 전년 대비 델타 — 0이거나 비교 대상이 없으면 아무것도 안 그린다(“0%”는 비교했는데 같았다는 뜻이라 다르다). */
function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (!prev) return null;
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return <span className="text-text-faint ml-1 text-xs">작년과 같음</span>;
  const up = pct > 0;
  // 방향 표시는 EyIcon — 아이콘 자리에 ▲▼ 텍스트 글리프 금지(`eywa-icon-mapping` 테스트가 잡는다).
  return (
    <span className={`ml-1 inline-flex items-center gap-0.5 text-xs font-medium ${up ? "text-chart-2" : "text-danger"}`}>
      <EyIcon name={up ? "arrowUp" : "arrowDown"} size={11} strokeWidth={1.8} />
      {Math.abs(pct)}%
    </span>
  );
}

const KIND_COLOR: Record<string, string> = {
  초: "var(--color-blue)",
  중: "var(--color-primary)",
  고: "var(--color-chart-2)",
};

export function StatsView({
  stats,
  year,
  years,
  hrefForYear,
  schools,
}: {
  stats: EnrollmentStats;
  year: number;
  years: number[];
  hrefForYear: (y: number) => string;
  schools: SchoolPenetration[];
}) {
  const prevTotal = stats.prevYearMonths.reduce((a, m) => a + m.total, 0);
  const prevEnrolled = stats.prevYearMonths.reduce((a, m) => a + m.enrolled, 0);
  const prevRate = prevTotal > 0 ? Math.round((prevEnrolled / prevTotal) * 100) : null;

  const pathTotal = stats.paths.reduce((a, b) => a + b.total, 0);
  const unknown = stats.paths.find((b) => b.bucket === "미기재");
  const known = pathTotal - (unknown?.total ?? 0);

  return (
    <div className="space-y-4">
      {/* 연도 선택 — 데이터가 있는 해만. 통계는 집계라 기간 상한(최대 1년)이 없다. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="micro shrink-0">연도</span>
        <div className="border-line inline-flex items-center gap-0.5 rounded-full border p-0.5">
          {years.map((y) => (
            <Link
              key={y}
              href={hrefForYear(y)}
              className={`num rounded-full px-3 py-1 text-xs transition ${
                y === year
                  ? "bg-foreground text-background font-medium"
                  : "text-text-dim hover:text-foreground hover:bg-bg-soft"
              }`}
            >
              {y}
            </Link>
          ))}
        </div>
      </div>

      {/* 헤드라인 — 페이지 rows가 아니라 집계 원천에서 온 수치(#89) */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "상담", value: `${stats.total}건`, delta: <Delta cur={stats.total} prev={prevTotal} /> },
          { label: "등록", value: `${stats.enrolled}건`, delta: <Delta cur={stats.enrolled} prev={prevEnrolled} /> },
          {
            label: "등록 전환율",
            value: stats.rate === null ? "—" : `${stats.rate}%`,
            delta:
              prevRate === null ? null : (
                <span className="text-text-faint ml-1 text-xs">작년 {prevRate}%</span>
              ),
          },
          { label: "등록 결제액", value: stats.paidSum > 0 ? won(stats.paidSum) : "—", delta: null },
        ].map((s) => (
          <div key={s.label} className="bg-card shadow-card rounded-2xl p-4">
            <div className="text-text-dim text-xs">{s.label}</div>
            <div className="text-foreground num mt-1 text-2xl font-bold">
              {s.value}
              {s.delta}
            </div>
          </div>
        ))}
      </div>

      <Card
        title={`${year}년 월별 상담·등록`}
        sub={
          stats.prevYearMonths.some((m) => m.total > 0)
            ? `점선 = ${year - 1}년 상담 건수(전년 동월 비교) · 금색 선 = 전환율(오른쪽 축)`
            : `금색 선 = 전환율(오른쪽 축) · ${year - 1}년 데이터가 없어 전년 비교는 표시하지 않습니다`
        }
      >
        <StatsTrend months={stats.months} prevYearMonths={stats.prevYearMonths} year={year} />
      </Card>

      <Card
        title="유입경로별 성과"
        // 🔴 미기재 비율을 제목 옆에 박는다. 이걸 숨기면 "설명회 104건"이 전체 대비인지
        //    기재분 대비인지 알 수 없고, 비율은 전부 과장돼 보인다.
        sub={
          pathTotal === 0
            ? "이 기간에 상담이 없습니다"
            : `경로가 기재된 ${known}건 기준 · 미기재 ${unknown?.total ?? 0}건(${Math.round(((unknown?.total ?? 0) / pathTotal) * 100)}%)은 아래 맨 끝에 따로 셉니다`
        }
      >
        {stats.paths.length === 0 ? (
          <p className="text-text-dim py-6 text-center text-sm">집계할 상담이 없습니다</p>
        ) : (
          <ul className="space-y-2">
            {stats.paths.map((b) => {
              const share = pathTotal > 0 ? (b.total / pathTotal) * 100 : 0;
              const isUnknown = b.bucket === "미기재";
              return (
                <li key={b.bucket} className={isUnknown ? "border-line border-t pt-2 opacity-70" : ""}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-foreground font-medium">{b.bucket}</span>
                    <span className="text-text-dim num shrink-0 text-xs">
                      {b.total}건 · 등록 {b.enrolled}
                      {b.rate !== null ? (
                        <b className="text-foreground ml-1.5 text-[13px]">{b.rate}%</b>
                      ) : null}
                    </span>
                  </div>
                  {/* 🔴 매출은 **기재분 기준**임을 매번 밝힌다. 금액 기재율이 경로마다 달라
                      (실측 소개 74% vs 인터넷 51%) 합계만 나란히 놓으면 경로 비교가 왜곡된다.
                      건당 평균의 분모도 등록 건수가 아니라 '금액이 적힌 등록 건수'다. */}
                  {b.paidSum > 0 ? (
                    <div className="text-text-dim num mt-0.5 text-[11px]">
                      매출 <b className="text-foreground">{won(b.paidSum)}</b>
                      {b.avgPaid !== null && b.paidCount ? (
                        <>
                          {" · "}건당 {won(b.avgPaid)}
                          <span className="text-text-faint">
                            {" "}
                            (등록 {b.enrolled}건 중 {b.paidCount}건 금액 기재)
                          </span>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="bg-bg-soft mt-1 h-2 overflow-hidden rounded-full">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${share}%`, background: PATH_BUCKET_COLOR[b.bucket] }}
                    />
                  </div>
                  {/* 무엇이 이 버킷으로 묶였는지 — 규칙이 못 잡는 표기가 늘면 여기서 보인다. */}
                  {b.samples.length > 0 ? (
                    <details className="mt-1">
                      <summary className="text-text-faint cursor-pointer text-[11px]">
                        원문 {b.samples.length}종 보기
                      </summary>
                      <p className="text-text-dim mt-1 text-[11px] leading-relaxed break-keep">
                        {b.samples.slice(0, 20).map((s) => `${s.path}(${s.total})`).join(" · ")}
                        {b.samples.length > 20 ? " …" : ""}
                      </p>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* 학교별 점유율 — 부산명지 지점 시트의 '주력학교 점유율'과 같은 지표.
          분모는 학교알리미 공시 전교생 수(연 1회 CSV 적재, 0180a). */}
      {schools.length > 0 ? (
        <Card
          title="학교별 점유율"
          sub={(() => {
            const known = schools.filter((s) => s.total !== null);
            const unknown = schools.length - known.length;
            const mine = schools.reduce((a, s) => a + s.ours, 0);
            return `재원생 ${mine}명이 다니는 ${schools.length}개 학교 · 전교생 대비 비율은 공시 자료가 있는 ${known.length}개교만${unknown ? ` (${unknown}개교는 공시에 없어 비율 미산출)` : ""}`;
          })()}
        >
          <ul className="space-y-2">
            {schools.slice(0, 20).map((s) => {
              // 막대는 점유율 자체를 그린다. 5%가 넘는 학교가 드물어 그대로 그리면 전부 납작하니
              // 10%를 가득 찬 것으로 본다(스케일을 부제에 밝힌다).
              const w = s.pct === null ? 0 : Math.min(100, (s.pct / 10) * 100);
              return (
                <li key={s.key}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-foreground font-medium">
                      {s.label}
                      {s.kind ? (
                        <span className="text-text-faint ml-1.5 text-[11px]">{s.kind}</span>
                      ) : null}
                    </span>
                    <span className="text-text-dim num shrink-0 text-xs">
                      {s.ours}명
                      {s.total !== null ? (
                        <>
                          {" / "}
                          {s.total.toLocaleString("ko-KR")}명
                          <b className="text-foreground ml-1.5 text-[13px]">{s.pct}%</b>
                        </>
                      ) : (
                        // 🔴 모르는 걸 0%로 적지 않는다 — "우리 학생이 없다"로 읽힌다.
                        <span className="text-text-faint ml-1.5">전교생 미상</span>
                      )}
                    </span>
                  </div>
                  <div className="bg-bg-soft mt-1 h-2 overflow-hidden rounded-full">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${w}%`, background: KIND_COLOR[s.kind ?? ""] ?? "var(--color-text-faint)" }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          {schools.length > 20 ? (
            <p className="text-text-faint mt-2 text-[11px]">
              상위 20개교만 표시 · 전체 {schools.length}개교 (막대는 점유율 10%를 가득 참으로 봅니다)
            </p>
          ) : (
            <p className="text-text-faint mt-2 text-[11px]">막대는 점유율 10%를 가득 참으로 봅니다</p>
          )}
        </Card>
      ) : null}
    </div>
  );
}
