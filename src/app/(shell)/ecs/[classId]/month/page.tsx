import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { getSheetLanding } from "@/features/class-sheets/server/queries";
import { getClassSheetMonth } from "@/features/class-sheets/server/month-queries";
import { MonthClient } from "@/features/class-sheets/components/month-client";
import { readFromWeek } from "@/features/class-sheets/face-nav";
import { SheetWidthGate } from "@/features/class-sheets/components/sheet-width-gate";

export const metadata: Metadata = { title: "영어 강사 시트 · 월간 — eywa" };

/**
 * ECS **월간 뷰** — 반 1개 × 달 1개(달력 ↔ 진도표).
 *
 * 주간 시트와 **별도 라우트**인 이유: 주간은 출결·로스터·저장 큐를 든 무거운 클라 화면이고 월간은
 * 훑는 화면이라, 한 페이지에서 갈라 놓으면 월간을 여는 데도 주간의 짐이 딸려 온다.
 * 게이트는 조회 안의 `requireEcsClassAccess`(주간과 같은 함수 — #77 "모든 표면이 같은 게이트를").
 */
export default async function EcsMonthPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string }>;
  // ⚠️ 값은 `string | string[]`이다(`?view=cal&view=rail`이면 배열) — 아래 판정은 문자열 일치라
  //    배열이 와도 안전하게 저장값으로 떨어진다. 타입을 좁게 적어 두면 나중에 `.trim()` 한 줄에 터진다.
  searchParams: Promise<{ month?: string; view?: string | string[]; week?: string | string[] }>;
}) {
  const { classId } = await params;
  const { month, view, week } = await searchParams;
  const [res, landing] = await Promise.all([
    getClassSheetMonth(classId, month ?? null),
    getSheetLanding(null), // 반 전환 드롭다운(주간 시트와 같은 스코프)
  ]);

  if (!res.ok) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="수업 운영" title="영어 강사 시트 · 월간" description="반별 월간 진도" />
        <div className="bg-card shadow-card space-y-2 rounded-2xl px-4 py-6 text-sm">
          <p className="text-text-dim">{res.error}</p>
          <Link href="/ecs" className="text-primary font-bold underline-offset-2 hover:underline">
            반 목록으로
          </Link>
        </div>
      </div>
    );
  }

  // 필터 밖의 반으로 바로 들어와도 드롭다운이 "지금 보는 반"을 잃지 않게 맨 앞에 끼운다(주간 시트 규약).
  const listed = landing.ok ? landing.cards.map((c) => ({ id: c.classId, name: c.className })) : [];
  const classOptions = listed.some((o) => o.id === classId)
    ? listed
    : [{ id: classId, name: res.data.className }, ...listed];

  /**
   * 보기(달력/진도표)는 **계정에 저장된 값이 기본**이고, 주소에 실려 오면 이번 방문만 그것을 따른다 —
   * 주간 시트의 `주간 | 달력 | 진도표` 전환이 "진도표로 가자"를 이 파라미터로 말한다.
   * ⚠️ 모르는 값은 **저장값으로 떨어진다**(`normalizeEcsMonthView`를 쓰면 달력으로 눌러 버려서, 진도표를
   *    쓰는 사람이 주소 한 글자 때문에 달력으로 열린다).
   */
  const initialView = view === "cal" || view === "rail" ? view : res.data.view;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="shrink-0 compact-chrome:hidden">
        <PageHeader
          eyebrow="수업 운영"
          title={`영어 강사 시트 · 월간 — ${res.data.className}`}
          description={`${res.data.monthLabel} · 계획 ${res.data.fill.filled}/${res.data.fill.total}교시`}
        />
      </div>
      {/* 주간 시트와 **같은 폭 게이트** — 두 화면이 같은 폭에서 같은 말을 해야 한다. */}
      <SheetWidthGate>
        <MonthClient
          // 달·반이 바뀌면 클라 상태(보기·목표 편집 큐)를 새로 세운다 — 옛 달의 목표가 남으면
          // 새 달 화면에 남의 값이 잠깐 비친다.
          // 🔴 보기(`view`)는 key에 **넣지 않는다** — 화면 안에서 보기를 바꾸면 주소만 조용히 따라
          //    고치는데(month-client `chooseView`), key에 넣으면 그 다음 `router.refresh()`가 이 껍데기를
          //    통째로 다시 마운트해 **열려 있던 '그 날 고치기' 창이 사라진다**.
          key={`${classId}:${res.data.month}`}
          data={res.data}
          classOptions={classOptions}
          initialView={initialView}
          initialDisplay={res.data.display}
          // 주간 시트에서 넘어왔으면 **왔던 주**를 들고 온다 — '주간'을 누르면 그 주로 정확히
          // 돌아간다(왕복이 제자리로). 모양이 아니면 버린다(face-nav `readFromWeek`).
          fromWeek={readFromWeek(week)}
        />
      </SheetWidthGate>
    </div>
  );
}
