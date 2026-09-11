import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { PeriodNav } from "@/components/period-nav";
import { shiftMonth, kstMonth } from "@/lib/date-kst";
import {
  getMathSheetLanding,
  type MathClassCard,
} from "@/features/math-sheets/server/landing";
import {
  groupMathCardsByTeacher,
  splitLandingByTrack,
} from "@/features/math-sheets/landing-tracks";

export const metadata: Metadata = { title: "수학 강사 시트 — eywa" };

/** 반 이름과 진행률을 같은 열에 정렬하는 목록. */
const FULL_COLUMNS = "divide-line divide-y border-y border-line";
/**
 * 정규·특강의 각 단에도 동일한 행 구성을 사용한다.
 */
const PANEL_COLUMNS = FULL_COLUMNS;

const EMPTY_TEXT: Record<string, string> = {
  "no-classes": "활성 수학 반이 없습니다.",
  "no-scoped-classes": "담당하는 수학 반이 없습니다.",
  "no-month-classes": "이 달에 수업이 있는 수학 반이 없습니다.",
};

/**
 * MCS 랜딩 — 담임별로 묶은 수학 반 목록. 카드를 누르면 그 반의 월간 진도표가 열린다.
 *
 * 🔴 **그 달에 수업이 있는 반만** 세운다(ECS 랜딩과 같은 규칙) — 반을 먼저 세워 놓고 날짜를 세면
 *    끝난 반이 `0일` 카드로 남는다.
 * 🔴 목록은 **정규 / 특강 좌우 2단**(원장 2026-09-01) — 판정·분단 규칙은 [`landing-tracks`](@/features/math-sheets/landing-tracks)
 *    단일 소스이고, **한쪽이 비면 나누지 않는다**(*"특강 없으면 정규만"*).
 */
export default async function McsLandingPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const res = await getMathSheetLanding(month ?? null);

  if (!res.ok) {
    return (
      <div className="space-y-4">
        <PageHeader
          eyebrow="수업 운영"
          title="수학 강사 시트"
          description="반별 월간 진도"
        />
        <div className="bg-card shadow-card rounded-2xl px-4 py-6 text-sm">
          <p className="text-text-dim">{res.error}</p>
        </div>
      </div>
    );
  }

  const { data } = res;
  const thisMonth = kstMonth();
  const hrefFor = (m: string) => `/mcs?month=${m}`;
  // 한쪽이 비면 null = 나누지 않는다(원장 *"특강 없으면 정규만"*).
  const panels = splitLandingByTrack(data.cards);

  return (
    <div className="flex flex-col gap-4">
      <div className="compact-chrome:hidden">
        <PageHeader
          eyebrow="수업 운영"
          title="수학 강사 시트"
          description="반별 월간 진도 — 학생마다 제 교재·제 진도"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <PeriodNav
          label={data.monthLabel}
          prevHref={hrefFor(shiftMonth(data.month, -1))}
          nextHref={hrefFor(shiftMonth(data.month, 1))}
          currentHref={hrefFor(thisMonth)}
          relation={
            data.month === thisMonth
              ? "current"
              : data.month < thisMonth
                ? "past"
                : "future"
          }
          prevAriaLabel="이전 달"
          nextAriaLabel="다음 달"
          currentTitle="눌러서 이번 달로"
        />
        <span className="text-text-faint text-xs font-bold">
          반 {data.cards.length}개
        </span>
        <WrittenSummary
          cards={data.cards}
          className="text-text-dim num text-xs font-bold"
        />
      </div>

      {data.emptyReason ? (
        <p className="text-text-faint rounded-2xl border border-dashed p-8 text-center text-sm">
          {EMPTY_TEXT[data.emptyReason] ?? "표시할 반이 없습니다."}
        </p>
      ) : panels ? (
        // 원장 2026-09-01 *"정규 / 특강 좌우 2단으로 분리시켜 정렬"*. 한쪽이 비면 `panels === null`이라
        // 아래 단일 흐름으로 떨어진다(*"특강 없으면 정규만"*).
        <div className="grid grid-cols-1 gap-y-5 md:grid-cols-2 md:gap-x-5">
          {panels.map((panel) => (
            // 오른쪽 단에만 세로 구분선. 세로선은 행 높이만큼 길어 가로선과 같은 농도면 훨씬 세게
            // 읽힌다 → 한 단계 옅은 `--line-faint`(표 규약과 같은 이유).
            <section
              key={panel.key}
              className={
                panel.key === "special"
                  ? "md:border-line-faint md:border-l md:pl-5"
                  : undefined
              }
            >
              <div className="border-line mb-2 flex items-baseline gap-1.5 border-b px-1 pb-1.5">
                {/* 단의 **간판** — 담임 묶음 머리(15px)와 형태로 갈라야 크기 경쟁 없이 위계가 선다.
                    🔴 채우기는 `-soft`(연한 틴트)까지 — 꽉 찬 네이비는 활성 필터 칩과 같은 모양이라
                    "눌러서 고르는 것"으로 읽힌다(이건 라벨이지 버튼이 아니다). */}
                <h3 className="border-primary bg-primary-soft text-primary rounded-pill border px-2.5 py-0.5 text-base font-bold">
                  {panel.label}
                </h3>
                <span className="text-text-dim text-xs">
                  <span className="num">{panel.cards.length}</span>반
                </span>
                {/* ⚠️ 작성률은 **그 단 몫만** 센다 — 합치면 옆 단 숫자가 섞여 "정규는 썼는데 특강이
                    비었다"를 못 읽는다. 위 전체 줄과 같은 함수라 산식은 하나다. */}
                <WrittenSummary
                  cards={panel.cards}
                  className="text-text-dim num ml-auto text-xs"
                />
              </div>
              {/* 단 안에선 담임이 정규/특강 **아래** 층이다 — 제목 층을 실제 구조대로 내린다
                  (스크린리더가 제목으로 훑을 때 두 축이 같은 층이면 포함 관계가 안 보인다). */}
              <TeacherGroups
                groups={groupMathCardsByTeacher(panel.cards)}
                month={data.month}
                columnsClass={PANEL_COLUMNS}
                headingLevel="h4"
              />
            </section>
          ))}
        </div>
      ) : (
        <TeacherGroups
          groups={data.byTeacher}
          month={data.month}
          columnsClass={FULL_COLUMNS}
        />
      )}
    </div>
  );
}

