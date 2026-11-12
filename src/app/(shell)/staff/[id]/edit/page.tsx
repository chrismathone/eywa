import { WindowLink } from "@/components/workspace/window-link";
import { notFound, redirect } from "next/navigation";
import { CalendarDays, Wallet } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { BackLink } from "@/components/back-link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getStaffById } from "@/features/staff/server/queries";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { protectionStatus } from "@/lib/auth/protected-accounts";
import { isFullShellRole } from "@/lib/auth/view-as";
import { StaffForm } from "../../_components/staff-form";
import { isPayrollEnabled, isStaffLeavesEnabled } from "@/features/payroll/config";
import { getTenantSettings } from "@/features/owner/server/queries";
import { DashboardAssignmentForm } from "../../_components/dashboard-assignment-form";

export const metadata = { title: "근무 설정 — 에이와" };

export default async function EditStaffPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccess("staff");
  const user = await getCurrentUser();
  if (!user || !(await canWriteTenant(user.systemRole, "staff"))) {
    redirect("/staff");
  }

  const { id } = await params;
  const staff = await getStaffById(id);
  if (!staff) notFound();
  const settings = await getTenantSettings();
  // 이메일 칸은 근무 설정에 없다 — 로그인 이메일 창구는 **이력서 인적사항 E-mail**과 **계정 관리** 둘이고
  // 둘 다 applyStaffEmailChange(단일 구현)를 탄다. 옛 판정(canEditLoginEmail + auth 왕복)이 사라져
  // 이 창이 한 번 덜 왕복한다.
  // '강사뷰 접근' 토글(0224a) — master(+super_admin)에게만 노출(서버 액션이 같은 자격으로 이중 게이트).
  // 강사·학생 역할에겐 소비처가 없어(풀셸 전용) 숨긴다 — 서버도 같은 조건으로 거절(이중 게이트).
  const canAssignDashboard = user.systemRole === "master" || (await isCurrentUserSuperAdmin());
  const canAssignTarget = canAssignDashboard && (await protectionStatus(staff.id)) === "clear";
  const canGrantTeacherView = canAssignTarget &&
    isFullShellRole(staff.systemRole);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/staff" label="직원관리로" />

      <header className="border-border flex flex-wrap items-end justify-between gap-3 border-b pb-5">
        <div className="space-y-1">
          {/* 들어온 버튼('근무 설정')과 같은 말로 — 열고 나서 "여기가 거기 맞나" 하지 않게. */}
          <p className="eyebrow">근무 설정</p>
          <h1 className="font-bold tracking-tight text-foreground text-2xl">{staff.displayName}</h1>
          {/* 무엇이 여기 있고 무엇이 없는지 적는다 — 없는 걸 찾다가 되돌아 나가는 게 가장 큰 낭비다. */}
          <p className="text-muted-foreground text-sm">
            담당 과목·강의실·시간표 색·알림 수신·담당 토글·메모 (인적사항·계약은 이력서, 계정은 직원 상세에서)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* 급여 정산은 강사·원장 한정 유지 — 시급/월급 산식이 그 둘 전제다. */}
          {isPayrollEnabled(settings) && (staff.systemRole === "teacher" || staff.systemRole === "master") ? (
            <Button variant="outline" render={<WindowLink href={`/staff/${staff.id}/payroll`} title="급여 정산" />}>
              <Wallet className="size-4" />
              급여 정산
            </Button>
          ) : null}
          {/* 휴가는 **전 직원** 기능이라 대상의 역할로 가리지 않는다(2026-08-03 원장 지시).
              예전엔 급여와 한 조건에 묶여 teacher|master만 보였고, 그 결과 반을 맡은 부원장(admin)·
              행정 직원의 휴가를 아예 열 수 없었다. ⚠️ 이 버튼은 게이트가 아니다 — 실제 권한은
              /staff/[id]/leaves가 requireAccess("staff") + canManageStaff·canWriteTenant로 잡는다
              (버튼을 숨겨도 URL로 열렸다 = 숨김은 잠금이 아니다, gotcha #77).
              침산은 기존 결정대로 숨기고 일반 지점은 기능 설정을 따른다. */}
          {isStaffLeavesEnabled(settings) ? (
            <Button variant="outline" render={<WindowLink href={`/staff/${staff.id}/leaves`} title="휴가 관리" />}>
              <CalendarDays className="size-4" />
              휴가 관리
            </Button>
          ) : null}
        </div>
      </header>

      {canAssignTarget ? <DashboardAssignmentForm
        key={staff.id}
        user={{ id: staff.id, systemRole: staff.systemRole, subjects: staff.subjects, isSuperAdmin: false }}
        initial={settings.dashboard.assignments?.find((a) => a.userId === staff.id)}
        subjects={settings.operations.subjects}
      /> : null}
      <StaffForm
        mode="edit"
        scope={`staff:${id}`}
        assignableRoleOptions={[]}
        canGrantTeacherView={canGrantTeacherView}
        canSetNative={canAssignTarget}
        initialValue={{
          id: staff.id,
          displayName: staff.displayName,
          email: staff.email,
          phone: staff.phone,
          systemRole: staff.systemRole,
          hireDate: staff.hireDate,
          jobTitle: staff.jobTitle,
          englishName: staff.englishName,
          subjects: staff.subjects,
          defaultClassroom: staff.defaultClassroom,
          memo: staff.memo,
          bgColor: staff.bgColor,
          attendanceAlertOptin: staff.attendanceAlertOptin,
          seatLabDuty: staff.seatLabDuty,
          seatJjDuty: staff.seatJjDuty,
          deskAttendanceOptin: staff.deskAttendanceOptin,
          shuttleDuty: staff.shuttleDuty,
          nativeTeacher: staff.nativeTeacher,
          teacherViewAccess: staff.teacherViewAccess,
          teacherViewLang: staff.teacherViewLang,
        }}
      />
    </div>
  );
}
