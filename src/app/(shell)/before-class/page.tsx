import { PageHeader } from "@/components/page-header";
import { PeriodNav } from "@/components/period-nav";
import { Toolbar } from "@/components/toolbar";
import { requireAccess } from "@/lib/auth/require-access";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { isValidYm, kstMonth, kstToday, monthLabel, shiftMonth } from "@/lib/date-kst";
import { defaultCheckDate } from "@/features/before-class/dates";
import { loadClassMonth, loadTargets } from "@/features/before-class/server/queries";
import { ClassPicker } from "@/features/before-class/components/class-picker";
import { ChecklistBoard } from "@/features/before-class/components/board";

export const metadata = { title: "비포클래스체크리스트(초안) — 에이와" };

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * 비포클래스체크리스트(초안, 원장 2026-10-28) — 수업 전 숙제·준비 체크(구글 시트 이식). 시험 반(`before_class_targets`)만 선다.
 * 권한 = 메뉴 `before_class_checklist` — 전체면 체크, 읽기면 보기만. 반·달은 주소(`?class=` · `?month=`), 날짜·보기 전환은 화면 안.
 */
export default async function BeforeClassPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireAccess("before_class_checklist");
  const sp = await searchParams;
  const rawMonth = one(sp.month);
  const month = rawMonth && isValidYm(rawMonth) ? rawMonth : kstMonth();
  const [level, { ready, targets }] = await Promise.all([
    accessLevelTenant(user.systemRole, "before_class_checklist"),
    loadTargets(user.tenantId),
  ]);
  const current = targets.find((t) => t.id === one(sp.class)) ?? targets[0] ?? null;
  const data = current ? await loadClassMonth(user.tenantId, current.id, month) : null;
  const href = (m: string) => `/before-class?${current ? `class=${current.id}&` : ""}month=${m}`;
  const thisMonth = kstMonth();

  return (
    <div className="space-y-4">
      <PageHeader title="비포클래스체크리스트(초안)" description="수업 전 숙제·준비 체크 — 미흡 3개 이상이면 보충 필요" />
      {!ready ? (
        <p className="text-text-dim px-1 py-6 text-sm">준비 중입니다 — 저장 공간이 아직 만들어지지 않았습니다.</p>
      ) : !current || !data ? (
        <p className="text-text-dim px-1 py-6 text-sm">체크리스트를 쓰는 반이 아직 없습니다.</p>
      ) : (
        <>
          <Toolbar>
            <ClassPicker targets={targets} current={current.id} month={month} />
            <PeriodNav
              label={monthLabel(month)}
              prevHref={href(shiftMonth(month, -1))}
              nextHref={href(shiftMonth(month, 1))}
              currentHref={href(thisMonth)}
              relation={month < thisMonth ? "past" : month > thisMonth ? "future" : "current"}
            />
          </Toolbar>
          <ChecklistBoard
            key={`${current.id}|${month}`}
            classId={current.id}
            dates={data.dates}
            students={data.students}
            initialChecks={data.checks}
            initialDate={defaultCheckDate(data.dates, kstToday())}
            today={kstToday()}
            canEdit={level === "full"}
          />
        </>
      )}
    </div>
  );
}