/**
 * 담임 묶음 흐름 한 벌 — 단일 목록이든 좌우 한 단이든 **같은 기계**로 그린다(두 벌이면 갈린다).
 */
function TeacherGroups({
  groups,
  month,
  columnsClass,
  headingLevel = "h3",
}: {
  groups: readonly { teacherName: string; cards: MathClassCard[] }[];
  month: string;
  columnsClass: string;
  /** 묶음 제목의 층 — 분단 안이면 h4(그 단의 h3 아래), 단일 목록이면 h3(PageHeader가 h2다). */
  headingLevel?: "h3" | "h4";
}) {
  const Heading = headingLevel;
  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <section key={group.teacherName} className="flex flex-col gap-2">
          <Heading className="text-base font-bold">
            {group.teacherName}
          </Heading>
          <div className={columnsClass}>
            {group.cards.map((card) => (
              <Link
                key={card.classId}
                href={`/mcs/${card.classId}/month?month=${month}`}
                className="grid grid-cols-[minmax(0,1fr)_minmax(120px,0.7fr)] items-center gap-x-3 gap-y-0.5 px-2 py-2 transition hover:bg-primary-soft/40 focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className="truncate text-base font-bold" title={card.className}>
                  {card.className}
                </span>
                {/* 🔴 "학생 N명" = **현재 재원**이다. 시트 줄 수(= N + 회색·예정)를 그대로 적으면
                        현재 재원 0명인 특강이 "학생 7명"이 된다(적대적 리뷰 2026-09-01). 남는 줄은
                        `+N`으로 따로 적어 둘을 더하면 시트 줄 수가 되게 한다. */}
                <span
                  className="text-text-faint num col-start-1 row-start-2 text-xs"
                  title={card.extraTitle ?? undefined}
                >
                  수업 {card.dayCount}일 · 학생 {card.studentCount}명
                  {card.extraCount > 0 ? (
                    <span className="text-text-faint"> +{card.extraCount}</span>
                  ) : null}
                </span>
                {/* 작성도 — 원장 2026-09-01 "영어처럼 작성도를 프로그레스바처럼 볼 수 있으면".
                        🔴 분모는 **온 칸**(기록 + 왔는데 안 적힘)이라 시트 툴바와 같은 수를 말한다.
                        🔴 `shown === 0`이면 아직 아무도 안 온 달이라 **막대를 그리지 않는다** —
                           0을 100%로 그리면 다음 달 목록이 전부 꽉 찬 막대가 된다(ECS의 `—`와 같은 결). */}
                <span className="col-start-2 row-span-2 row-start-1 flex items-center gap-1.5">
                  {card.elapsedDays === 0 ? (
                    <span
                      className="text-text-faint text-xs"
                      title="이 달에 아직 수업이 지나지 않았습니다"
                    >
                      아직 수업 전
                    </span>
                  ) : card.shown === 0 ? (
                    // 달은 지났는데 온 학생이 없다 — '아직 수업 전'과 다른 사실이라 다르게 적는다.
                    <span
                      className="text-text-faint text-xs"
                      title="이 달 수업일에 출석 기록이 없습니다(전원 결석이거나 출결을 안 찍었습니다)"
                    >
                      출결 기록 없음
                    </span>
                  ) : (
                    <>
                      <span className="num text-foreground w-12 shrink-0 text-xs font-bold">
                        {card.written}/{card.shown}
                      </span>
                      <span className="bg-bg-soft h-1.5 min-w-0 flex-1 overflow-hidden rounded-full">
                        <span
                          className={`block h-full rounded-full ${
                            card.pct === 100 ? "bg-green" : "bg-primary"
                          }`}
                          style={{ width: `${card.pct}%` }}
                        />
                      </span>
                      {/* w-9(36px)에선 v5 14px `100%`(≈38px)가 두 줄(`100` / `%`)로 꺾였다(실브라우저 2026-09-08) → w-11. */}
                      <span className="num text-text-faint w-11 shrink-0 text-right text-xs whitespace-nowrap">
                        {card.pct}%
                      </span>
                    </>
                  )}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * 작성률 한 조각 — 전체 줄과 단 머리가 **같은 산식**을 쓴다(0으로 나누는 자리를 흩으면 하나는 함정이 된다).
 *
 * 🔴 분모 `shown`이 0이면 **아무것도 그리지 않는다** — 아직 아무도 안 온 달이라 0을 100%로 그리면
 *    다음 달 목록이 전부 꽉 찬 것처럼 보인다(카드 막대와 같은 규약).
 */
function WrittenSummary({
  cards,
  className,
}: {
  cards: readonly MathClassCard[];
  className: string;
}) {
  const written = cards.reduce((a, c) => a + c.written, 0);
  const shown = cards.reduce((a, c) => a + c.shown, 0);
  if (shown === 0) return null;
  return (
    <span className={className}>
      작성 {written}/{shown} ({Math.round((written / shown) * 100)}%)
    </span>
  );
}
