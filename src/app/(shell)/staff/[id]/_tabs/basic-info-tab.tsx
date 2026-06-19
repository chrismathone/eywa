import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import type { SystemRole } from "@/lib/permissions";
import { Pill } from "@/components/atoms/pill";
import type { StaffDetail } from "@/features/staff/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { AccountActions } from "../_components/account-actions";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="micro">{label}</p>
      <div className="text-foreground text-sm">{value || <span className="text-text-faint">—</span>}</div>
    </div>
  );
}

export async function BasicInfoTab({
  staff,
  canManageThis,
  showSalary,
  roleOptions,
}: {
  staff: StaffDetail;
  canManageThis: boolean;
  showSalary: boolean;
  roleOptions: SystemRole[];
}) {
  const settings = await getTenantSettings();
  // 과목 라벨·색은 학원설정(operations.subjects) 단일 소스 — 하드코딩 금지.
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const isTeacherLike = staff.systemRole === "teacher" || staff.systemRole === "master";
  const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

  return (
    <div className="space-y-5">
      <div className="bg-card border-line shadow-card rounded-md border p-5">
        <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">
          <Field label="이메일" value={<span className="num">{staff.email}</span>} />
          <Field label="연락처" value={staff.phone ? <span className="num">{staff.phone}</span> : null} />
          <Field label="시스템 역할" value={ROLE_LABEL[staff.systemRole] ?? staff.systemRole} />
          <Field label="직책" value={staff.jobTitle} />
          <Field label="입사일" value={staff.hireDate ? <span className="num">{staff.hireDate}</span> : null} />
          <Field label="기본 강의실" value={staff.defaultClassroom} />
          <Field
            label="담당 과목"
            value={
              staff.subjects.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {staff.subjects.map((s) => (
                    <Pill key={s} color={subjects.colorOf(s)} soft>
                      {subjects.labelOf(s)}
                    </Pill>
                  ))}
                </div>
              ) : null
            }
          />
        </div>
        {staff.memo ? (
          <div className="border-line mt-4 border-t pt-4">
            <p className="micro mb-1">메모</p>
            <p className="text-text-dim text-sm whitespace-pre-wrap">{staff.memo}</p>
          </div>
        ) : null}
      </div>

      {showSalary && isTeacherLike ? (
        <div className="bg-card border-line shadow-card rounded-md border p-5">
          <p className="micro mb-3">급여 기준</p>
          <div className="grid grid-cols-2 gap-5">
            <Field label="시급" value={<span className="tabular">{won(staff.hourlyRate)}</span>} />
            <Field label="기본급" value={<span className="tabular">{won(staff.monthlyBase)}</span>} />
          </div>
        </div>
      ) : null}

      {canManageThis ? (
        <AccountActions
          staffId={staff.id}
          displayName={staff.displayName}
          currentEmail={staff.email}
          currentRole={staff.systemRole}
          currentStatus={staff.status}
          roleOptions={roleOptions}
        />
      ) : null}
    </div>
  );
}
