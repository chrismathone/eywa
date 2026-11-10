import { EyIcon } from "@/components/icons/aywa-icons";
import { PATH_BUCKET_COLOR } from "@/features/enrollment/path-bucket";
import type { ConsultationDistribution, EnrollmentStats } from "@/features/enrollment/server/stats-queries";
import type { ManagementExits } from "@/features/enrollment/management-sheet";
import { StatsTrend } from "./stats-trend";
import { ConsultDistPanel } from "./consult-dist-panel";
import { GRADE_UNKNOWN } from "@/features/enrollment/consultation-dist";
import type { SchoolStatsPrefs } from "@/features/enrollment/school-view-prefs";
import { CompactStatsList } from "./compact-stats-list";
import { ManagementSheetCard } from "./management-sheet-card";

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

function Card({ title, sub, children, className = "" }: { title: string; sub?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`bg-card shadow-card flex min-w-0 flex-col rounded-2xl p-4 ${className}`}>
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
  // 방향 표시는 EyIcon — 아이콘 자리에 ▲▼ 텍스트 글리프 금지(`aywa-icon-mapping` 테스트가 잡는다).
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
  periodText,
  yearChips,
  exits,
  dist,
  schoolPrefs,
}: {
  stats: EnrollmentStats;
  /** null = 전체 기간. 라벨로만 쓴다. */
  year: number | null;
  /** 연도 칩이 정한 기간('2026년' · '2024~2026년') — 카드 안 기간을 따로 고르는 위 두 카드와 갈리게 밝힌다. */
  periodText: string;
  /** 연도 칩(머리글 툴바에서 옮겨 왔다 — 원장 2026-10-22). 이 구역 안에서 스크롤을 따라온다. */
  yearChips: React.ReactNode;
  /** 관리현황 '등록 후 퇴원'(퇴원관리를 열 수 있는 사람만 · 못 불러오면 null = 칸 없음). */
  exits: ManagementExits | null;
  dist: ConsultationDistribution;
  schoolPrefs: SchoolStatsPrefs;
}) {
  // 막대는 그 분포 안의 최대값을 가득 참으로 본다(전체 대비로 그리면 전부 납작해 비교가 안 된다).
  const maxGrade = Math.max(1, ...dist.grades.map((g) => g.n));
  const maxRegion = Math.max(1, ...dist.regions.map((r) => r.n));
  // 증감의 비교 대상 — 올해면 작년 **같은 기간**(1월 1일 ~ 작년 오늘), 지난해면 그 전해 1~12월(검수 2026-10-22).
  //    올해(오늘까지)를 작년 1~12월 전체와 견주면 '상담 −45%' 같은 거짓 감소가 선다.
  const same = stats.prevSamePeriod ?? null;
  const prevTotal = same ? same.total : stats.prevYearMonths.reduce((a, m) => a + m.total, 0);
  const prevEnrolled = same ? same.enrolled : stats.prevYearMonths.reduce((a, m) => a + m.enrolled, 0);
  const prevRate = prevTotal > 0 ? Math.round((prevEnrolled / prevTotal) * 100) : null;
  const prevLabel = same ? "작년 같은 기간" : "작년";

  const pathTotal = stats.paths.reduce((a, b) => a + b.total, 0);
  const unknown = stats.paths.find((b) => b.bucket === "미기재");
  const known = pathTotal - (unknown?.total ?? 0);
  // 결제액은 금액이 적힌 등록만 더한다 — 실측 2025-07 이후 등록 대부분이 금액 칸이 비어 있어(2026-10-22), 합계만 두면 매출이 준 것처럼 읽힌다.
  // 분모는 유입경로 집계의 '금액이 적힌 등록'(0179a paid_cnt — 같은 기간·같은 표). 옛 함수라 칸이 없으면 안 적는다.
  const paidCount = stats.paths.some((b) => b.paidCount !== null) ? stats.paths.reduce((a, b) => a + (b.paidCount ?? 0), 0) : null;

  return (
    // `#conversion` = 운영실 '신규 콜&상담 전환'의 상세가 닿는 자리(`admissionsStatsHref`).
    <div id="conversion" className="scroll-mt-4 space-y-4">
      {/* 연도 칩 = 이 아래 카드들의 기간(원장 2026-10-22 *"너무 위쪽에 있어서 아래쪽과 작동하는게 헷갈림. 해당 위치로 이동할것"* —
          머리글 툴바에서 옮겼다). 이 구역 안에선 스크롤을 따라온다(원장 2026-08-05 *연도를 눌러가며 아래 숫자가 바뀌는 걸 보려면*).
          위 '신규 문의 추이'·'상담 진행 기록'은 카드 안 기간을 따로 쓴다. */}
      <div className="bg-bg-canvas sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1 py-2">
        {yearChips}
        <p className="text-text-dim text-xs break-keep">
          아래 카드 기간 · {periodText}
          {same ? ` · 증감은 작년 같은 기간(1월 1일 ~ ${Number(same.to.slice(5, 7))}월 ${Number(same.to.slice(8, 10))}일)과 견줍니다` : ""}
        </p>
      </div>
      <div className="space-y-1.5">
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
                <span className="text-text-faint ml-1 text-xs">{prevLabel} {prevRate}%</span>
              ),
          },
          {
            label: "과거 기재 결제액",
            value: stats.paidSum > 0 ? won(stats.paidSum) : "—",
            delta:
              paidCount === null || stats.enrolled === 0 ? null : (
                <span className="text-text-faint ml-1 text-xs whitespace-nowrap">
                  등록 {stats.enrolled}건 중 {paidCount}건 금액 기재
                </span>
              ),
          },
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
      </div>

      {/* 관리현황 — 시트처럼 달마다 한 줄(원장 2026-10-22 *"시트처럼 한눈에 · 상담대비 완료율 · 과목별"*). 헤드라인과 같은 기간·같은 축. */}
      <ManagementSheetCard sheet={dist.sheet} groups={dist.sheetGroups} periodText={periodText} exits={exits} />

      <div className="grid items-stretch gap-4 lg:grid-cols-2 xl:grid-cols-3">
      <Card
        className="lg:col-span-2"
        // 여러 해를 견줄 땐 그래프가 상담 건수뿐이다(등록은 '전환율'로 본다) — 제목에 '등록'을 적지 않는다(검수 2026-10-22).
        title={year === null ? "월별 상담 (연도 비교)" : `${year}년 월별 상담·등록`}
        // 가로축이 1월~12월 12칸이고 연도는 색이라, 무엇이 색으로 갈리는지 한 줄로 밝힌다.
        sub={
          year === null
            ? "월별 상담 건수 · 색이 연도입니다(범례는 그래프 아래) — 같은 달끼리 해마다 견줍니다 · 등록 비율은 '전환율'을 켜서 봅니다"
            : stats.prevYearMonths.some((m) => m.total > 0)
              ? `달마다 ${year - 1}년 상담(회색) · ${year}년 상담 · ${year}년 등록을 견줍니다`
              : `${year - 1}년 데이터가 없어 전년 상담은 표시하지 않습니다`
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
          // '미기재'는 늘 맨 끝이다 — 접힌 상태에서도 그 줄을 남긴다(제목 옆 설명이 "맨 끝에 따로 셉니다"라고 말한다).
          <CompactStatsList label="유입경로별 성과" limit={4} keepLast={!!unknown}>
            {stats.paths.map((b) => {
              const share = pathTotal > 0 ? (b.total / pathTotal) * 100 : 0;
              const isUnknown = b.bucket === "미기재";
              return (
                <li key={b.bucket} className={isUnknown ? "border-line border-t pt-2 opacity-70" : ""}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
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
                      과거 기재 결제액 <b className="text-foreground">{won(b.paidSum)}</b>
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
          </CompactStatsList>
        )}
      </Card>

      {/* 등록상담 분포 — 학년·지역. 🔴 재원생/퇴원생이 아니라 **상담**이다(원장 2026-08-05).
          그래야 위의 연도 선택이 여기에도 적용된다(재원생 기준이던 때는 연도를 바꿔도 안 변했다). */}
      {dist.total > 0 ? (
        <>
          <Card
            title="학년별 상담"
            sub={(() => {
              const bad = dist.grades.find((g) => g.label === GRADE_UNKNOWN)?.n ?? 0;
              return `${periodText} 상담 ${dist.total}건 · 괄호는 등록 건수${
                bad ? ` · 학년이나 학교급을 확정할 수 없는 ${bad}건은 '분류 불가'로 뺐습니다` : ""
              }`;
            })()}
          >
            <CompactStatsList label="학년별 상담 분포" className="space-y-1.5" limit={10} keepLast={dist.grades.at(-1)?.label === GRADE_UNKNOWN}>
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
                  {/* w-20(80px)+nowrap — 2026-09-08 v5 글자 기준 실측: text-xs 14px에서 `123건(45)`≈74.5px라 옛 w-16(64px)은 `건`/`(` 사이에서 접혀 그 행만 키가 커졌다 */}
                  <span className="text-foreground num w-20 shrink-0 text-right text-xs font-medium whitespace-nowrap">
                    {g.n}건<span className="text-text-faint ml-1">({g.enrolled})</span>
                  </span>
                </li>
              ))}
            </CompactStatsList>
          </Card>

          <Card title="지역별 상담" sub="상담에 주소가 거의 없어 학교 소재지로 셉니다">
            <CompactStatsList label="지역별 상담 분포" className="space-y-1.5" limit={10} keepLast={dist.regions.at(-1)?.label === "미상"}>
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
            </CompactStatsList>
          </Card>
        </>
      ) : null}
      {dist.schools.length > 0 ? (
        <ConsultDistPanel
          rows={dist.schools}
          initial={schoolPrefs}
          year={year}
          periodText={periodText}
          hasTotals={dist.hasTotals}
          totalsYear={dist.totalsYear}
        />
      ) : null}
      </div>
    </div>
  );
}
