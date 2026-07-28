import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import type { SystemRole } from "@/lib/permissions";
import { Pill } from "@/components/atoms/pill";
import { CheckSquare, Square } from "@/components/icons/eywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { Button } from "@/components/ui/button";
import { getActiveHomeroomClasses, type StaffDetail } from "@/features/staff/server/queries";
import type { ResumeDetail } from "@/features/staff/server/resume-queries";
import { RESUME_CHECKS, WORKDAYS } from "@/features/staff/resume";
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
  displayRole,
  canManageThis,
  showSalary,
  roleOptions,
  resume,
  resumeAccess = false,
}: {
  staff: StaffDetail;
  // 표시용 역할(super_admin은 '관리자'로 위장). 배지·급여카드 노출 등 '보이는 것'에만 사용.
  // 권한/위계 로직(AccountActions)엔 실제 staff.systemRole 유지.
  displayRole: SystemRole;
  canManageThis: boolean;
  showSalary: boolean;
  roleOptions: SystemRole[];
  /** 연결된 이력서(원장·관리자 게이트를 통과한 경우에만 전달됨 — 기본정보에 서식대로 표시). */
  resume?: ResumeDetail | null;
  /** 이력서 열람 자격(원장·관리자) — true인데 resume이 없으면 '이력서 작성' 카드를 보여준다. */
  resumeAccess?: boolean;
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

      {/* 이력서 내용(원장 지시 2026-07-28) — 연결된 이력서를 기본정보 서식(Field 그리드)에 맞춰 표시.
          원장·관리자 게이트(canViewResume)를 통과했을 때만 페이지가 resume을 전달한다. */}
      {resume ? (
        <ResumeSummaryCard resume={resume} />
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

/** 이력서 요약 카드 — 기본정보 탭 디자인(카드 + micro 라벨 + Field 그리드)에 맞춘 이력서 내용 표시. */
function ResumeSummaryCard({ resume }: { resume: ResumeDetail }) {
  const d = resume.data;
  const p = d.personal;
  const c = d.contract;
  const dayLabels = WORKDAYS.filter((w) => c.workDays.includes(w.key)).map((w) => w.label);
  const educations = d.education.filter((e) => e.school.trim());
  const careers = d.career.filter((r) => r.company.trim());
  const certs = d.certificates.filter((r) => r.name.trim());
  const langs = d.languages.filter((r) => r.name.trim());
  const salary = [c.salaryMonthly && `월급 ${c.salaryMonthly}`, c.salaryAnnual && `연봉 ${c.salaryAnnual}`]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="bg-card border-line shadow-card rounded-2xl border p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="micro">이력서</p>
        <Button
          variant="outline"
          size="sm"
          render={<WindowLink href={`/staff/resumes/${resume.id}`} title={`이력서 — ${p.name}`} />}
        >
          이력서 열기
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">
        <Field label="영문 이름" value={p.nameEn} />
        <Field label="주민등록번호" value={p.residentId ? <span className="num">{p.residentId}</span> : null} />
        <Field label="주소" value={p.address} />
        <Field label="근무부서" value={c.division} />
        <Field label="근무형태" value={c.employmentType} />
        <Field label="직급" value={c.jobTitle} />
        <Field label="입사일" value={c.startDate ? <span className="num">{c.startDate}</span> : null} />
        <Field label="근무요일" value={dayLabels.length ? dayLabels.join(" · ") : null} />
        <Field label="급여 계약" value={salary ? <span className="num">{salary}</span> : null} />
        <Field
          label="계좌"
          value={c.account ? <span className="num">{c.account}{c.bank ? ` (${c.bank})` : ""}</span> : null}
        />
        <Field label="담당자" value={c.manager} />
      </div>

      {educations.length > 0 ? (
        <div className="border-line mt-4 border-t pt-4">
          <p className="micro mb-1.5">학력</p>
          <ul className="space-y-1">
            {educations.map((e, i) => (
              <li key={i} className="text-foreground text-sm">
                {e.school}
                {e.major ? <span className="text-text-dim"> · {e.major}</span> : null}
                {e.period ? <span className="text-text-faint num ml-1.5 text-xs">{e.period}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {careers.length > 0 ? (
        <div className="border-line mt-4 border-t pt-4">
          <p className="micro mb-1.5">경력</p>
          <ul className="space-y-1">
            {careers.map((r, i) => (
              <li key={i} className="text-foreground text-sm">
                {r.company}
                {r.duties ? <span className="text-text-dim"> · {r.duties}</span> : null}
                {r.period ? <span className="text-text-faint num ml-1.5 text-xs">{r.period}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {certs.length > 0 || langs.length > 0 ? (
        <div className="border-line mt-4 border-t pt-4">
          <p className="micro mb-1.5">자격증 · 외국어</p>
          <ul className="space-y-1">
            {certs.map((r, i) => (
              <li key={`c${i}`} className="text-foreground text-sm">
                {r.name}
                {r.issuer ? <span className="text-text-dim"> · {r.issuer}</span> : null}
                {r.date ? <span className="text-text-faint num ml-1.5 text-xs">{r.date}</span> : null}
              </li>
            ))}
            {langs.map((r, i) => (
              <li key={`l${i}`} className="text-foreground text-sm">
                {r.name}
                {r.score ? <span className="text-text-dim"> · {r.score}</span> : null}
                {r.testDate ? <span className="text-text-faint num ml-1.5 text-xs">{r.testDate}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="border-line mt-4 border-t pt-4">
        <p className="micro mb-1.5">제출서류 확인</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {RESUME_CHECKS.map((item) => (
            <span key={item.key} className="text-foreground inline-flex items-center gap-1 text-sm">
              {d.checks[item.key] ? (
                <CheckSquare size={13} className="text-primary" aria-hidden="true" />
              ) : (
                <Square size={13} className="text-text-faint" aria-hidden="true" />
              )}
              {item.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
