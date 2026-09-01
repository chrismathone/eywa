import type { Metadata } from "next";
import { monthDay } from "@/features/timetable/scheduled-import";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { PageHeader } from "@/components/page-header";
import { getClassSheetWeek, getSheetLanding } from "@/features/class-sheets/server/queries";
import { SheetClient } from "@/features/class-sheets/components/sheet-client";
import { SheetWidthGate } from "@/features/class-sheets/components/sheet-width-gate";

export const metadata: Metadata = { title: "영어 강사 시트 — eywa" };

/**
 * ECS 주간 시트 — 반 1개 × 주 1개. key={classId:week:JJ표시}로 클라 상태를 재초기화한다
 * (주/반 전환·JJ 표시 전환 = 재마운트).
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
        <PageHeader eyebrow="수업 운영" title="영어 강사 시트" description="영어 반별 주간 수업계획서/출석부" />
        <div className="bg-card shadow-card space-y-2 rounded-2xl px-4 py-6 text-sm">
          <p className="text-text-dim">{!user ? "로그인이 필요합니다" : !res.ok ? res.error : ""}</p>
          <Link href="/ecs" className="text-primary font-bold underline-offset-2 hover:underline">
            반 목록으로
          </Link>
        </div>
      </div>
    );
  }

  // 🔴 랜딩 목록은 **보기 필터**(프로그램·담임)가 걸린 목록이다. 링크·북마크로 필터 밖의 반에 바로
  //    들어오면 지금 보고 있는 반이 옵션에 없고, 그러면 상단 드롭다운이 반 이름 대신 '반 선택'이라는
  //    빈 표시로 바뀐다 — 화면이 "지금 무엇을 보고 있는지"를 잃는다. 없으면 현재 반을 맨 앞에 끼운다.
  //    (담임 필터가 생기면서 4/42로 좁아지는 일이 흔해져 실제로 밟히는 길이 됐다, 2026-08-11.)
  const listed = landing.ok ? landing.cards.map((c) => ({ id: c.classId, name: c.className })) : [];
  const classOptions = listed.some((o) => o.id === classId)
    ? listed
    : [{ id: classId, name: res.data.className }, ...listed];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* 그리드 화면이라 세로 공간 우선 — 창(embed)에선 헤더 통째 숨김(timetable 선례) */}
      <div className="shrink-0 compact-chrome:hidden">
        <PageHeader
          eyebrow="수업 운영"
          title={`영어 강사 시트 — ${res.data.className}`}
          description={[
            res.data.weekLabel,
            `계획 ${res.data.fill.filledSlots}/${res.data.fill.totalSlots}교시`,
            // 예약된 개명을 헤더에 한 줄로 — 시트를 열어 놓고도 "이 반이 곧 뭐가 되는지" 알 수 있게.
            // 예고는 전환 주뿐 아니라 **예약된 때부터 그날까지 내내** 뜬다(원장 2026-08-29).
            // 🔴 **이미 지나간 개명은 안 적는다**(원장 2026-08-31) — 제목이 이미 그 주 이름이라
            //    '이전 이름 …'은 되짚을 일 없는 군더더기다. 랜딩 목록 배지와 같은 규약.
            res.data.classNameUpcoming
              ? `${monthDay(res.data.classNameUpcoming.date)}부터 ${res.data.className} → ${res.data.classNameUpcoming.name}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        />
      </div>
      {/* 못 쓰는 폭(≈하루 한 칸도 안 들어감)에선 시트 대신 "넓혀 주세요" 안내 — 판정은 CSS 한 곳. */}
      <SheetWidthGate>
        <SheetClient
          // JJ 표시도 key에 넣는다 — 토글은 서버 재조회라, 재마운트하지 않으면 클라가 들고 있는
          // 계획 행 state가 옛 슬롯 구성 그대로 남아 새로 열린 교시가 빈 칸으로 보인다.
          // ⚠️ 로스터 접힘은 여기 안 넣는다(클라 state가 진실 — key에 넣으면 접을 때마다 시트가 재마운트된다).
          key={`${classId}:${res.data.weekMonday}:${res.data.showSelfStudy ? "jj" : "nojj"}`}
          data={res.data}
          classOptions={classOptions}
          userId={user.id}
          tenantId={user.tenantId}
        />
      </SheetWidthGate>
    </div>
  );
}
