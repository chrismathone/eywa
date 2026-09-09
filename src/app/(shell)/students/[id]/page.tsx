import { WindowLink } from "@/components/workspace/window-link";
import { notFound } from "next/navigation";
import { Pencil } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { requireAccess } from "@/lib/auth/require-access";
import { accessLevelTenant, canAccessTenant, canManageTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { canSeeStudentEnrollment } from "@/features/students/server/enrollment-gate";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { BackLink } from "@/components/back-link";
import { DupSuspectTag } from "@/components/dup-suspect-tag";
import { getStudentById, getStudentEnrollments } from "@/features/students/server/queries";
import { studentStatusMeta } from "@/features/students/status-labels";
import { Pill } from "@/components/atoms/pill";
import { DupSuspectNotice } from "./_components/dup-suspect-notice";
import { RunCareAiButton } from "./run-care-ai-button";
import { StudentTabsNav, isStudentTabKey } from "./_components/tabs-nav";
import { ScheduledChangeBanner } from "@/components/scheduled-change-banner";
import { ScheduledChangeActions } from "@/components/scheduled-change-actions";
import { getScheduledForStudent } from "@/features/enrollments/server/scheduled-queries";
import { kstToday } from "@/lib/date-kst";
import { isInternalPath } from "@/lib/navigation";
import { StatusAction } from "./_components/status-action";
import { DeleteStudentButton } from "./_components/delete-student-button";
import { OverviewTab } from "./_tabs/overview-tab";
import { ClassesTab } from "./_tabs/classes-tab";
import { BillingTab } from "./_tabs/billing-tab";
import { GradesTab } from "./_tabs/grades-tab";
import { ProgressTab } from "./_tabs/progress-tab";
import { AttendanceTab } from "./_tabs/attendance-tab";
import { ConsultationsTab } from "./_tabs/consultations-tab";
import { MemosTab } from "./_tabs/memos-tab";
import { TimelineTab } from "./_tabs/timeline-tab";

export const metadata = { title: "학생 상세 — eywa" };


export default async function StudentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; back?: string }>;
}) {
  const user = await requireAccess("students");
  const { id } = await params;
  const { tab: tabParam, back: backParam } = await searchParams;
  const requestedTab = isStudentTabKey(tabParam) ? tabParam : "overview";
  // 학생을 **어디서 열었는지** — 영구 삭제 뒤 돌아갈 자리다(원장 2026-09-09: 신규생 관리에서 삭제하면
  // 그 창이 원생목록으로 바뀌어 신규생 관리로 못 돌아갔다). 목록마다 링크에 `?back=<경로>`를 달면 된다.
  // 🔴 여기서 **서버가 검증**한다 — 값을 그대로 `location.replace`에 넘기므로 `//evil.com`·`https://…`
  //    같은 외부 주소가 들어오면 열린 리다이렉트가 된다. 앱 내부 절대경로 한 갈래만 통과시킨다.
  const backHref = isInternalPath(backParam) ? backParam : "/students";

  // '수납' 탭은 학생(students) 권한이 아니라 **수납(billing) 권한**으로 잠근다 — 학생 상세는 강사(scoped)·
  // 뷰어(readonly)도 열 수 있어서, 탭 하나가 billing=none 역할에게 청구·납입 금액을 통째로 노출하고 있었다.
  // 강제 URL(?tab=billing)도 개요로 되돌린다(UI 숨김은 게이트가 아니다 — gotchas #77).
  // DB에서도 0158a RLS가 같은 매트릭스로 막는다(권한 없으면 0행) — 여기서 되돌리는 이유는 그 경우
  // 화면이 "미납 0원"이라는 **거짓 요약**을 보여주기 때문.
  const canSeeBilling = await canAccessTenant(user.systemRole, "billing");
  const tab = requestedTab === "billing" && !canSeeBilling ? "overview" : requestedTab;

  const student = await getStudentById(id);
  if (!student) {
    // 강사(scoped)는 담당 학생만 상세 열람(적대 리뷰 F9) — 차단이면 404 대신 이유를 말한다.
    // (없는 학생과 비담당 학생을 구분해 주진 않는다 — 존재 여부 자체도 담당 밖 정보다.)
    if ((await accessLevelTenant(user.systemRole, "students")) === "scoped") {
      return (
        <div className="space-y-6">
          <BackLink href="/students" label="원생목록으로" />
          <div className="bg-card border-line rounded-2xl border p-6">
            <p className="text-foreground text-sm font-bold">담당 학생만 열람할 수 있어요</p>
            <p className="text-text-dim mt-1 text-sm">
              이 학생은 내 반(담임·교시 담당·임시 위임) 수강생이 아니거나, 수강이 끝난 지 오래됐어요.
              열람이 필요하면 데스크(관리자)에 요청해 주세요.
            </p>
          </div>
        </div>
      );
    }
    notFound();
  }

  const hasCareAi = student.aiCareSummary !== null;
  const statusMeta = studentStatusMeta(student.status);
  // 학생 기록 변경(상태 전환·수정·AI 케어·수강 종료) = 학생 full 권한만(master·admin·manager·counselor).
  // 🔴 강사(scoped)는 열람 전용 — 원장 지시 2026-08-18("강사들은 퇴원처리 막아, 수정도, AI 케어도. 읽기만").
  // 서버 게이트는 students/server/actions.ts canManageStudentRecords가 같은 판정(#77 — UI 숨김만으론 부족).
  const canManageStudent = (await accessLevelTenant(user.systemRole, "students")) === "full";
  // 퇴원 다이얼로그가 "어느 수업을 종료할지" 고르게 하려면 활성 수강 목록이 필요하다(원장 2026-08-20:
  // 한 과목만 그만두는데 두 과목이 함께 종료돼 말싸움). **권한이 있을 때만** 조회한다 — 강사·뷰어에겐
  // 이 다이얼로그 자체가 없다. canManageStudent에 의존하므로 병렬화 대상이 아니다(B4는 독립 await 규칙).
  // ⚠️ 필터(end_date == null)는 서버가 실제로 닫는 기준(closeActiveEnrollmentsClamped)과 **같아야** 한다 —
  //    갈리면 화면이 보여준 목록과 실제로 닫히는 행이 어긋난다.
  const openEnrollments = canManageStudent
    ? (await getStudentEnrollments(student.id))
        .filter((e) => e.endDate == null)
        .map((e) => ({
          id: e.id,
          className: e.className,
          subject: e.subject,
          teacherName: e.teacherName,
        }))
    : [];
  // 학생 영구 삭제 = 관리 도구(admin) 쓰기 권한(기본 master) — 파괴적이라 조임. 잘못 추가 정정용.
  const canDeleteStudent = await canWriteTenant(user.systemRole, "admin");
  // 시작/종료일 더블클릭 수정 = owner(원장) 콘솔 권한 이상만(관리자 정정).
  const canEditDates = (await accessLevelTenant(user.systemRole, "owner")) === "full";
  // 분리등원 요일(스케줄) 더블클릭 편집 — 서버 `updateEnrollmentsAttendanceBatch`는 **관리자(full)만**.
  // ⚠️ 종전 `canWriteTenant`는 scoped(강사)도 통과시켜, 강사에게 편집 칸이 열리고 저장만 거절됐다(#77 반대 꼴).
  const canEditSchedule = await canManageTenant(user.systemRole, "classes");
  // 잘못 만든 **수업 이력 삭제** = 원장(owner 콘솔 full) + super_admin(원장 2026-08-20).
  // 🔴 super_admin은 새 게이트를 항상 통과한다(원장 2026-08-13). 서버 `deleteEnrollment`가 같은 판정을
  //    다시 하고 붙은 기록까지 검사한다 — 화면 조건은 게이트가 아니다(#77).
  const canDeleteEnrollment = canEditDates || (await isCurrentUserSuperAdmin());
  // 입학 상담(등록상담) 상담탭 노출.
  // ① enrollment 접근권한(원장·상담사 등) → 카드 + '상세 보기' 링크 모두.
  // ② 권한 없어도 **강사가 본인 담당 학생**이면 카드는 노출(읽기) — 단 '상세 보기'(/enrollment/[id])는
  //    여전히 enrollment 게이트라 링크는 숨김. (강사는 담당 학생의 입학 배경만 열람, 관리 상세는 불가.)
  // ①②의 판정은 타임라인 이벤트와 **같은 게이트 함수**를 쓴다(#77 — 표면마다 다시 쓰면 한쪽만 조여진다).
  const enrollmentAccess = (await accessLevelTenant(user.systemRole, "enrollment")) !== "none";
  const canSeeEnrollment = await canSeeStudentEnrollment(user.systemRole, student.id);
  const canOpenEnrollmentDetail = enrollmentAccess;

  // 예정된 반 변경(합류·이동·종료 예정) — 탭 위 배너. 예약이 없으면 빈 배열이라 아무것도 안 그린다.
  // 🔴 **열람은 막지 않는다**(강사도 자기 담당 학생의 예정은 알아야 한다). 수정·취소 버튼만 게이트.
  // 🔴 그 게이트는 **서버 액션과 같은 축**이어야 한다 — `canManageTenant("classes")`(반 이동을 *만드는*
  //    것과 같은 게이트). 학생 권한(students full)으로 버튼을 열면 상담사에게 버튼은 보이는데 서버가
  //    거절한다(#77의 반대 꼴 — 화면과 게이트가 갈리면 어느 쪽이든 거짓말이 된다).
  const [scheduled, canManageScheduled] = await Promise.all([
    getScheduledForStudent(student.id),
    canManageTenant(user.systemRole, "classes"),
  ]);

  return (
    <div className="space-y-6">
      <BackLink href="/students" label="원생목록으로" />

      <header className="border-border flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <p className="eyebrow">학생</p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-bold tracking-tight text-foreground text-3xl">{student.name}</h1>
            {student.dupSuspect ? <DupSuspectTag /> : null}
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-sm">
            {student.grade ? <span>{student.grade}</span> : null}
            {student.school ? <span>· {student.school}</span> : null}
            {student.studentCode ? (
              <span className="num">· 학번 {student.studentCode}</span>
            ) : null}
          </div>
          {student.dupSuspect ? (
            <DupSuspectNotice studentId={student.id} canClear={canManageStudent} />
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          {/* 상태 배지 = 목록·요약과 같은 단일 소스(studentStatusMeta) — 화면마다 색이 달라지지 않게.
              ⚠️ 크기는 Pill 기본을 그대로 쓴다. 처음엔 `className="px-2.5 py-1 text-xs"`를 얹었는데
              Pill이 tailwind-merge를 안 거쳐서 기본값(text-xs py-[3px])과 **충돌한 채 둘 다 남고**
              실제로는 기본값이 이겼다(계산값 11px/3px 실측) — 아무 효과 없는 거짓 클래스였다. */}
          <Pill color={statusMeta?.color ?? "neutral"}>{statusMeta?.label ?? student.status}</Pill>
          {/* ⚠️ 감기게 둔다 — 이 줄엔 상태 변경·수정·AI·삭제가 함께 서고, 라벨에 목적어를 붙이면
              (수정 → 학생 수정) 좁은 화면에서 가로로 넘친다. 넘치는 대신 다음 줄로 내려간다. */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* 강사(scoped)는 열람 전용 — 상태 변경·학생 수정·AI 케어 전부 비노출(위 canManageStudent 주석). */}
            {canManageStudent ? (
              <StatusAction
                studentId={student.id}
                studentName={student.name}
                currentStatus={student.status}
                openEnrollments={openEnrollments}
              />
            ) : null}
            {/* ⚠️ "수정" 단독 금지 — 상담 탭을 열면 상담 카드마다 '수정'(그 상담 기록)이 함께 보인다.
                여기는 **학생 정보**를 연다. 반 상세('반 수정')와 같은 규칙. */}
            {canManageStudent ? (
              <Button variant="outline" render={<WindowLink href={`/students/${student.id}/edit`} title="학생 수정" />}>
                <Pencil className="size-3.5" />
                학생 수정
              </Button>
            ) : null}
            {canManageStudent && student.status === "enrolled" ? (
              <RunCareAiButton studentId={student.id} hasExisting={hasCareAi} />
            ) : null}
            {canDeleteStudent ? (
              <DeleteStudentButton studentId={student.id} studentName={student.name} backHref={backHref} />
            ) : null}
          </div>
        </div>
      </header>

      {/* 예정된 변경 — 원장 지시(2026-08-28): 탭 위에 경고처럼 띄우고 우측에서 수정·취소.
          미래 예약은 오늘 화면에 흔적이 없어 잊힌다(실측: 미래 시작 수강 28건이 어디에도 안 보였다). */}
      <ScheduledChangeBanner
        changes={scheduled}
        today={kstToday()}
        subject="student"
        actions={
          canManageScheduled
            ? (c) => <ScheduledChangeActions change={c} today={kstToday()} />
            : undefined
        }
      />

      <StudentTabsNav studentId={student.id} active={tab} canSeeBilling={canSeeBilling} />

      <section>
        {tab === "overview" ? (
          <OverviewTab student={student} />
        ) : tab === "classes" ? (
          <ClassesTab
            student={student}
            canEnd={canManageStudent}
            canEditDates={canEditDates}
            canEditSchedule={canEditSchedule}
            canDeleteEnrollment={canDeleteEnrollment}
          />
        ) : tab === "grades" ? (
          <GradesTab studentId={student.id} />
        ) : tab === "progress" ? (
          <ProgressTab studentId={student.id} />
        ) : tab === "attendance" ? (
          <AttendanceTab studentId={student.id} />
        ) : tab === "consultations" ? (
          <ConsultationsTab
            studentId={student.id}
            canSeeEnrollment={canSeeEnrollment}
            canOpenEnrollmentDetail={canOpenEnrollmentDetail}
          />
        ) : tab === "memos" ? (
          <MemosTab studentId={student.id} />
        ) : tab === "billing" ? (
          <BillingTab studentId={student.id} />
        ) : tab === "timeline" ? (
          <TimelineTab studentId={student.id} />
        ) : null}
      </section>
    </div>
  );
}
