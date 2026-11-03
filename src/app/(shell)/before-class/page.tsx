import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { isValidYm, kstMonth, kstToday } from "@/lib/date-kst";
import { pickCheckDate } from "@/features/before-class/dates";
import { loadClassMonth, loadTargetChoices, loadTargets } from "@/features/before-class/server/queries";
import { canManageBeforeClassTargets } from "@/features/before-class/server/target-gate";
import { TargetManager } from "@/features/before-class/components/target-manager";
import { ClassPicker } from "@/features/before-class/components/class-picker";
import { ChecklistBoard } from "@/features/before-class/components/board";
import { getTenantSettings } from "@/features/owner/server/queries";
import { reportLogoPath } from "@/features/owner/report-logo";
import { NEUTRAL_ACADEMY_NAME } from "@/features/owner/defaults";
import { resolveBrandingSrc } from "@/lib/storage/media-storage";

export const metadata = { title: "비포클래스체크리스트 — 에이와" };

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * 비포클래스체크리스트(초안, 원장 2026-10-28) — 수업 전 숙제·준비 체크(구글 시트 이식). 시험 반(`before_class_targets`)만 선다.
 * 권한 = 메뉴 `before_class_checklist` — 전체면 체크, 읽기면 보기만. 반 넣고 빼기('반 관리')는 수업 관리 권한까지 있는 계정만(target-gate.ts). 반·달은 주소(`?class=` · `?month=`), 날짜·보기 전환은 화면 안.
 * 달을 넘나드는 수업일 화살표는 `?date=`(날짜 · `first` · `last`)로 그 달에서 고를 날을 넘긴다.
 */
export default async function BeforeClassPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireAccess("before_class_checklist");
  const sp = await searchParams;
  const rawMonth = one(sp.month);
  const month = rawMonth && isValidYm(rawMonth) ? rawMonth : kstMonth();
  const [level, { ready, targets }, canManage] = await Promise.all([
    accessLevelTenant(user.systemRole, "before_class_checklist"),
    loadTargets(user.tenantId),
    canManageBeforeClassTargets(user.systemRole),
  ]);
  const current = targets.find((t) => t.id === one(sp.class)) ?? targets[0] ?? null;
  const [data, settings, choices] = await Promise.all([
    current ? loadClassMonth(user.tenantId, current.id, month) : Promise.resolve(null),
    getTenantSettings(),
    // 반 관리 후보 — 관리 권한이 있을 때만 읽는다.
    ready && canManage ? loadTargetChoices(user.tenantId, targets.map((t) => t.id), kstToday()) : Promise.resolve(null),
  ]);
  const manager = choices ? <TargetManager targets={targets} choices={choices} /> : null;
  // 보고서 시안의 로고 — 학부모 보고서와 같은 해석(실패해도 로고 없이 그린다).
  const logoPath = reportLogoPath(settings);
  const logoSrc = logoPath ? await resolveBrandingSrc(logoPath, user.tenantId).catch(() => null) : null;
  const academyName = settings.profile.name || NEUTRAL_ACADEMY_NAME;

  return (
    <div className="space-y-4">
      <PageHeader title="비포클래스체크리스트" description="수업 전 숙제·준비 체크 — 미흡 3개 이상이면 보충 필요" />
      {!ready ? (
        <p className="text-text-dim px-1 py-6 text-sm">준비 중입니다 — 저장 공간이 아직 만들어지지 않았습니다.</p>
      ) : !current || !data ? (
        <div className="space-y-3">
          {manager}
          <p className="text-text-dim px-1 py-6 text-sm">체크리스트를 쓰는 반이 아직 없습니다.</p>
        </div>
      ) : (
        <>
          <ChecklistBoard
            key={`${current.id}|${month}`}
            classId={current.id}
            month={month}
            dates={data.dates}
            students={data.students}
            initialChecks={data.checks}
            autoExcused={data.autoExcused}
            offDays={data.offDays}
            initialDate={pickCheckDate(data.dates, kstToday(), one(sp.date))}
            today={kstToday()}
            trackingStart={data.trackingStart}
            canEdit={level === "full"}
            report={{ levels: data.reportLevels, className: current.name, teacherName: current.teacherName, logoSrc, academyName }}
            classPicker={
              <>
                <ClassPicker targets={targets} current={current.id} month={month} />
                {manager}
              </>
            }
          />
        </>
      )}
    </div>
  );
}
