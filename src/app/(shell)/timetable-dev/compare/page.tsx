/**
 * 시간표(개발중) — **월별 시간표 비교**.
 *
 * 원장 지시(2026-08-28): 9월·10월 시간표를 미리 만들어 관리하고 **월별 시간표를 비교**할 수 있게.
 * 🔴 본 시간표(`/timetable`·`class_schedules`)는 읽지도 쓰지도 않는다 — 이 화면은 계획 표
 *    (`timetable_plan_slots`, 0232a)만 본다(격리 가드 `timetable-dev/isolation.test.ts`).
 *
 * 비교 규칙은 전부 순수 함수 [`comparePlans`](src/features/timetable-dev/lib/compare.ts)에 있다.
 * 여기는 **조회 → 이름 붙이기 → 그리기**만 한다.
 *
 * 첫 페인트: 상위 세그먼트의 `timetable-dev/loading.tsx`가 이 라우트까지 Suspense fallback으로
 * 덮는다(B7) — 별도 loading은 두지 않는다.
 */
import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { comparePlans, type PlanDiffRow, type PlanNameResolver } from "@/features/timetable-dev/lib/compare";
import { requireTimetablePlanAccess } from "@/features/timetable-dev/server/access";
import { getPlanMonths, getPlanSlots } from "@/features/timetable-dev/server/queries";
import { PLAN_DAYS, isPlanMonth, planMonthLabel, type PlanSlot } from "@/features/timetable-dev/types";
import { MonthPairPicker } from "./_components/month-pair-picker";
import { DiffSummary } from "./_components/diff-summary";
import { DiffFilter, parseDiffScope, scopeIncludes, type DiffScope } from "./_components/diff-filter";
import { DiffTable } from "./_components/diff-table";

export const metadata = { title: "월별 시간표 비교 — eywa" };

/**
 * 한 화면에 그리는 행 상한. 한 달 계획이 1,000칸을 넘을 수 있어 '동일' 범위를 열면 표가 그만큼 길어진다.
 * ⚠️ 이 상한은 **표시만** 자른다 — 요약 카드·칩의 건수는 잘리지 않은 진짜 수다([[#89]]).
 */
const ROW_CAP = 400;

/**
 * 화면에 쓸 이름 맵. **diff에 실제로 등장한 id만** 조회한다(전건 fetch 금지 — B2).
 * 수십~수백 개가 될 수 있어 `.in()`은 반드시 `fetchInChunks`(414 + error 삼킴 방지 — B3).
 *
 * ⚠️ 임베드(`select`)에 FK 힌트를 못 박는 문제([[#94]])를 피하려고 조인 없이 표마다 따로 읽는다 —
 *    세 조회는 서로 독립이라 `Promise.all`(B4).
 * 📌 이 화면이 살아남으면 이 조회는 `timetable-dev/server/queries.ts`로 옮기는 게 맞다
 *    (지금은 그 파일이 다른 작업자 소유라 손대지 않는다).
 */
async function loadNameMaps(slots: PlanSlot[]): Promise<{
  classNames: Map<string, string>;
  resolve: PlanNameResolver;
}> {
  const classIds = [...new Set(slots.map((s) => s.classId))];
  const teacherIds = [...new Set(slots.map((s) => s.teacherId).filter((v): v is string => !!v))];
  const roomIds = [...new Set(slots.map((s) => s.classroomId).filter((v): v is string => !!v))];

  const supabase = await createClient();
  const [classRows, teacherRows, roomRows] = await Promise.all([
    fetchInChunks<{ id: string; class_name: string | null }>(classIds, (chunk) =>
      supabase.from("classes").select("id, class_name").in("id", chunk),
    ),
    fetchInChunks<{ id: string; display_name: string | null }>(teacherIds, (chunk) =>
      supabase.from("users").select("id, display_name").in("id", chunk),
    ),
    fetchInChunks<{ id: string; name: string | null }>(roomIds, (chunk) =>
      supabase.from("classrooms").select("id, name").in("id", chunk),
    ),
  ]);

  const classNames = new Map<string, string>();
  for (const r of classRows) if (r.class_name) classNames.set(r.id, r.class_name);
  const teachers = new Map<string, string>();
  for (const r of teacherRows) if (r.display_name) teachers.set(r.id, r.display_name);
  const rooms = new Map<string, string>();
  for (const r of roomRows) if (r.name) rooms.set(r.id, r.name);

  const resolve: PlanNameResolver = (kind, id) =>
    (kind === "teacher" ? teachers.get(id) : rooms.get(id)) ?? null;
  return { classNames, resolve };
}

