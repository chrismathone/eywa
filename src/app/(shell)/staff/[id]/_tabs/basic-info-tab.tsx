import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import { Pill } from "@/components/atoms/pill";
import type { StaffDetail } from "@/features/staff/server/queries";
import { AccountActions } from "../_components/account-actions";

const SUBJECT_LABEL: Record<string, string> = {
  math: "수학",
  highmath: "수학(심화)",
  english: "영어",
  science: "과학",
  korean: "국어",
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="micro">{label}</p>
      <div className="text-foreground text-sm">{value || <span className="text-text-faint">—</span>}</div>
    </div>
  );
}

export function BasicInfoTab({
  staff,
  canManageThis,
  showSalary,
}: {
  staff: StaffDetail;
  canManageThis: boolean;
  showSalary: boolean;
}) {
  const isTeacherLike = staff.systemRole === "teacher" || staff.systemRole === "master";
  const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

  return (
    <div className="space-y-5">
      <div className="bg-card border-line shadow-card rounded-md border p-5">
        <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">
          <Field label="이메일" value={<span className="num">{staff.email}</span>} />
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
                    <Pill key={s} color="neutral" soft>
                      {SUBJECT_LABEL[s] ?? s}
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
        />
      ) : null}
    </div>
  );
}
