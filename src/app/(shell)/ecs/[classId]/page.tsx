import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { PageHeader } from "@/components/page-header";
import { getClassSheetWeek, getSheetLanding } from "@/features/class-sheets/server/queries";
import { SheetClient } from "@/features/class-sheets/components/sheet-client";

export const metadata: Metadata = { title: "English Class Sheet — eywa" };

/**
 * ECS 주간 시트 — 반 1개 × 주 1개. key={classId:week}로 클라 상태를 재초기화한다(주/반 전환 = 재마운트).
 * 게이트는 getClassSheetWeek 내부의 requireEcsClassAccess(조회·액션 공용 — #77).
 */
export default async function EcsSheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string }>;
  searchParams: Promise<{ week?: string; day?: string }>;
}) {
  const { classId } = await params;
  const { week } = await searchParams;
  const user = await getCurrentUser();
  const [res, landing] = await Promise.all([
    getClassSheetWeek(classId, week ?? null),
    getSheetLanding(week ?? null), // 반 전환 드롭다운 옵션(스코프 동일)
  ]);

  if (!user || !res.ok) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="수업 운영" title="English Class Sheet" description="영어 반별 주간 수업계획서/출석부" />
        <div className="bg-card shadow-card space-y-2 rounded-2xl px-4 py-6 text-sm">
          <p className="text-text-dim">{!user ? "로그인이 필요합니다" : !res.ok ? res.error : ""}</p>
          <Link href="/ecs" className="text-primary font-bold underline-offset-2 hover:underline">
            반 목록으로
          </Link>
        </div>
      </div>
    );
  }

  const classOptions = landing.ok ? landing.cards.map((c) => ({ id: c.classId, name: c.className })) : [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* 그리드 화면이라 세로 공간 우선 — 창(embed)에선 헤더 통째 숨김(timetable 선례) */}
      <div className="shrink-0 compact-chrome:hidden">
        <PageHeader
          eyebrow="수업 운영"
          title={`English Class Sheet — ${res.data.className}`}
          description={`${res.data.weekLabel} · 계획 ${res.data.fill.filledSlots}/${res.data.fill.totalSlots}교시`}
        />
      </div>
      <div className="min-h-0 flex-1">
        <SheetClient
          key={`${classId}:${res.data.weekMonday}`}
          data={res.data}
          classOptions={classOptions}
          userId={user.id}
          tenantId={user.tenantId}
        />
      </div>
    </div>
  );
}
