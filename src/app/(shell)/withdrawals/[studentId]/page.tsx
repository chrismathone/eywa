import { notFound } from "next/navigation";
import { MessagesSquare, ScrollText } from "lucide-react";
import type { ReactNode } from "react";
import { requireAccess } from "@/lib/auth/require-access";
import { BackLink } from "@/components/back-link";
import {
  enrollmentDuration,
  getWithdrawalDetail,
  REASON_LABEL,
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
  await requireAccess("withdrawals");
  const { studentId } = await params;
  const [detail, settings] = await Promise.all([
    getWithdrawalDetail(studentId),
    getTenantSettings(),
  ]);
  if (!detail) notFound();
  const subjects = buildSubjectMaps(settings.operations.subjects);

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

      <section className="bg-card border-border rounded-lg border">
        <header className="border-border flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-sm font-semibold tracking-tight">수강 이력</h2>
          <p className="text-muted-foreground num text-xs">{detail.enrollmentHistory.length}건</p>
        </header>
        {detail.enrollmentHistory.length === 0 ? (
          <div className="text-muted-foreground px-5 py-8 text-center text-sm">수강 기록이 없습니다</div>
        ) : (
          <ul className="divide-border divide-y">
            {detail.enrollmentHistory.map((e) => (
              <li key={e.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium">{e.className}</p>
                  <p className="text-muted-foreground text-xs">
                    {subjects.labelOf(e.subject)} ·{" "}
                    <span className="num">{e.startDate}</span>
                    {e.endDate ? <> ~ <span className="num">{e.endDate}</span></> : <> ~ 현재</>}
                  </p>
                </div>
                {e.reason ? (
                  <span className="text-muted-foreground text-xs italic">{e.reason}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

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
