import { WindowLink } from "@/components/workspace/window-link";
import { notFound, redirect } from "next/navigation";
import { CalendarDays, Wallet } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { BackLink } from "@/components/back-link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getStaffById, hasStaffEverSignedIn } from "@/features/staff/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { canEditLoginEmail } from "@/features/staff/email";
import { StaffForm } from "../../_components/staff-form";
import { PAYROLL_ENABLED } from "@/features/payroll/config";

export const metadata = { title: "직원 정보 수정 — eywa" };

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
  const [staff, { operations }, everSignedIn] = await Promise.all([
    getStaffById(id),
    getTenantSettings(),
    hasStaffEverSignedIn(id),
  ]);
  if (!staff) notFound();
  // canEditEmail: 임포트 산물 이메일 + **아직 로그인 전인 초대 계정**(오타 교정 통로)만 편집 허용.
  // 한 번이라도 로그인한 계정의 이메일은 잠금(그 사람의 실제 로그인 수단 = 조용한 탈취 통로 방지).
  // auth 계정 보유 시 서버 액션이 auth.users 이메일을 직접 변경(미러 트리거가 public 동기, 0075a).
  const canEditEmail = canEditLoginEmail(staff.email, everSignedIn);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/staff" label="직원관리로" />

      <header className="border-border flex flex-wrap items-end justify-between gap-3 border-b pb-5">
        <div className="space-y-1">
          {/* 들어온 버튼('직원 정보 수정')과 같은 말로 — 열고 나서 "여기가 거기 맞나" 하지 않게. */}
          <p className="eyebrow">직원 정보 수정</p>
          <h1 className="font-bold tracking-tight text-foreground text-2xl">{staff.displayName}</h1>
          {/* 무엇이 여기 있고 무엇이 없는지 적는다 — 없는 걸 찾다가 되돌아 나가는 게 가장 큰 낭비다. */}
          <p className="text-muted-foreground text-sm">
            이름·연락처·직급·담당 과목·시간표 색 등 (이메일·비밀번호·역할 변경과 이력서는 직원 상세에서)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* 급여 정산은 강사·원장 한정 유지 — 시급/월급 산식이 그 둘 전제다(PAYROLL_ENABLED 상위 결정 뒤). */}
          {PAYROLL_ENABLED && (staff.systemRole === "teacher" || staff.systemRole === "master") ? (
            <Button variant="outline" render={<WindowLink href={`/staff/${staff.id}/payroll`} title="급여 정산" />}>
              <Wallet className="size-4" />
              급여 정산
            </Button>
          ) : null}
          {/* 휴가는 **전 직원** 기능이라 대상의 역할로 가리지 않는다(2026-08-03 원장 지시).
              예전엔 급여와 한 조건에 묶여 teacher|master만 보였고, 그 결과 반을 맡은 부원장(admin)·
              행정 직원의 휴가를 아예 열 수 없었다. ⚠️ 이 버튼은 게이트가 아니다 — 실제 권한은
              /staff/[id]/leaves가 requireAccess("staff") + canManageStaff·canWriteTenant로 잡는다
              (버튼을 숨겨도 URL로 열렸다 = 숨김은 잠금이 아니다, gotcha #77). */}
          <Button variant="outline" render={<WindowLink href={`/staff/${staff.id}/leaves`} title="휴가 관리" />}>
            <CalendarDays className="size-4" />
            휴가 관리
          </Button>
        </div>
      </header>

      <StaffForm
        mode="edit"
        scope={`staff:${id}`}
        assignableRoleOptions={[]}
        jobTitleOptions={operations.jobTitles}
        canEditEmail={canEditEmail}
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
        }}
      />
    </div>
  );
}
