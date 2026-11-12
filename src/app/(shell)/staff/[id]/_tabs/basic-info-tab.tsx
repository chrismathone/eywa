import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import type { SystemRole } from "@/lib/permissions";
import { Pill } from "@/components/atoms/pill";
import { CheckSquare, Pencil, Square } from "@/components/icons/aywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { Button } from "@/components/ui/button";
import {
  getActiveAssistSlotClasses,
  getActiveHomeroomClasses,
  type StaffDetail,
} from "@/features/staff/server/queries";
import { getStaffContractFiles, getStaffContracts } from "@/features/staff/contract/server/contract-queries";
import { getClassTeacherOptions } from "@/features/classes/server/queries";
import type { ResumeDetail } from "@/features/staff/resume/server/resume-queries";
import { RESUME_CHECKS, WORKDAYS } from "@/features/staff/resume/resume";
import { getTenantSettings } from "@/features/owner/server/queries";
import { protectionStatus } from "@/lib/auth/protected-accounts";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { ResumePhotoSlide } from "../_components/resume-photo-slide";
import { ContractStatus } from "../_components/contract-status";
import { AccountActions } from "../_components/account-actions";
import { phoneLabel } from "@/lib/format/phone";

// 기본정보 = 이력서 view(원장 지시 2026-07-28): **구조는 이력서**(인적→계약→학력→경력→자격증→서류),
// **디자인은 앱**(헤더 달린 카드 구획, 페이지 폭 활용 — 종이 서식 중앙 배치 아님). 수정은 이력서 편집으로.

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="micro">{label}</p>
      <div className="text-foreground text-sm">{value || <span className="text-text-faint">—</span>}</div>
    </div>
  );
}

