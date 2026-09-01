import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { getMathSheetMonth } from "@/features/math-sheets/server/month-queries";
import { countRosterPhases, rosterExtraParts } from "@/features/math-sheets/lib/roster";
import { MonthClient } from "@/features/math-sheets/components/month-client";

export const metadata: Metadata = { title: "수학 강사 시트 · 월간 — eywa" };

/**
 * MCS **월간 뷰** — 반 1개 × 달 1개(진도표 ↔ 진도 레일).
 *
 * ECS와 나란한 화면이지만 **축이 다르다**: 영어는 영역 × 날짜, 수학은 **학생 × 수업일**이다.
 * 수학은 같은 반 같은 날에도 학생마다 다른 교재를 나가서(실측 2026-08: 2명 이상 묶음의 79%)
 * 반 한 줄짜리 계획으로는 사실을 담을 수 없다.
 * 게이트는 조회 안의 `requireMcsClassAccess`([[#77]] "모든 표면이 같은 게이트를").
 */
export default async function McsMonthPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { classId } = await params;
  const { month } = await searchParams;
  const res = await getMathSheetMonth(classId, month ?? null);

  if (!res.ok) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="수업 운영" title="수학 강사 시트 · 월간" description="반별 월간 진도" />
        <div className="bg-card shadow-card space-y-2 rounded-2xl px-4 py-6 text-sm">
          <p className="text-text-dim">{res.error}</p>
          <Link href="/mcs" className="text-primary font-bold underline-offset-2 hover:underline">
            반 목록으로
          </Link>
        </div>
      </div>
    );
  }

  const { data } = res;
  // 🔴 줄 수를 "학생 N명"이라 적지 않는다 — 행에는 이 달 중 나간 사람과 아직 안 들어온 사람이
  //    섞여 있다(카드와 **같은 함수**로 센다).
  const counts = countRosterPhases(data.students.map((s) => s.rosterPhase));
  // 카드 툴팁과 **같은 문구**로 적는다(각자 지으면 같은 수를 다른 이름으로 부른다).
  const extraLabel = rosterExtraParts(counts);
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="shrink-0 compact-chrome:hidden">
        <PageHeader
          eyebrow="수업 운영"
          title={`수학 강사 시트 · 월간 — ${data.className}`}
          description={[
            data.monthLabel,
            `수업 ${data.days.length}일`,
            `학생 ${counts.on}명`,
            ...extraLabel,
          ].join(" · ")}
        />
      </div>
      <div className="min-h-0 flex-1">
        <MonthClient
          // 달·반이 바뀌면 클라 상태(보기·목표 편집 큐)를 새로 세운다 — 옛 달의 목표가 남으면
          // 새 달 화면에 남의 값이 잠깐 비친다.
          key={`${classId}:${data.month}`}
          data={data}
        />
      </div>
    </div>
  );
}
