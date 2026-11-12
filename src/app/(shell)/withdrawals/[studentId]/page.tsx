import { canManageStudentStatusNow } from "@/features/students/server/status-access";
import { notFound } from "next/navigation";
import { BookOpen, MessagesSquare, ScrollText } from "@/components/icons/aywa-icon-compat";
import { requireAccess } from "@/lib/auth/require-access";
import { accessLevelTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { getEnrollmentDateAccess } from "@/features/enrollments/server/date-access";
import { canEditEnrollmentDateClass } from "@/features/enrollments/date-access";
import { WindowLink } from "@/components/workspace/window-link";
import { BackLink } from "@/components/back-link";
import { EditableDateCell } from "@/features/enrollments/components/editable-date-cell";
import {
  enrollmentDuration,
  getWithdrawalDetail,
  REASON_LABEL,
  reasonDisplay,
} from "@/features/withdrawals/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps, subjectLabelRecord } from "@/features/owner/subjects";
import { loadStudentReportRecords } from "@/features/withdrawal-reports/server/student-records";
import { loadLinkedConsultations } from "@/features/withdrawals/server/linked-consultations";
import { ConsultationTracker } from "../_components/consultation-tracker";
import { DetailCard as Card } from "../_components/detail-card";
import { LinkedConsultationsCard } from "../_components/linked-consultations-card";
import { LinkedReportsCard } from "../_components/linked-reports-card";
import { ReactivateButton } from "../_components/reactivate-button";
import { WithdrawalReasonCard } from "../_components/reason-card";
import { ReportDateBadge } from "../_components/report-date-badge";
import { phoneLabel } from "@/lib/format/phone";

export const metadata = { title: "퇴원 상세 — 에이와" };

export default async function WithdrawalDetailPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const user = await requireAccess("withdrawals");
  const { studentId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(studentId)) notFound();
  // 퇴원보고서·콜&상담 카드는 각자 목적지 메뉴 권한으로 가리고, 실패해도 카드만 안내한다(throw 없음) — 독립 조회라 한 번에(B4).
  const [detail, settings, reportRecords, consults] = await Promise.all([
    getWithdrawalDetail(studentId),
    getTenantSettings(),
    loadStudentReportRecords(studentId),
    loadLinkedConsultations(studentId, user.systemRole),
  ]);
  if (!detail) notFound();
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const reportLabels = subjectLabelRecord(settings.operations.subjects); // 퇴원보고서 과목 = 보고서 화면과 같은 라벨표
  // 날짜 정정 자격은 개인별 기능 지정이며, 다른 화면과 같은 판정이다.
  // 권한 판정 셋은 서로 독립 → 병렬(B4).
  const [dateAccess, canWrite, canManageStudents, studentsLvl] = await Promise.all([
    getEnrollmentDateAccess(),
    canWriteTenant(user.systemRole, "withdrawals"),
    canManageStudentStatusNow(),
    accessLevelTenant(user.systemRole, "students"),
  ]);
  // 재원 복구 = 서버 게이트와 같은 두 문(퇴원관리 쓰기 ∧ 원생 기록 변경) — 못 누를 사람에겐 안 보인다(감사 E9·S6).
  const canReactivate = canWrite && canManageStudents;
  const canOpenStudent = studentsLvl !== "none";

  const md = detail.metadata;
  const duration = enrollmentDuration(detail.enrolledAt, detail.withdrawnAt);

  return (
    <div className="space-y-6">
      <BackLink href="/withdrawals" label="퇴원관리로" />

      <header className="border-border flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <p className="eyebrow">퇴원 학생</p>
          <h1 className="font-bold tracking-tight text-foreground text-3xl">{detail.name}</h1>
          <p className="text-muted-foreground flex flex-wrap items-center gap-3 text-sm">
            {detail.grade ? <span>{detail.grade}</span> : null}
            {detail.school ? <span>· {detail.school}</span> : null}
          </p>
          {/* 연락처 — 사후 상담(전화) 시 학생관리로 우회하지 않게 상세에 노출(클릭 통화). */}
          {detail.studentPhone || detail.parentPhone ? (
            <p className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
              {detail.studentPhone ? (
                <span>
                  학생{" "}
                  <a href={`tel:${detail.studentPhone}`} className="text-foreground num hover:underline">
                    {phoneLabel(detail.studentPhone)}
                  </a>
                </span>
              ) : null}
              {detail.parentPhone ? (
                <span>
                  · 학부모{detail.parentName ? `(${detail.parentName})` : ""}{" "}
                  <a href={`tel:${detail.parentPhone}`} className="text-foreground num hover:underline">
                    {phoneLabel(detail.parentPhone)}
                  </a>
                </span>
              ) : null}
            </p>
          ) : null}
          <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
            <span className="num">{detail.enrolledAt ?? "—"}</span>
            <span>~</span>
            <span className="num">{detail.withdrawnAt ?? "—"}</span>
            <ReportDateBadge
              withdrawnAt={detail.studentStatus === "withdrawn" ? detail.withdrawnAt : null}
              enrollments={detail.enrollmentHistory.map((e) => ({ subject: e.subject === "?" ? null : e.subject, startDate: e.startDate, endDate: e.endDate }))}
              records={reportRecords}
              labels={reportLabels}
            />
            <span>·</span>
            <span>총 등록 기간 {duration}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* 사후 상담 중 이력을 보려고 원생목록에서 다시 찾지 않게(감사 N6). */}
          {canOpenStudent ? (
            <WindowLink href={`/students/${detail.id}`} title={detail.name}>
              <span className="text-primary text-sm font-semibold hover:underline">원생 상세 보기</span>
            </WindowLink>
          ) : null}
          {canReactivate ? <ReactivateButton studentId={detail.id} /> : null}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="퇴원 사유" icon={<ScrollText className="size-3.5" />}>
          <WithdrawalReasonCard
            studentId={detail.id}
            initialReason={md?.reason ?? null}
            initialDetail={md?.detail ?? null}
            initialMemo={md?.memo ?? null}
            readOnly={!canWrite}
          />
        </Card>

        <Card title="상담 추적" icon={<MessagesSquare className="size-3.5" />}>
          <ConsultationTracker
            studentId={detail.id}
            readOnly={!canWrite}
            initial={
              md?.consultation ?? {
                adminCalledParent: false,
                teacherCalledParent: false,
                talkedWithStudent: false,
              }
            }
          />
          {/* 읽기 권한이면 체크가 잠겨 있다 — '즉시 저장'이라고 쓰지 않는다(원장 2026-11-05). 권한 안내는 위 사유 카드가
              이미 한 줄 적으므로 여기선 기록의 용도만 남긴다(같은 문장이 두 번 뜨지 않게 · 2026-11-05 리뷰). */}
          <p className="text-muted-foreground mt-3 text-xs">
            {canWrite ? "체크하면 즉시 저장됩니다. 재등록 가능성 평가용 기록." : "재등록 가능성 평가용 기록."}
          </p>
        </Card>

        {reportRecords.status !== "hidden" ? (
          <LinkedReportsCard records={reportRecords} studentName={detail.name} labels={reportLabels} />
        ) : null}
        {consults.status !== "hidden" ? <LinkedConsultationsCard consults={consults} labelOf={subjects.labelOf} /> : null}
      </div>

      {/* 수강 이력 — 그룹 제목(아이콘+라벨+건수) + 리스트 카드. 내부 헤더바 제거해 다른 섹션과 스타일 통일. */}
      <div className="space-y-4">
        <header className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BookOpen className="text-primary size-4" />
            <h2 className="text-foreground text-sm font-bold">수강 이력</h2>
          </div>
          <p className="text-muted-foreground num text-xs">{detail.enrollmentHistory.length}건</p>
        </header>
        <section className="bg-card border-border rounded-2xl border">
        {detail.enrollmentHistory.length === 0 ? (
          <div className="text-muted-foreground px-5 py-8 text-center text-sm">수강 기록이 없습니다</div>
        ) : (
          <ul className="divide-border divide-y">
            {detail.enrollmentHistory.map((e) => (
              <li key={e.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium">{e.className}</p>
                  {canEditEnrollmentDateClass(dateAccess, e.classId) ? (
                    <div className="text-muted-foreground inline-flex flex-wrap items-center gap-1 text-xs">
                      <span>
                        {subjects.labelOf(e.subject)} · 담임 {e.teacherName ?? "미배정"} ·
                      </span>
                      <EditableDateCell enrollmentId={e.id} field="start" value={e.startDate} />
                      <EditableDateCell enrollmentId={e.id} field="end" value={e.endDate} />
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-xs">
                      {subjects.labelOf(e.subject)} · 담임 {e.teacherName ?? "미배정"} ·{" "}
                      <span className="num">{e.startDate}</span>
                      {e.endDate ? <> ~ <span className="num">{e.endDate}</span></> : <> ~ 현재</>}
                    </p>
                  )}
                </div>
                {e.reason ? (
                  <span className="text-muted-foreground text-xs italic">{reasonDisplay(e.reason)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        </section>
      </div>

      {/* Reason badge legend for UI hint */}
      <p className="text-muted-foreground text-xs">
        카테고리: {Object.values(REASON_LABEL).join(" · ")}
      </p>
    </div>
  );
}
