import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "@/components/icons/eywa-icon-compat";
import { PageHeader } from "@/components/page-header";
import { landingPath } from "@/lib/auth/teacher-home";
import { getCurrentUser } from "@/lib/auth/current-user";
import { resolveTenantReadUrls } from "@/lib/storage/media-storage";
import { emptyResume } from "@/features/staff/resume";
import { isImportArtifactEmail } from "@/features/staff/email";
import { getStaffById } from "@/features/staff/server/queries";
import { getResumeByStaffUser } from "@/features/staff/server/resume-queries";
import {
  fetchMyReportDisplayName,
  resolveReportAuthorName,
} from "@/features/onescreen/server/report-author-name";
import { ResumeSheet } from "../staff/resumes/_components/resume-sheet";
import { AccountCard } from "./_components/account-card";
import { ReportNameCard } from "./_components/report-name-card";

export const metadata = { title: "내 정보 — eywa" };

/**
 * 내 정보 — **로그인한 본인**의 이력서와 계정. 직원목록(/staff)은 사무실 전용이라 강사·뷰어는 들어갈 수 없어,
 * 자기 이력서를 직접 채우고 로그인 정보를 바꾸는 통로가 아예 없었다(원장 지시 2026-07-29로 신설).
 *
 * 게이트는 **세션뿐** — 보여주는 것도 바꾸는 것도 전부 auth.uid() 자신의 것이라 메뉴 권한이 필요 없다.
 * 이력서 열람·수정 자격은 공용 `canViewResume(user, staffUserId)`가 '본인'을 통과시킨다([[#77]] 단일 게이트).
 */
export default async function MyPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [resume, me, reportName, resolvedSendName] = await Promise.all([
    getResumeByStaffUser(user.id),
    getStaffById(user.id),
    // 수업보고서 발송용 이름(0217a) — fail-soft: 컬럼 미적용이면 null(빈 칸)이고 페이지는 그대로 산다.
    fetchMyReportDisplayName(user.id),
    // 실제 발송이 쓰는 해석기로 "지금 매핑이 걸리는가"까지 확인 — 저장 후 생긴 동명 직원 때문에
    // 조용히 실명 발송으로 돌아간 상태를 카드가 밝힌다([[#89]] 폴백 기능의 침묵 실패 가시화).
    resolveReportAuthorName(user.tenantId, user.displayName),
  ]);
  const placeholder = isImportArtifactEmail(user.email);

  // 이력서가 아직 없으면 계정에 있는 정보로 초안을 채워 바로 쓰게 한다(빈 종이보다 시작이 쉽다).
  const data = resume?.data ?? emptyResume();
  if (!resume && me) {
    data.personal.name = me.displayName;
    data.personal.nameEn = me.englishName ?? "";
    data.personal.email = placeholder ? "" : me.email;
    data.personal.phone = me.phone ?? "";
    data.contract.startDate = me.hireDate ?? "";
    data.contract.division = me.department ?? "";
    data.contract.employmentType = me.employmentType ?? "";
    data.contract.jobTitle = me.jobTitle ?? "";
  }

  const photoUrls = resume?.data.photos.length
    ? await (async () => {
        const map = await resolveTenantReadUrls(resume.data.photos, "document", user.tenantId);
        return resume.data.photos.map((p) => map[p] ?? null);
      })()
    : [];

  // 미니셸(강사 등)에서 팝업으로 들어온 사람은 '내 메뉴'를 몰라 여기 갇힌다(원장 제보 2026-08-04)
  // — 역할별 홈으로 돌아가는 길을 페이지 안에 직접 둔다(강사=원스크린 or ECS, 그 외=/dashboard).
  const home = await landingPath(user.systemRole);

  return (
    <div className="print-portrait space-y-5 p-6">
      <div className="print:hidden">
        <Link
          href={home}
          className="text-text-dim hover:text-primary mb-2 inline-flex items-center gap-1 text-xs font-medium transition"
        >
          <ArrowLeft className="size-3.5" /> 메인으로 돌아가기
        </Link>
        <PageHeader
          eyebrow="내 정보"
          title={user.displayName}
          description="내 이력서와 로그인 정보를 직접 확인·수정합니다."
          // ⚠️ title이 **본인 이름**(메뉴명이 아니다)이라 컴팩트(창·모바일)에선 접힌다 →
          //    이름을 컴팩트 행에 직접 실어야 좁은 화면에서 "누구의 정보인지"가 남는다.
          embedLabel={`${user.displayName} · 내 이력서와 로그인 정보`}
        />
      </div>

      <div className="print:hidden space-y-5">
        <AccountCard email={user.email} isPlaceholder={placeholder} />
        {/* 수업보고서 발송용 이름(0217a) — 발송·공유·인쇄에 실명 대신 표시할 이름을 본인이 정한다. */}
        <ReportNameCard
          realName={user.displayName}
          initialName={reportName}
          mappingBlocked={!!reportName && resolvedSendName !== reportName}
        />
      </div>

      <ResumeSheet
        data={data}
        id={resume?.id}
        userId={user.id}
        canWrite
        // 아직 이력서가 없으면 곧장 입력 상태로 연다(작성이 목적인 화면).
        startEditing={!resume}
        photoUrls={photoUrls}
        staffUserId={user.id}
        returnHref="/me"
      />
    </div>
  );
}
