import { EyIcon } from "@/components/icons/eywa-icons";
import { PATH_BUCKET_COLOR } from "@/features/enrollment/path-bucket";
import type { ConsultationDistribution, EnrollmentStats } from "@/features/enrollment/server/stats-queries";
import { StatsTrend } from "./stats-trend";
import { ConsultDistPanel } from "./consult-dist-panel";
import { GRADE_UNKNOWN } from "@/features/enrollment/consultation-dist";
import type { SchoolStatsPrefs } from "@/features/enrollment/school-view-prefs";

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
  dist,
  schoolPrefs,
}: {
  stats: EnrollmentStats;
  /** null = 전체 기간. 라벨로만 쓴다. */
  year: number | null;
  dist: ConsultationDistribution;
  schoolPrefs: SchoolStatsPrefs;
}) {
  // 막대는 그 분포 안의 최대값을 가득 참으로 본다(전체 대비로 그리면 전부 납작해 비교가 안 된다).
  const maxGrade = Math.max(1, ...dist.grades.map((g) => g.n));
  const maxRegion = Math.max(1, ...dist.regions.map((r) => r.n));
  const prevTotal = stats.prevYearMonths.reduce((a, m) => a + m.total, 0);
  const prevEnrolled = stats.prevYearMonths.reduce((a, m) => a + m.enrolled, 0);
  const prevRate = prevTotal > 0 ? Math.round((prevEnrolled / prevTotal) * 100) : null;

  const pathTotal = stats.paths.reduce((a, b) => a + b.total, 0);
  const unknown = stats.paths.find((b) => b.bucket === "미기재");
  const known = pathTotal - (unknown?.total ?? 0);

  return (
    <div className="space-y-4">
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
        title={year === null ? "월별 상담·등록 (연도 비교)" : `${year}년 월별 상담·등록`}
        // 가로축이 1월~12월 12칸이고 연도는 색이라, 무엇이 색으로 갈리는지 한 줄로 밝힌다.
        sub={
          year === null
            ? "가로축은 1월~12월 · 막대 색이 연도입니다(범례는 축 아래) — 같은 달끼리 해마다 견줍니다"
            : stats.prevYearMonths.some((m) => m.total > 0)
              ? `같은 달 칸에 ${year - 1}년 상담(회색) · ${year}년 상담 · ${year}년 등록이 나란히 섭니다`
              : `${year - 1}년 데이터가 없어 전년 막대는 표시하지 않습니다`
        }
      >
        <StatsTrend
          months={stats.months}
          prevYearMonths={stats.prevYearMonths}
          year={year}
          prefs={schoolPrefs}
        />
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
                        <b className="text-foreground ml-1.5 text-sm">{b.rate}%</b>
                      ) : null}
                    </span>
                  </div>
                  {/* 🔴 매출은 **기재분 기준**임을 매번 밝힌다. 금액 기재율이 경로마다 달라
                      (실측 소개 74% vs 인터넷 51%) 합계만 나란히 놓으면 경로 비교가 왜곡된다.
                      건당 평균의 분모도 등록 건수가 아니라 '금액이 적힌 등록 건수'다. */}
                  {b.paidSum > 0 ? (
                    <div className="text-text-dim num mt-0.5 text-xs">
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
                      className="bar-grow h-full rounded-full"
                      style={{ width: `${share}%`, background: PATH_BUCKET_COLOR[b.bucket] }}
                    />
                  </div>
                  {/* 무엇이 이 버킷으로 묶였는지 — 규칙이 못 잡는 표기가 늘면 여기서 보인다. */}
                  {b.samples.length > 0 ? (
                    <details className="mt-1">
                      <summary className="text-text-faint cursor-pointer text-xs">
                        원문 {b.samples.length}종 보기
                      </summary>
                      <p className="text-text-dim mt-1 text-xs leading-relaxed break-keep">
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

      {/* 등록상담 분포 — 학년·지역. 🔴 재원생/퇴원생이 아니라 **상담**이다(원장 2026-08-05).
          그래야 위의 연도 선택이 여기에도 적용된다(재원생 기준이던 때는 연도를 바꿔도 안 변했다). */}
      {dist.total > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card
            title="학년별 상담"
            sub={(() => {
              const bad = dist.grades.find((g) => g.label === GRADE_UNKNOWN)?.n ?? 0;
              return `${year === null ? "전체 기간" : `${year}년`} 상담 ${dist.total}건 · 괄호는 등록 건수${
                bad ? ` · 학년이나 학교급을 확정할 수 없는 ${bad}건은 '분류 불가'로 뺐습니다` : ""
              }`;
            })()}
          >
            <ul className="space-y-1.5">
              {dist.grades.map((g) => (
                <li
                  key={g.label}
                  className={`flex items-center gap-2${g.label === GRADE_UNKNOWN ? " border-line mt-1 border-t pt-1.5 opacity-70" : ""}`}
                >
                  <span className="text-text-dim num w-12 shrink-0 text-xs">{g.label}</span>
                  <div className="bg-bg-soft h-3 flex-1 overflow-hidden rounded-full">
                    <div
                      className="bar-grow h-full rounded-full"
                      style={{
                        width: `${(g.n / maxGrade) * 100}%`,
                        background: KIND_COLOR[g.label[0] ?? ""] ?? "var(--color-neutral-fill)",
                      }}
                    />
                  </div>
                  <span className="text-foreground num w-16 shrink-0 text-right text-xs font-medium">
                    {g.n}건<span className="text-text-faint ml-1">({g.enrolled})</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="지역별 상담" sub="상담에 주소가 거의 없어 학교 소재지로 셉니다">
            <ul className="space-y-1.5">
              {dist.regions.map((r) => (
                <li key={r.label} className="flex items-center gap-2">
                  <span className="text-text-dim w-12 shrink-0 text-xs">{r.label}</span>
                  <div className="bg-bg-soft h-3 flex-1 overflow-hidden rounded-full">
                    <div
                      className="bar-grow h-full rounded-full"
                      style={{
                        width: `${(r.n / maxRegion) * 100}%`,
                        background: r.label === "미상" ? "var(--color-neutral-fill)" : "var(--color-primary)",
                      }}
                    />
                  </div>
                  <span className="text-foreground num w-20 shrink-0 text-right text-xs font-medium">
                    {r.n}건
                    <span className="text-text-faint ml-1">{Math.round((r.n / dist.total) * 100)}%</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      {dist.schools.length > 0 ? (
        <ConsultDistPanel
          rows={dist.schools}
          initial={schoolPrefs}
          year={year}
          hasTotals={dist.hasTotals}
          totalsYear={dist.totalsYear}
        />
      ) : null}
    </div>
  );
}
