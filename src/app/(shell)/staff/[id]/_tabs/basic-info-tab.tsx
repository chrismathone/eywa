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

  // 이력서(ResumeSheet)와 같은 종이 서식 언어 — 기본정보도 TR/TD 표로(원장 지시 2026-07-28), 인쇄 시 함께 출력.
  const T = "w-full border-collapse text-[12px] leading-relaxed print:text-[11px] print:leading-snug";
  const cell = "border-foreground/35 border px-2 py-1.5 align-middle print:py-1";
  const head = `${cell} bg-bg-soft/70 w-28 text-center font-bold print:whitespace-nowrap`;
  const dash = <span className="text-text-faint">—</span>;

  return (
    <div className="space-y-5">
      {/* 직원 기본정보 — 이력서와 같은 폭·같은 표 서식(한 문서처럼 이어져 인쇄된다). */}
      <div className="border-line bg-card text-foreground shadow-card mx-auto w-full max-w-[780px] rounded-2xl border p-6 sm:p-8 print:rounded-none print:border-2 print:border-foreground/60 print:p-3 print:shadow-none">
        <h2 className="text-foreground mb-1.5 text-[13px] font-bold print:text-[12px]">직원 기본정보</h2>
        <table className={T}>
          <tbody>
            <tr>
              <th className={head}>이메일</th>
              <td className={`${cell} num`}>{staff.email || dash}</td>
              <th className={head}>시스템 역할</th>
              <td className={cell}>{ROLE_LABEL[displayRole] ?? displayRole}</td>
            </tr>
            <tr>
              <th className={head}>연락처</th>
              <td className={`${cell} num`}>{staff.phone || dash}</td>
              <th className={head}>영어 닉네임</th>
              {/* 영어 닉네임 — 영어 시간표 임포트가 시트 라벨(`Jane 중1 정규A`)을 이 값으로 강사에 붙인다. */}
              <td className={cell}>{staff.englishName || dash}</td>
            </tr>
            <tr>
              <th className={head}>직급</th>
              <td className={cell}>{staff.jobTitle || dash}</td>
              <th className={head}>입사일</th>
              <td className={`${cell} num`}>{staff.hireDate || dash}</td>
            </tr>
            <tr>
              <th className={head}>근무부서</th>
              <td className={cell}>{staff.department || dash}</td>
              <th className={head}>근무형태</th>
              <td className={cell}>{staff.employmentType || dash}</td>
            </tr>
            <tr>
              <th className={head}>기본 강의실</th>
              <td className={cell}>{staff.defaultClassroom || dash}</td>
              <th className={head}>담당 과목</th>
              <td className={cell}>
                {staff.subjects.length > 0 ? (
                  <span className="flex flex-wrap gap-1">
                    {staff.subjects.map((s) => (
                      <Pill key={s} color={subjects.colorOf(s)} soft>
                        {subjects.labelOf(s)}
                      </Pill>
                    ))}
                  </span>
                ) : (
                  dash
                )}
              </td>
            </tr>
            {staff.memo ? (
              <tr>
                <th className={head}>메모</th>
                <td className={cell} colSpan={3}>
                  <span className="whitespace-pre-wrap">{staff.memo}</span>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {showSalary && isTeacherLike ? (
        // 급여는 화면 전용(원장·본인만) — 인쇄물엔 넣지 않는다.
        <div className="bg-card border-line shadow-card print:hidden rounded-2xl border p-5">
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
        <div className="bg-card border-line shadow-card print:hidden rounded-2xl border p-5">
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
        // 계정 관리(비번 재설정·역할 변경 등)는 화면 전용 — 인쇄물 제외.
        <div className="print:hidden">
          <AccountActions
            staffId={staff.id}
            displayName={staff.displayName}
            currentEmail={staff.email}
            currentRole={staff.systemRole}
            currentStatus={staff.status}
            roleOptions={roleOptions}
            homeroomClasses={homeroomClasses}
          />
        </div>
      ) : null}
    </div>
  );
}
