import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { PeriodNav } from "@/components/period-nav";
import { shiftMonth, kstMonth } from "@/lib/date-kst";
import { getMathSheetLanding } from "@/features/math-sheets/server/landing";

export const metadata: Metadata = { title: "수학 강사 시트 — eywa" };

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
        <PageHeader eyebrow="수업 운영" title="수학 강사 시트" description="반별 월간 진도" />
        <div className="bg-card shadow-card rounded-2xl px-4 py-6 text-sm">
          <p className="text-text-dim">{res.error}</p>
        </div>
      </div>
    );
  }

  const { data } = res;
  const thisMonth = kstMonth();
  const hrefFor = (m: string) => `/mcs?month=${m}`;

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
          relation={data.month === thisMonth ? "current" : data.month < thisMonth ? "past" : "future"}
          prevAriaLabel="이전 달"
          nextAriaLabel="다음 달"
          currentTitle="눌러서 이번 달로"
        />
        <span className="text-text-faint text-xs font-bold">반 {data.cards.length}개</span>
      </div>

      {data.emptyReason ? (
        <p className="text-text-faint rounded-2xl border border-dashed p-8 text-center text-sm">
          {EMPTY_TEXT[data.emptyReason] ?? "표시할 반이 없습니다."}
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {data.byTeacher.map((group) => (
            <section key={group.teacherName} className="flex flex-col gap-2">
              <h2 className="text-[15px] font-extrabold">{group.teacherName}</h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {group.cards.map((card) => (
                  <Link
                    key={card.classId}
                    href={`/mcs/${card.classId}/month?month=${data.month}`}
                    className="border-line hover:border-primary flex flex-col gap-1 rounded-xl border bg-white p-3 transition"
                  >
                    <span className="truncate text-[13.5px] font-extrabold">{card.className}</span>
                    <span className="text-text-faint num text-[11.5px]">
                      수업 {card.dayCount}일 · 학생 {card.studentCount}명
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
