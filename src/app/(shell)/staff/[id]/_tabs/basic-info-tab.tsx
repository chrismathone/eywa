import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import type { SystemRole } from "@/lib/permissions";
import { Pill } from "@/components/atoms/pill";
import { WindowLink } from "@/components/workspace/window-link";
import { Button } from "@/components/ui/button";
import { getActiveHomeroomClasses, type StaffDetail } from "@/features/staff/server/queries";
import type { ResumeDetail } from "@/features/staff/server/resume-queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { ResumeSheet } from "../../resumes/_components/resume-sheet";
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
  displayRole,
  canManageThis,
  showSalary,
  roleOptions,
  resume,
  resumeAccess = false,
  resumeCanWrite = false,
  resumePhotoUrls,
  viewerId = "",
}: {
  staff: StaffDetail;
  // 표시용 역할(super_admin은 '관리자'로 위장). 배지·급여카드 노출 등 '보이는 것'에만 사용.
  // 권한/위계 로직(AccountActions)엔 실제 staff.systemRole 유지.
  displayRole: SystemRole;
  canManageThis: boolean;
  showSalary: boolean;
  roleOptions: SystemRole[];
  /** 연결된 이력서(원장·관리자 게이트를 통과한 경우에만 전달됨 — 기본정보에 **실제 서식**으로 표시). */
  resume?: ResumeDetail | null;
  /** 이력서 열람 자격(원장·관리자) — true인데 resume이 없으면 '이력서 작성' 카드를 보여준다. */
  resumeAccess?: boolean;
  /** 이력서 인라인 수정 가능 여부(열람 자격 + 직원관리 쓰기 권한). */
  resumeCanWrite?: boolean;
  /** 증명사진 signed URL(사진 슬라이드용 — 게이트 통과 시에만 서버가 resolve). */
  resumePhotoUrls?: (string | null)[];
  /** 열람자 id — 이력서 인라인 편집의 초안(IndexedDB) 스코프 격리용. */
  viewerId?: string;
}) {
  // 독립 조회 병렬(B4). 담임 반 목록은 계정 관리 패널(퇴사/삭제 경고)에서만 쓰여 canManageThis일 때만 조회.
  const [settings, homeroomClasses] = await Promise.all([
    getTenantSettings(),
    canManageThis ? getActiveHomeroomClasses(staff.id) : Promise.resolve([]),
  ]);
  // 과목 라벨·색은 학원설정(operations.subjects) 단일 소스 — 하드코딩 금지.
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const isTeacherLike = displayRole === "teacher" || displayRole === "master";
  const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

  return (
    <div className="space-y-5">
      <div className="bg-card border-line shadow-card rounded-2xl border p-5">
        <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">
          <Field label="이메일" value={<span className="num">{staff.email}</span>} />
          <Field label="연락처" value={staff.phone ? <span className="num">{staff.phone}</span> : null} />
          <Field label="시스템 역할" value={ROLE_LABEL[displayRole] ?? displayRole} />
          <Field label="직급 (닉네임)" value={staff.jobTitle} />
          {/* 영어 닉네임 — 영어 시간표 임포트가 시트 라벨(`Jane 중1 정규A`)을 이 값으로 강사에 붙인다. */}
          <Field label="영어 닉네임" value={staff.englishName} />
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
        <div className="bg-card border-line shadow-card rounded-2xl border p-5">
          <p className="micro mb-3">급여 기준</p>
          <div className="grid grid-cols-2 gap-5">
            <Field label="시급" value={<span className="tabular">{won(staff.hourlyRate)}</span>} />
            <Field label="기본급" value={<span className="tabular">{won(staff.monthlyBase)}</span>} />
          </div>
        </div>
      ) : null}

      {/* 이력서(원장 지시 2026-07-28) — 요약이 아니라 **실제 이력서 서식**(ResumeSheet)을 그대로 임베드.
          '수정' 버튼으로 이 자리에서 바로 인라인 편집·인쇄·삭제. 게이트는 페이지(canViewResume)가 통과시킨 경우만. */}
      {resume ? (
        <ResumeSheet
          data={resume.data}
          id={resume.id}
          userId={viewerId}
          canWrite={resumeCanWrite}
          photoUrls={resumePhotoUrls}
        />
      ) : resumeAccess ? (
        <div className="bg-card border-line shadow-card rounded-2xl border p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="micro">이력서</p>
              <p className="text-text-dim mt-1 text-sm">아직 작성된 이력서가 없습니다.</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              render={
                <WindowLink
                  href={`/staff/resumes/new?staff=${staff.id}`}
                  title={`이력서 작성 — ${staff.displayName}`}
                />
              }
            >
              이력서 작성
            </Button>
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
          homeroomClasses={homeroomClasses}
        />
      ) : null}
    </div>
  );
}
