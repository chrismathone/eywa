import { WindowLink } from "@/components/workspace/window-link";
import { notFound } from "next/navigation";
import { CalendarDays, Pencil, Wallet } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/atoms/pill";
import { requireAccess } from "@/lib/auth/require-access";
import { BackLink } from "@/components/back-link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { assignableRoles, canManageStaffMember } from "@/lib/auth/role-hierarchy";
import { getStaffById } from "@/features/staff/server/queries";
import { roleMeta, staffStatusMeta } from "@/features/staff/status-labels";
import { getResumeByStaffUser } from "@/features/staff/server/resume-queries";
import { canViewResume } from "@/features/staff/server/resume-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { resolveTenantReadUrls } from "@/lib/storage/media-storage";
import { getSuperAdminIds, displayRoleFor } from "@/lib/auth/super-admin";
import { StaffTabsNav, isStaffTabKey } from "./_components/tabs-nav";
import { BasicInfoTab } from "./_tabs/basic-info-tab";
import { MonthlyScheduleTab } from "./_tabs/monthly-schedule-tab";
import { ClassesTab } from "./_tabs/classes-tab";
import { ActivityLogTab } from "./_tabs/activity-log-tab";
import { PAYROLL_ENABLED } from "@/features/payroll/config";

export const metadata = { title: "직원 상세 — eywa" };


