import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import type { SystemRole } from "@/lib/permissions";
import { Pill } from "@/components/atoms/pill";
import { CheckSquare, Pencil, Square } from "@/components/icons/eywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { Button } from "@/components/ui/button";
import { getActiveHomeroomClasses, type StaffDetail } from "@/features/staff/server/queries";
import type { ResumeDetail } from "@/features/staff/server/resume-queries";
import { RESUME_CHECKS, WORKDAYS } from "@/features/staff/resume";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { ResumePhotoSlide } from "../_components/resume-photo-slide";
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
}: {
  staff: StaffDetail;
  // 표시용 역할(super_admin은 '관리자'로 위장). 배지·급여카드 노출 등 '보이는 것'에만 사용.
  // 권한/위계 로직(AccountActions)엔 실제 staff.systemRole 유지.
  displayRole: SystemRole;
  canManageThis: boolean;
  showSalary: boolean;
  roleOptions: SystemRole[];
  /** 연결된 이력서(원장·관리자 게이트 통과 시에만 전달) — 기본정보 카드의 내용이 이 데이터로 채워진다. */
  resume?: ResumeDetail | null;
  /** 이력서 열람 자격(원장·관리자) — 이력서 항목(주민번호·계좌 등) 노출 여부. */
  resumeAccess?: boolean;
  /** 이력서 수정 가능 여부(열람 자격 + 직원관리 쓰기 권한) — '수정'/'이력서 작성' 버튼 노출. */
  resumeCanWrite?: boolean;
  /** 증명사진 signed URL(슬라이드) — 게이트 통과 시에만 서버가 resolve. */
  resumePhotoUrls?: (string | null)[];
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

  // 기본정보 = 이력서 데이터로 대체(원장 지시 2026-07-28 — 두 벌이 아니라 **이 카드 하나**, 앱 기본 디자인).
  // 겹치는 항목은 이력서 값을 우선, 비어 있으면 계정(users) 값으로 폴백.
  const d = resume?.data ?? null;
  const p = d?.personal;
  const c = d?.contract;
  const phone = p?.phone || staff.phone || "";
  const jobTitle = c?.jobTitle || staff.jobTitle || "";
  const department = c?.division || staff.department || "";
  const employmentType = c?.employmentType || staff.employmentType || "";
  const hireDate = c?.startDate || staff.hireDate || "";
  const dayLabels = c ? WORKDAYS.filter((w) => c.workDays.includes(w.key)).map((w) => w.label) : [];
  const salary = c
    ? [c.salaryMonthly && `월급 ${c.salaryMonthly}`, c.salaryAnnual && `연봉 ${c.salaryAnnual}`].filter(Boolean).join(" · ")
    : "";
  const educations = d?.education.filter((e) => e.school.trim()) ?? [];
  const careers = d?.career.filter((r) => r.company.trim()) ?? [];
  const certs = d?.certificates.filter((r) => r.name.trim()) ?? [];
  const langs = d?.languages.filter((r) => r.name.trim()) ?? [];
  const email = staff.email.toLowerCase().endsWith("@imported.local") ? "" : staff.email;

  return (
    <div className="space-y-5">
      <div className="bg-card border-line shadow-card rounded-2xl border p-5">
        <div className="mb-4 flex items-start justify-between gap-4">
          <p className="micro">기본정보</p>
          {resumeCanWrite ? (
            <Button
              variant="outline"
              size="sm"
              render={
                resume ? (
                  // 수정 = 이력서 편집으로 바로(편집 모드로 열림) — 저장하면 이 카드가 따라 갱신된다.
                  <WindowLink href={`/staff/resumes/${resume.id}?edit=1`} title={`${staff.displayName} 이력서 수정`} />
                ) : (
                  <WindowLink
                    href={`/staff/resumes/new?staff=${staff.id}`}
                    title={`이력서 작성 — ${staff.displayName}`}
                  />
                )
              }
            >
              <Pencil className="size-3.5" />
              {resume ? "수정" : "이력서 작성"}
            </Button>
          ) : null}
        </div>

        <div className="flex items-start gap-5">
          <div className="min-w-0 grid flex-1 grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">
            <Field label="이메일" value={email ? <span className="num">{email}</span> : null} />
            <Field label="연락처" value={phone ? <span className="num">{phone}</span> : null} />
            <Field label="시스템 역할" value={ROLE_LABEL[displayRole] ?? displayRole} />
            <Field label="영문 이름" value={p?.nameEn || staff.englishName} />
            <Field label="직급" value={jobTitle} />
            <Field label="입사일" value={hireDate ? <span className="num">{hireDate}</span> : null} />
            <Field label="근무부서" value={department} />
            <Field label="근무형태" value={employmentType} />
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
            {resumeAccess ? (
              <>
                <Field
                  label="주민등록번호"
                  value={p?.residentId ? <span className="num">{p.residentId}</span> : null}
                />
                <Field label="주소" value={p?.address} />
                <Field label="근무요일" value={dayLabels.length ? dayLabels.join(" · ") : null} />
                <Field label="급여 계약" value={salary ? <span className="num">{salary}</span> : null} />
                <Field
                  label="계좌"
                  value={
                    c?.account ? (
                      <span className="num">
                        {c.account}
                        {c.bank ? ` (${c.bank})` : ""}
                      </span>
                    ) : null
                  }
                />
                <Field label="담당자" value={c?.manager} />
              </>
            ) : null}
            <Field label="기본 강의실" value={staff.defaultClassroom} />
          </div>
          {resumeAccess && resumePhotoUrls && resumePhotoUrls.some(Boolean) ? (
            <ResumePhotoSlide urls={resumePhotoUrls} />
          ) : null}
        </div>

        {resumeAccess && educations.length > 0 ? (
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

        {resumeAccess && careers.length > 0 ? (
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

        {resumeAccess && (certs.length > 0 || langs.length > 0) ? (
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

        {resumeAccess && d ? (
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
        ) : null}

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