/** 이질적 다(多)섹션 구획 — 헤더 달린 카드(디자인 규칙). 2열 배치 시 높이 균형 위해 flex-col. */
function SectionCard({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`bg-card border-line shadow-card flex flex-col rounded-2xl border p-5 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="micro">{title}</p>
        {action}
      </div>
      {children}
    </section>
  );
}

const Empty = () => <p className="text-text-faint text-sm">입력된 내용이 없습니다</p>;

export async function BasicInfoTab({
  staff,
  displayRole,
  canManageThis,
  canManageContracts = false,
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
  /** 계약 갱신 권한 = 직원관리 쓰기(사무실). canManageThis(쓰기 AND 자신 권한 이하 대상)와 축이 다르다. */
  canManageContracts?: boolean;
  showSalary: boolean;
  roleOptions: SystemRole[];
  /** 연결된 이력서(원장·관리자 게이트 통과 시에만 전달) — 이 탭의 내용 원천. */
  resume?: ResumeDetail | null;
  /** 이력서 열람 자격(원장·관리자) — 민감 항목(주민번호·계좌·급여계약) 노출 여부. */
  resumeAccess?: boolean;
  /** 이력서 수정 가능 여부 — '수정'/'이력서 작성' 버튼 노출. */
  resumeCanWrite?: boolean;
  /** 증명사진 signed URL(슬라이드) — 게이트 통과 시에만 서버가 resolve. */
  resumePhotoUrls?: (string | null)[];
}) {
  // 독립 조회 병렬(B4). 담임 반 목록·인계 후보는 계정 관리 패널(퇴사 경고·일괄 인계)에서만 쓰여
  // canManageThis일 때만 조회한다. 계약서 파일은 계약현황 카드용(2026-08-03).
  const [settings, homeroomClasses, contracts, contractFiles, handoverTeachers, assistClasses, protection] = await Promise.all([
    getTenantSettings(),
    canManageThis ? getActiveHomeroomClasses(staff.id) : Promise.resolve([]),
    getStaffContracts(staff.id),
    getStaffContractFiles(staff.id),
    canManageThis ? getClassTeacherOptions() : Promise.resolve([]),
    canManageThis ? getActiveAssistSlotClasses(staff.id) : Promise.resolve([]),
    // 보호 계정이면 역할·퇴사·삭제 버튼을 세우지 않는다 — 막는 건 서버 액션·DB(0309a)가 한다.
    canManageThis ? protectionStatus(staff.id) : Promise.resolve("clear" as const),
  ]);
  // 오늘 날짜는 **서버에서** 확정해 내려보낸다 — 클라에서 new Date()를 쓰면 시간대·하이드레이션이 어긋난다.
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  // 과목 라벨·색은 학원설정(operations.subjects) 단일 소스 — 하드코딩 금지.
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const isTeacherLike = displayRole === "teacher" || displayRole === "master";
  const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

  const d = resume?.data ?? null;
  const p = d?.personal;
  const c = d?.contract;
  // 연락처·직급·입사일·근무부서·근무형태는 **이력서가 단일 소스**다(원장 지시 2026-08-25 — 근무 설정
  // 폼에서 이 칸들을 뺐다). users 값은 이력서가 아직 없는 직원(임포트분)을 위한 폴백으로만 남는다.
  const phone = phoneLabel(p?.phone || staff.phone) ?? "";
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

  const editButton = resumeCanWrite ? (
    <Button
      variant="outline"
      size="sm"
      render={
        resume ? (
          // 수정 = 이력서 편집 모드로 바로 — 저장하면 이 view가 따라 갱신된다.
          <WindowLink href={`/staff/resumes/${resume.id}?edit=1`} title={`${staff.displayName} 이력서 수정`} />
        ) : (
          <WindowLink href={`/staff/resumes/new?staff=${staff.id}`} title={`이력서 작성 — ${staff.displayName}`} />
        )
      }
    >
      <Pencil className="size-3.5" />
      {/* ⚠️ "수정" 단독 금지 — 페이지 헤더의 '근무 설정'과 나란히 보인다(원장 지적 2026-08-07).
          이 버튼은 인적사항 칸만이 아니라 **이력서 전체**(계약·학력·경력 포함)를 연다. */}
      {resume ? "이력서 수정" : "이력서 작성"}
    </Button>
  ) : null;

  return (
    <div className="space-y-5">
      {/* 인적사항 — 이력서 첫 섹션 느낌 그대로: 사진이 정보 옆에 */}
      <SectionCard title="인적사항" action={editButton}>
        <div className="flex flex-col-reverse items-start gap-5 sm:flex-row">
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-5 gap-y-4 lg:grid-cols-3">
            <Field label="성명" value={<span className="font-bold">{p?.name || staff.displayName}</span>} />
            {/* 이력서 '영문 이름'과 계정 '영어 닉네임'(users.english_name)은 **다른 값**이다 —
                폴백으로 이어 붙이면 시간표 매칭용 닉네임이 이력서 서식 칸에 앉아, 어느 쪽을 고쳐야
                하는지 알 수 없게 된다(닉네임은 아래 계약사항 카드에 제 칸이 있다, 2026-08-25). */}
            <Field label="영문 이름" value={p?.nameEn} />
            <Field label="연락처" value={phone ? <span className="num">{phone}</span> : null} />
            <Field label="이메일" value={email ? <span className="num">{email}</span> : null} />
            {resumeAccess ? (
              <>
                <Field label="주민등록번호" value={p?.residentId ? <span className="num">{p.residentId}</span> : null} />
                <Field label="주소" value={p?.address} />
              </>
            ) : null}
          </div>
          {/* 사진 자리는 비어 있어도 유지 — 인적사항에서 얼굴을 보는 게 이 카드의 목적. */}
          {resumeAccess ? <ResumePhotoSlide urls={resumePhotoUrls ?? []} /> : null}
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-stretch">
        {/* 계약사항 — 이력서 5번 섹션 */}
        <SectionCard title="계약사항">
          <div className="grid grid-cols-2 gap-x-5 gap-y-4">
            <Field label="근무부서" value={department} />
            <Field label="근무형태" value={employmentType} />
            <Field label="직급" value={jobTitle} />
            <Field label="입사일" value={hireDate ? <span className="num">{hireDate}</span> : null} />
            <Field label="근무요일" value={dayLabels.length ? dayLabels.join(" · ") : null} />
            {/* 시스템 쪽 항목(역할·과목·강의실·닉네임)은 '계정 정보' 카드가 계약현황으로 바뀌면서
                여기로 합쳤다(2026-07-29 원장 지시) — 어차피 같은 '이 사람이 어떻게 일하는가' 축. */}
            <Field label="시스템 역할" value={ROLE_LABEL[displayRole] ?? displayRole} />
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
            <Field label="기본 강의실" value={staff.defaultClassroom} />
            <Field label="영어 닉네임" value={staff.englishName} />
            {resumeAccess ? (
              <>
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
                <Field label="처리담당자" value={c?.manager} />
              </>
            ) : null}
          </div>
          {staff.memo ? (
            <div className="border-line mt-4 border-t pt-4">
              <p className="micro mb-1">메모</p>
              <p className="text-text-dim text-sm whitespace-pre-wrap">{staff.memo}</p>
            </div>
          ) : null}
        </SectionCard>

        {/* 계약현황 — 구 '계정 정보' 자리(2026-07-29 원장 지시). 현재계약 + 계약조건 히스토리 + 연장. */}
        <ContractStatus
          userId={staff.id}
          hireDate={hireDate || null}
          rows={contracts}
          files={contractFiles}
          today={today}
          canWrite={canManageContracts}
        />
      </div>

      {resumeAccess ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-stretch">
          {/* 학력사항 */}
          <SectionCard title="학력사항">
            {educations.length > 0 ? (
              <ul className="divide-line/60 divide-y">
                {educations.map((e, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
                    <span className="text-foreground min-w-0 text-sm">
                      <span className="font-medium">{e.school}</span>
                      {e.major ? <span className="text-text-dim"> · {e.major}</span> : null}
                      {e.gpa ? <span className="text-text-faint text-xs"> · 학점 {e.gpa}</span> : null}
                    </span>
                    {e.period ? <span className="text-text-faint num shrink-0 text-xs">{e.period}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty />
            )}
          </SectionCard>

          {/* 경력사항 */}
          <SectionCard title="경력사항">
            {careers.length > 0 ? (
              <ul className="divide-line/60 divide-y">
                {careers.map((r, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
                    <span className="text-foreground min-w-0 text-sm">
                      <span className="font-medium">{r.company}</span>
                      {r.duties ? <span className="text-text-dim"> · {r.duties}</span> : null}
                      {r.leaveReason ? <span className="text-text-faint text-xs"> · {r.leaveReason}</span> : null}
                    </span>
                    {r.period ? <span className="text-text-faint num shrink-0 text-xs">{r.period}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty />
            )}
          </SectionCard>

          {/* 자격증 · 외국어 */}
          <SectionCard title="자격증 · 외국어">
            {certs.length > 0 || langs.length > 0 ? (
              <ul className="divide-line/60 divide-y">
                {certs.map((r, i) => (
                  <li key={`c${i}`} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
                    <span className="text-foreground min-w-0 text-sm">
                      <span className="font-medium">{r.name}</span>
                      {r.issuer ? <span className="text-text-dim"> · {r.issuer}</span> : null}
                    </span>
                    {r.date ? <span className="text-text-faint num shrink-0 text-xs">{r.date}</span> : null}
                  </li>
                ))}
                {langs.map((r, i) => (
                  <li key={`l${i}`} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
                    <span className="text-foreground min-w-0 text-sm">
                      <span className="font-medium">{r.name}</span>
                      {r.score ? <span className="text-text-dim"> · {r.score}</span> : null}
                    </span>
                    {r.testDate ? <span className="text-text-faint num shrink-0 text-xs">{r.testDate}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty />
            )}
          </SectionCard>

          {/* 제출서류 확인 */}
          <SectionCard title="제출서류 확인">
            {d ? (
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {RESUME_CHECKS.map((item) => (
                  <span key={item.key} className="text-foreground inline-flex items-center gap-1.5 text-sm">
                    {d.checks[item.key] ? (
                      <CheckSquare size={14} className="text-primary" aria-hidden="true" />
                    ) : (
                      <Square size={14} className="text-text-faint" aria-hidden="true" />
                    )}
                    {item.label}
                  </span>
                ))}
              </div>
            ) : (
              <Empty />
            )}
            {/* 카드 높이 균형(2열 규칙) — 남는 공간은 아래로 밀착 */}
            <div className="mt-auto" />
          </SectionCard>
        </div>
      ) : null}

      {showSalary && isTeacherLike ? (
        <SectionCard title="급여 기준">
          <div className="grid grid-cols-2 gap-5">
            <Field label="시급" value={<span className="tabular">{won(staff.hourlyRate)}</span>} />
            <Field label="기본급" value={<span className="tabular">{won(staff.monthlyBase)}</span>} />
          </div>
        </SectionCard>
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
          assistClasses={assistClasses}
          handoverTeachers={handoverTeachers}
          protection={protection}
        />
      ) : null}
    </div>
  );
}