export default async function StaffDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  await requireAccess("staff");
  const { id } = await params;
  const { tab: tabParam, page: pageParam } = await searchParams;
  const tabRaw = isStaffTabKey(tabParam) ? tabParam : "info";
  const activityPage = Math.max(1, Number(pageParam) || 1);

  const [staff, viewer, superAdminIds] = await Promise.all([
    getStaffById(id),
    getCurrentUser(),
    getSuperAdminIds(),
  ]);
  if (!staff) notFound();

  // 표시 위장(fake admin) — 배지·버튼 노출 등 '보이는 것'에만. 위계/권한 판정엔 실제 staff.systemRole 사용.
  const displayRole = displayRoleFor(staff.id, staff.systemRole, superAdminIds);

  const canManage = !!viewer && (await canWriteTenant(viewer.systemRole, "staff"));
  // 활동 로그 탭은 사무실 전용 — 비-사무실이 ?tab=activity로 직접 와도 기본정보로 폴백(RLS도 별도 방어).
  const tab = tabRaw === "activity" && !canManage ? "info" : tabRaw;
  // 계정 관리 카드 = **메뉴 쓰기 권한(개인 예외 포함) AND 대상 보호선** 둘 다(2026-08-11).
  // canManageStaffMember는 이제 대상만 본다(원장 계정만 차단) — canManage를 빼면 staff=readonly인
  // 사람에게도 카드가 떠서 "버튼은 보이는데 누르면 거부"가 된다(서버 loadTarget이 막긴 하지만 거짓 UI).
  const canManageThis = canManage && !!viewer && canManageStaffMember(viewer.systemRole, staff.systemRole);
  // 역할 변경 옵션 — actor가 부여할 수 있는(본인보다 약한) 역할만. 패널 자체가 canManageThis로 게이트됨.
  const roleOptions = canManageThis && viewer ? assignableRoles(viewer.systemRole) : [];
  // 급여 노출은 원장(master) + 본인만 (schema.ts 주석). admin/manager에게도 보이면 안 됨.
  const canSeeSalary = !!viewer && (viewer.systemRole === "master" || viewer.id === staff.id);
  // 기본정보 탭의 이력서 섹션 — 열람은 이력서 공용 게이트(원장·관리자)와 동일([[#77]] 우회 방지).
  // 이 상세가 곧 그 직원의 이력서이므로 소유자 = staff.id(본인이 자기 상세를 보면 통과).
  const resumeAccess = tab === "info" && !!viewer && (await canViewResume(viewer, staff.id));
  const resume = resumeAccess ? await getResumeByStaffUser(staff.id) : null;
  const resumeCanWrite = resumeAccess && !!viewer && (await canWriteTenant(viewer.systemRole, "staff"));
  // 증명사진 signed URL(슬라이드) — 게이트 통과 시에만 발급.
  const resumePhotoUrls =
    resume && viewer && resume.data.photos.length > 0
      ? await (async () => {
          const map = await resolveTenantReadUrls(resume.data.photos, "document", viewer.tenantId);
          return resume.data.photos.map((p) => map[p] ?? null);
        })()
      : [];
  // 역할·상태 배지 = 직원목록과 같은 단일 소스(features/staff/status-labels) — 화면마다 색이 갈리지 않게.
  const role = roleMeta(displayRole);
  const status = staffStatusMeta(staff.status) ?? staffStatusMeta("active")!;
  // 급여·휴가 버튼 노출은 표시 역할 기준(위장된 admin은 일반 관리자처럼 미노출) — 순수 표시.
  const isTeacherLike = displayRole === "teacher" || displayRole === "master";

  return (
    // print-portrait — 기본정보(종이 서식)·이력서만 세로 A4로 인쇄. 헤더·탭·계정관리 등 화면 크롬은 print:hidden.
    <div className="print-portrait space-y-6">
      <div className="print:hidden">
        <BackLink href="/staff" label="직원관리로" />
      </div>

      <header className="border-border print:hidden flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="space-y-1">
            <p className="eyebrow">직원</p>
            <h1 className="font-bold tracking-tight text-foreground text-2xl">{staff.displayName}</h1>
            <p className="text-text-dim num text-xs">{staff.email}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <Pill color={role.color}>{role.label}</Pill>
            <Pill color={status.color} soft>
              {status.label}
            </Pill>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* ⚠️ 라벨을 그냥 "수정"으로 두지 말 것 — 이 화면엔 여는 대상이 다른 편집 진입점이 **셋**이다
                (원장 지적 2026-08-07, 모바일에서 특히 붙어 보인다):
                  · 여기 = **직원 정보**(이름·연락처·직급·담당 과목·시간표 색·기본 강의실·채용일·메모)
                  · 인적사항 카드 = **이력서**(종이 서식 전체)
                  · 아래 '계정 관리' 패널 = 이메일 변경·비밀번호 재설정·역할 변경·직원 삭제
                🔴 그래서 여기를 "계정 수정"이라 부르면 안 된다 — 이 폼엔 이메일·비밀번호·역할이 **없다**
                (역할은 생성 때만, 수정 모드엔 필드 자체가 없음). 이름이 실제로 여는 것과 맞아야 한다. */}
            {canManage ? (
              <Button
                variant="outline"
                size="sm"
                render={<WindowLink href={`/staff/${staff.id}/edit`} title={`${staff.displayName} 직원 정보 수정`} />}
              >
                <Pencil className="size-3.5" />
                직원 정보 수정
              </Button>
            ) : null}
            {isTeacherLike ? (
              <>
                {PAYROLL_ENABLED ? (
                  <Button
                    variant="outline"
                    size="sm"
                    render={<WindowLink href={`/staff/${staff.id}/payroll`} title="급여 정산" />}
                  >
                    <Wallet className="size-3.5" />
                    급여
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  render={<WindowLink href={`/staff/${staff.id}/leaves`} title="휴가 관리" />}
                >
                  <CalendarDays className="size-3.5" />
                  휴가
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </header>

      <div className="print:hidden">
        <StaffTabsNav staffId={staff.id} active={tab} showActivity={canManage} />
      </div>

      <section>
        {tab === "info" ? (
          <BasicInfoTab
            staff={staff}
            displayRole={displayRole}
            canManageThis={canManageThis}
            // 계약 갱신은 **직원관리 쓰기(사무실)** 기준 — canManageThis(나보다 낮은 직급만)를 쓰면
            // 원장이 원장 계약을, 관리자가 관리자 계약을 갱신하지 못해 버튼이 사라진다(서버·RLS는 통과하는데).
            canManageContracts={canManage}
            showSalary={canSeeSalary}
            roleOptions={roleOptions}
            resume={resume}
            resumeAccess={resumeAccess}
            resumeCanWrite={resumeCanWrite}
            resumePhotoUrls={resumePhotoUrls}
          />
        ) : tab === "monthly" ? (
          <MonthlyScheduleTab staffId={staff.id} staffName={staff.displayName} canManage={canManage} />
        ) : tab === "classes" ? (
          <ClassesTab staffId={staff.id} />
        ) : tab === "activity" ? (
          <ActivityLogTab userId={staff.id} page={activityPage} />
        ) : null}
      </section>
    </div>
  );
}