export default async function TimetablePlanComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string; scope?: string }>;
}) {
  // 게이트는 본 시간표와 같은 메뉴(`timetable`) — 개발중 화면이 별도 권한 축을 새로 만들지 않는다.
  // requireAccess가 미로그인·무권한을 역할 홈으로 돌려보내고, 계획 표(RLS 정책 0개 + admin 조회)의
  // 유일한 게이트는 `requireTimetablePlanAccess`다(#77 — 표면이 늘어도 게이트는 하나).
  await requireAccess("timetable");
  const { a: aRaw, b: bRaw, scope: scopeRaw } = await searchParams;
  const scope = parseDiffScope(scopeRaw);

  const gate = await requireTimetablePlanAccess();

  const header = (
    <PageHeader
      eyebrow="시간표(개발중)"
      title="월별 시간표 비교"
      description="두 달의 계획을 나란히 놓고 무엇이 추가·삭제·변경됐는지 봅니다. 본 시간표에는 영향을 주지 않습니다."
      embedLabel="월별 시간표 비교"
    />
  );

  if (!gate.ok) {
    // 조회 함수는 게이트 실패를 throw한다 — 여기서 먼저 막아 창이 검게 죽는 대신 한글 배너를 보인다([[#109]]).
    return (
      <div className="flex flex-col gap-4">
        {header}
        <div className="bg-card shadow-card rounded-2xl px-5 py-10">
          <p className="text-danger text-center text-sm">{gate.error}</p>
        </div>
      </div>
    );
  }

  // 달 목록이 있어야 기본값(있는 달 중 최근 둘)을 정할 수 있어 여기만 직렬이다(진짜 의존 — B4).
  const months = await getPlanMonths();
  const known = new Set(months.map((m) => m.month));
  // 최근 달이 앞에 오도록 내림차순. 'YYYY-MM'은 문자열 정렬 = 시간 정렬이다.
  const desc = [...months].sort((x, y) => (x.month < y.month ? 1 : x.month > y.month ? -1 : 0));

  if (desc.length < 2) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <div className="bg-card shadow-card rounded-2xl px-5 py-10">
          <p className="text-text-dim text-center text-sm">
            비교하려면 계획이 있는 달이 <span className="num font-semibold">2개</span> 이상 필요합니다.
            {desc.length === 1 ? ` 지금은 ${planMonthLabel(desc[0].month)} 하나뿐입니다.` : ""} 시간표(개발중)에서
            다음 달 계획을 먼저 만들어 주세요.
          </p>
        </div>
      </div>
    );
  }

  // 기본값 = 있는 달 중 최근 둘(기준=이른 달, 비교=늦은 달 — "9월에서 10월로 무엇이 바뀌었나"가 자연스럽다).
  // URL 값은 **실제로 존재하는 달**일 때만 받는다(없는 달을 넣으면 diff가 통째로 '삭제'로 보인다).
  const pick = (raw: string | undefined, fallback: string) =>
    isPlanMonth(raw) && known.has(raw) ? raw : fallback;
  const monthA = pick(aRaw, desc[1].month);
  const monthB = pick(bRaw, desc[0].month);

  // 두 달 조회는 서로 독립 — 반드시 병렬(B4).
  const [beforeSlots, afterSlots] = await Promise.all([getPlanSlots(monthA), getPlanSlots(monthB)]);
  const diff = comparePlans(beforeSlots, afterSlots);
  const { classNames, resolve } = await loadNameMaps([...beforeSlots, ...afterSlots]);

  const beforeLabel = planMonthLabel(monthA);
  const afterLabel = planMonthLabel(monthB);

  // 사람이 읽는 순서로 다시 정렬 — 반 이름(한글 가나다) → 요일 → 시작시각.
  // (comparePlans는 이름을 모르므로 반 id로 정렬해 둔다. 정렬 축이 둘로 갈리지 않게 여기서 한 번만.)
  const dayIndex = (d: PlanDiffRow["dayOfWeek"]) => PLAN_DAYS.indexOf(d);
  const visible = diff.rows
    .filter((r) => scopeIncludes(scope, r.kind))
    .sort((x, y) => {
      const nx = classNames.get(x.classId) ?? "";
      const ny = classNames.get(y.classId) ?? "";
      const byName = nx.localeCompare(ny, "ko");
      if (byName !== 0) return byName;
      if (x.classId !== y.classId) return x.classId < y.classId ? -1 : 1;
      const byDay = dayIndex(x.dayOfWeek) - dayIndex(y.dayOfWeek);
      if (byDay !== 0) return byDay;
      return x.startTime < y.startTime ? -1 : x.startTime > y.startTime ? 1 : 0;
    });

  const hrefFor = (s: DiffScope) =>
    `/timetable-dev/compare?a=${monthA}&b=${monthB}${s === "diff" ? "" : `&scope=${s}`}`;

  return (
    <div className="flex flex-col gap-4 compact-chrome:gap-3">
      {header}

      <div className="bg-card shadow-card flex flex-col gap-3 rounded-2xl px-4 py-3">
        <MonthPairPicker months={desc} a={monthA} b={monthB} />
        <p className="text-text-dim text-xs">
          <span className="text-foreground font-semibold">{beforeLabel}</span>을 기준으로{" "}
          <span className="text-foreground font-semibold">{afterLabel}</span>이 어떻게 달라졌는지 봅니다.
          {monthA === monthB ? " 같은 달을 골라 두어 모든 칸이 '동일'로 나옵니다." : ""}
        </p>
      </div>

      <DiffSummary diff={diff} beforeLabel={beforeLabel} afterLabel={afterLabel} />

      <div className="bg-card shadow-card flex min-h-0 flex-col gap-3 rounded-2xl px-4 py-3">
        <DiffFilter diff={diff} scope={scope} hrefFor={hrefFor} />
        <DiffTable
          rows={visible.slice(0, ROW_CAP)}
          totalCount={visible.length}
          classNames={classNames}
          resolve={resolve}
          beforeLabel={beforeLabel}
          afterLabel={afterLabel}
        />
      </div>
    </div>
  );
}
