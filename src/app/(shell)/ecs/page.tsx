import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/lib/auth/require-access";
import { PageHeader } from "@/components/page-header";
import { WeekNav } from "@/app/(shell)/timetable/_components/week-nav";
import { getSheetLanding } from "@/features/class-sheets/server/queries";

export const metadata: Metadata = { title: "English Class Sheet — eywa" };

/**
 * ECS 랜딩 — 영어 반 카드 + 주간 작성 상태. 반 카드를 누르면 같은 창에서 주간 시트로 드릴인.
 * 강사(scoped)는 담당 반만 보인다(effectiveTeacherScope — getSheetLanding 내부).
 */
export default async function EcsLandingPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  await requireAccess("ecs");
  const { week } = await searchParams;
  const res = await getSheetLanding(week ?? null);

  if (!res.ok) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="수업 운영" title="English Class Sheet" description="영어 반별 주간 수업계획서/출석부" />
        <p className="bg-card shadow-card text-text-dim rounded-2xl px-4 py-6 text-sm">{res.error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="수업 운영"
        title="English Class Sheet"
        description={`영어 반별 주간 수업계획서/출석부 · ${res.weekLabel}`}
        embedLabel={`English Class Sheet · ${res.weekLabel}`}
      />

      <div className="bg-card shadow-card flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3">
        <WeekNav currentWeek={res.weekMonday} today={res.today} hrefForWeek={(monday) => `/ecs?week=${monday}`} />
      </div>

      {res.cards.length === 0 ? (
        // 원인별로 다른 안내 — 담당 반이 없는 강사에게 "학원 설정을 확인하라"고 하면
        // 고칠 수 없는 일을 시키는 거짓 안내가 된다(원인 오표시 금지).
        <p className="bg-card shadow-card text-text-dim rounded-2xl px-4 py-6 text-sm">
          {res.emptyReason === "no-scoped-classes"
            ? "담당하고 계신 영어 반이 없습니다. 반 배정은 사무실에 문의하세요."
            : res.emptyReason === "not-configured"
              ? "영어 과목의 수업계획(English Class Sheet) 영역이 아직 설정되지 않았습니다. 학원 설정 → 과목 운영에서 영역을 지정하세요."
              : "이 주에 운영 중인 영어 반이 없습니다."}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {res.cards.map((card) => {
            const pct = card.totalSlots > 0 ? Math.round((card.filledSlots / card.totalSlots) * 100) : 0;
            return (
              // 카드 높이 균형: grid stretch + flex-col + 통계줄 mt-auto — 짧은 카드도 같은 높이·하단 정렬
              <Link
                key={card.classId}
                href={`/ecs/${card.classId}?week=${res.weekMonday}`}
                className="bg-card shadow-card hover:shadow-md flex h-full flex-col rounded-2xl px-4 py-3 transition"
              >
                <p className="text-foreground truncate text-[14px] font-bold">{card.className}</p>
                <p className="text-text-dim mt-0.5 text-[12px]">{card.teacherName ?? "담임 미지정"}</p>
                {card.orphanSlots > 0 ? (
                  <p className="text-text-faint mt-1 text-[11px]">시간 변경된 기록 {card.orphanSlots}건</p>
                ) : null}
                <div className="mt-auto flex items-center gap-2 pt-2">
                  <span className="num text-foreground text-[13px] font-bold">
                    {card.filledSlots}/{card.totalSlots}
                  </span>
                  <span className="text-text-faint text-[11px]">교시 작성</span>
                  <span className="bg-bg-soft ml-auto h-1.5 w-16 overflow-hidden rounded-full">
                    <span className="bg-primary block h-full rounded-full" style={{ width: `${pct}%` }} />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
