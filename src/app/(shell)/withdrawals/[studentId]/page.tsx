import { notFound } from "next/navigation";
import { BookOpen, MessagesSquare, ScrollText } from "lucide-react";
import type { ReactNode } from "react";
import { requireAccess } from "@/lib/auth/require-access";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { BackLink } from "@/components/back-link";
import { EditableDateCell } from "@/features/enrollments/components/editable-date-cell";
import {
  enrollmentDuration,
  getWithdrawalDetail,
  REASON_LABEL,
  reasonDisplay,
} from "@/features/withdrawals/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { ConsultationTracker } from "../_components/consultation-tracker";
import { ReactivateButton } from "../_components/reactivate-button";
import { WithdrawalReasonCard } from "../_components/reason-card";

export const metadata = { title: "퇴원 상세 — eywa" };

export default async function WithdrawalDetailPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const user = await requireAccess("withdrawals");
  const { studentId } = await params;
  const [detail, settings] = await Promise.all([
    getWithdrawalDetail(studentId),
    getTenantSettings(),
  ]);
  if (!detail) notFound();
  const subjects = buildSubjectMaps(settings.operations.subjects);
  // 수강 이력 시작/종료일 더블클릭 정정 = owner(원장) 권한 이상만(다른 화면과 동일 게이트).
  const canEditDates = (await accessLevelTenant(user.systemRole, "owner")) === "full";

  const md = detail.metadata;
  const duration = enrollmentDuration(detail.enrolledAt, detail.withdrawnAt);

  return (
    <div className="space-y-6">
      <BackLink href="/withdrawals" label="퇴원관리로" />

      <header className="border-border flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <p className="eyebrow">퇴원 학생</p>
          <h1 className="display text-foreground text-3xl">{detail.name}</h1>
          <p className="text-muted-foreground flex flex-wrap items-center gap-3 text-sm">
            {detail.grade ? <span>{detail.grade}</span> : null}
            {detail.school ? <span>· {detail.school}</span> : null}
            {detail.primaryTeacherName ? <span>· 담임 {detail.primaryTeacherName}</span> : null}
          </p>
          {/* 연락처 — 사후 상담(전화) 시 학생관리로 우회하지 않게 상세에 노출(클릭 통화). */}
          {detail.studentPhone || detail.parentPhone ? (
            <p className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
              {detail.studentPhone ? (
                <span>
                  학생{" "}
                  <a href={`tel:${detail.studentPhone}`} className="text-foreground num hover:underline">
                    {detail.studentPhone}
                  </a>
                </span>
              ) : null}
              {detail.parentPhone ? (
                <span>
                  · 학부모{detail.parentName ? `(${detail.parentName})` : ""}{" "}
                  <a href={`tel:${detail.parentPhone}`} className="text-foreground num hover:underline">
                    {detail.parentPhone}
                  </a>
                </span>
              ) : null}
            </p>
          ) : null}
          <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
            <span className="num">{detail.enrolledAt ?? "—"}</span>
            <span>~</span>
            <span className="num">{detail.withdrawnAt ?? "—"}</span>
            <span>·</span>
            <span>총 등록 기간 {duration}</span>
          </p>
        </div>
        <ReactivateButton studentId={detail.id} />
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="퇴원 사유" icon={<ScrollText className="size-3.5" />}>
          <WithdrawalReasonCard
            studentId={detail.id}
            initialReason={md?.reason ?? null}
            initialMemo={md?.memo ?? null}
          />
        </Card>

        <Card title="상담 추적" icon={<MessagesSquare className="size-3.5" />}>
          <ConsultationTracker
            studentId={detail.id}
            initial={
              md?.consultation ?? {
                adminCalledParent: false,
                teacherCalledParent: false,
                talkedWithStudent: false,
              }
            }
          />
          <p className="text-muted-foreground mt-3 text-xs">
            체크하면 즉시 저장됩니다. 재등록 가능성 평가용 기록.
          </p>
        </Card>
      </div>

      {/* 수강 이력 — 그룹 제목(아이콘+라벨+건수) + 리스트 카드. 내부 헤더바 제거해 다른 섹션과 스타일 통일. */}
      <div className="space-y-4">
        <header className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BookOpen className="text-primary size-4" />
            <h2 className="text-foreground text-sm font-semibold">수강 이력</h2>
          </div>
          <p className="text-muted-foreground num text-xs">{detail.enrollmentHistory.length}건</p>
        </header>
        <section className="bg-card border-border rounded-lg border">
        {detail.enrollmentHistory.length === 0 ? (
          <div className="text-muted-foreground px-5 py-8 text-center text-sm">수강 기록이 없습니다</div>
        ) : (
          <ul className="divide-border divide-y">
            {detail.enrollmentHistory.map((e) => (
              <li key={e.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium">{e.className}</p>
                  {canEditDates ? (
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

function Card({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="bg-card border-border space-y-3 rounded-lg border p-5">
      <h3 className="eyebrow inline-flex items-center gap-1.5">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}
