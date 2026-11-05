import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "@/components/icons/aywa-icon-compat";
import { PageHeader } from "@/components/page-header";
import { landingPath } from "@/lib/auth/teacher-home";
import { getCurrentUser } from "@/lib/auth/current-user";
import { resolveTenantReadUrls } from "@/lib/storage/media-storage";
import { emptyResume } from "@/features/staff/resume/resume";
import { isImportArtifactEmail } from "@/features/staff/email";
import { getStaffById } from "@/features/staff/server/queries";
import { getResumeByStaffUser } from "@/features/staff/resume/server/resume-queries";
import {
  fetchMyReportAuthorSettings,
  resolveReportAuthorSettings,
} from "@/features/onescreen/server/report-author-name";
import { ResumeSheet } from "../staff/resumes/_components/resume-sheet";
// 강사 미니셸이면 화면 언어를 따른다(원장 2026-09-04 "강사가 접근 가능한 모든 메뉴를 전환").
// 🔴 아래 `ResumeSheet`(이력서 종이 서식)는 **화면만** 언어를 타고 **인쇄물은 언제나 한국어**다
//    (원장 2026-09-04 *"화면만 갈라서"*) — 가르는 장치는 그 파일의 `PaperText`.
import { getTeacherViewLang } from "@/features/teacher-view/server/lang";
import { sheetT, sheetTf } from "@/features/teacher-view/i18n";
import { getMyLeaveBalance } from "@/features/approvals/server/queries";
import { getMyLeaveHistory } from "@/features/leave/server/my-history";
import { isLeaveEligibleRole } from "@/features/leave/eligibility";
import { hasAssignedClass } from "@/features/staff/server/assigned-class";
import { AccountCard } from "./_components/account-card";
import { LeaveCard } from "./_components/leave-card";
import { ReportNameCard } from "./_components/report-name-card";
import { getTenantSettings } from "@/features/owner/server/queries";
import { classnoteModuleOn } from "@/features/owner/classnote-gate";
import { SlackLinkCard } from "./_components/slack-link-card";
import { getMySlackState } from "@/features/slack/server/queries";
import { PAGE_TITLE_SUFFIX } from "@/lib/config/site-metadata";

// 탭 제목도 화면 언어를 따른다 — 강사가 창을 여럿 열어 두면 제목이 유일한 구분이다.
export async function generateMetadata() {
  return { title: `${sheetT(await getTeacherViewLang(), "me.eyebrow")}${PAGE_TITLE_SUFFIX}` };
}

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

  const [resume, me, reportName, resolvedSendName, balance, slack, settings, hasClass] = await Promise.all([
    getResumeByStaffUser(user.id),
    getStaffById(user.id),
    // 수업보고서 발송용 이름(0217a) — fail-soft: 컬럼 미적용이면 null(빈 칸)이고 페이지는 그대로 산다.
    fetchMyReportAuthorSettings(user.id, user.tenantId),
    // 실제 발송이 쓰는 해석기로 "지금 매핑이 걸리는가"까지 확인 — 저장 후 생긴 동명 직원 때문에
    // 조용히 실명 발송으로 돌아간 상태를 카드가 밝힌다([[#89]] 폴백 기능의 침묵 실패 가시화).
    resolveReportAuthorSettings(user.tenantId, user.displayName),
    // 연차 잔여(원장 2026-09-18) — 다른 조회와 독립이라 함께 받는다(B4). 학생·아르바이트엔 없는 개념이라
    // (원장 2026-11-05 *"아르바이트생에게 연차 기능 필요없음"*) 아예 안 부르고 카드도 서지 않는다.
    // 실패해도 null로 떨어뜨린다(이력서를 채우는 화면이 연차 한 조각에 죽으면 안 된다).
    !isLeaveEligibleRole(user.systemRole) ? Promise.resolve(null) : getMyLeaveBalance(user.id).catch(() => null),
    // 내 슬랙 연결 — 지점이 슬랙을 켜고 연결했을 때만 카드가 선다. 실패해도 카드만 빠진다.
    getMySlackState().catch(() => null),
    // ClassNote 기능 켜짐 여부(보고서 이름 카드 설명) — 테넌트 캐시. 실패하면 종전 문구(켜짐)로.
    getTenantSettings().catch(() => null),
    // 맡은 반(담임 ∪ 교시 담당)이 있는가 — **아르바이트만** 묻는다(수업보고서 이름 카드). 다른 역할은 묻지 않고 카드를 그대로 둔다.
    user.systemRole === "parttime" ? hasAssignedClass(user.id, user.tenantId) : Promise.resolve(true),
  ]);
  // 내역은 구간이 있어야 물어볼 수 있다(입사일 미등록이면 구간 자체가 없다) — 잔여에 의존하는 조회라
  // 위 Promise.all에 못 넣는다. 여기서도 실패는 null(카드가 "못 불러왔다"를 그대로 적는다).
  const leaveHistory = balance?.period
    ? await getMyLeaveHistory(user.id, {
        start: balance.period.start,
        end: balance.period.end,
      }).catch(() => null)
    : null;
  const placeholder = isImportArtifactEmail(user.email);
  // 수업보고서 이름 — 반이 없는 아르바이트에겐 쓸 데가 없다(원장 2026-11-05 *"수업이 없는 일반 아르바이트 (소속 반이 없음) 필요없음"*).
  // 단 이미 저장한 값이 있으면 카드를 둔다 — 숨기면 그 값을 지울 길이 없어진다.
  const showReportName = hasClass || !!reportName.name || reportName.includeClassName;

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
  const lang = await getTeacherViewLang();

  return (
    <div className="print-portrait space-y-5 p-6">
      <div className="print:hidden">
        <Link
          href={home}
          className="text-text-dim hover:text-primary mb-2 inline-flex items-center gap-1 text-xs font-medium transition"
        >
          <ArrowLeft className="size-3.5" /> {sheetT(lang, "me.back")}
        </Link>
        <PageHeader
          eyebrow={sheetT(lang, "me.eyebrow")}
          title={user.displayName}
          description={sheetT(lang, "me.desc")}
          // ⚠️ title이 **본인 이름**(메뉴명이 아니다)이라 컴팩트(창·모바일)에선 접힌다 →
          //    이름을 컴팩트 행에 직접 실어야 좁은 화면에서 "누구의 정보인지"가 남는다.
          embedLabel={sheetTf(lang, "me.embed", { name: user.displayName })}
        />
      </div>

      <div className="print:hidden space-y-5">
        <AccountCard email={user.email} isPlaceholder={placeholder} />
        {/* 연차 — 남은 일수와 "언제 썼는지". 사무실이 적은 조정(이월·특별휴가·정산 차감)도 같은 목록에
            날짜순으로 선다. 숫자는 결재함·연차 관리 표와 **같은 산식**(balance.ts)이다. */}
        {balance ? <LeaveCard lang={lang} balance={balance} history={leaveHistory} /> : null}
        {/* 수업보고서 발송용 이름(0217a) — 발송·공유·인쇄에 실명 대신 표시할 이름을 본인이 정한다. */}
        {showReportName ? (
          <ReportNameCard
            realName={user.displayName}
            initialName={reportName.name}
            initialIncludeClassName={reportName.includeClassName}
            mappingBlocked={!!(reportName.name || reportName.includeClassName) && (resolvedSendName.name !== reportName.name || resolvedSendName.includeClassName !== reportName.includeClassName)}
            classnoteOn={settings ? classnoteModuleOn(settings) : true}
          />
        ) : null}
        {slack ? <SlackLinkCard linked={slack.linked} email={slack.email} /> : null}
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
