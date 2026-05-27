import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { requireAccess } from "@/lib/auth/require-access";
import { formatCreatedAt } from "@/lib/utils";
import {
  getEnrollmentConsultationById,
  type AiAnalysisDetail,
} from "@/features/enrollment/server/queries";
import { RunAiButton } from "./run-ai-button";

export const metadata = { title: "신입생 상담 상세 — eywa" };

const OUTCOME_BADGE: Record<string, { label: string; class: string }> = {
  pending: { label: "대기", class: "text-chart-3 bg-chart-3/10 border-chart-3/20" },
  scheduled: { label: "예약", class: "text-chart-3 bg-chart-3/10 border-chart-3/20" },
  consulted: { label: "상담완료", class: "text-chart-1 bg-chart-1/10 border-chart-1/20" },
  ai_done: { label: "AI 완료", class: "text-chart-2 bg-chart-2/10 border-chart-2/20" },
  enrolled: { label: "등록", class: "text-chart-2 bg-chart-2/10 border-chart-2/20" },
  declined: { label: "거절", class: "text-muted-foreground bg-muted border-border" },
  no_show: { label: "노쇼", class: "text-chart-4 bg-chart-4/10 border-chart-4/20" },
};

export default async function EnrollmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccess("enrollment");
  const { id } = await params;
  const consult = await getEnrollmentConsultationById(id);
  if (!consult) notFound();

  const badge = OUTCOME_BADGE[consult.outcome] ?? OUTCOME_BADGE.pending!;

  return (
    <div className="space-y-6">
      <Link
        href="/enrollment"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition"
      >
        <ArrowLeft className="size-3.5" />
        등록상담으로
      </Link>

      <header className="border-border flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <p className="eyebrow">신입생 등록상담</p>
          <div className="flex items-baseline gap-3">
            <h1 className="display text-foreground text-3xl">{consult.prospectName}</h1>
            <span
              className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${badge.class}`}
            >
              {badge.label}
            </span>
          </div>
          <p className="text-muted-foreground text-sm">
            {consult.prospectGrade ?? "—"}
            {consult.prospectSchool ? <> · {consult.prospectSchool}</> : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {consult.aiAnalysis ? (
            <Button render={<Link href={`/enrollment/${id}/print`} target="_blank" />}>
              <Printer className="size-4" />
              인쇄 양식
            </Button>
          ) : (
            <RunAiButton consultationId={id} />
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          <Card title="학부모 요구사항">
            <p className="text-foreground text-sm leading-relaxed">
              {consult.parentRequest ?? "기재된 요구사항이 없습니다."}
            </p>
          </Card>

          <Card title="학습 이력">
            <dl className="space-y-2.5 text-sm">
              <Field label="이전 학원" value={consult.learningHistory?.prevAcademy ?? null} />
              <Field label="최근 성적" value={consult.learningHistory?.lastScore ?? null} />
              <Field
                label="약점 단원"
                value={
                  consult.learningHistory?.weakSubjects?.length
                    ? consult.learningHistory.weakSubjects.join(", ")
                    : null
                }
              />
            </dl>
          </Card>

          <Card title="연락처">
            <dl className="space-y-2.5 text-sm">
              <Field label="학부모" value={consult.parentName} />
              <Field label="연락처" value={consult.parentPhone} mono />
              <Field label="상담사" value={consult.consultantName} />
              <Field label="상담일" value={new Date(consult.consultedAt).toLocaleDateString("ko-KR")} mono />
            </dl>
          </Card>
        </div>

        <div className="lg:col-span-2">
          {consult.aiAnalysis ? (
            <AiAnalysisPanel
              analysis={consult.aiAnalysis}
              recommendedClasses={consult.recommendedClasses}
            />
          ) : (
            <Card title="AI 분석 결과">
              <p className="text-muted-foreground py-12 text-center text-sm">
                아직 AI 분석이 실행되지 않았습니다.
                <br />
                상담 완료 후 분석을 실행하면 학생 진단과 추천 반이 자동 생성됩니다.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-card border-border rounded-lg border p-5">
      <h3 className="eyebrow mb-3">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground shrink-0 text-xs">{label}</dt>
      <dd className={`text-foreground text-right text-sm ${mono ? "num" : ""}`}>{value ?? "—"}</dd>
    </div>
  );
}

function AiAnalysisPanel({
  analysis,
  recommendedClasses,
}: {
  analysis: AiAnalysisDetail;
  recommendedClasses: { id: string; className: string; subject: string }[];
}) {
  const { diagnosis, learningPlan } = analysis;
  return (
    <div className="space-y-4">
      <section className="bg-card border-border rounded-lg border p-5">
        <header className="flex items-center justify-between gap-3">
          <div>
            <p className="eyebrow">AI 분석 결과</p>
            <h3 className="text-foreground mt-1 text-base font-semibold">진단 요약</h3>
          </div>
          <span className="text-muted-foreground num text-[10px]">
            {formatCreatedAt(analysis.generatedAt)}
          </span>
        </header>
        <p className="text-foreground mt-3 text-sm leading-relaxed">{diagnosis.summary}</p>
        <p className="text-muted-foreground mt-3 text-xs">
          종합 수준:{" "}
          <span className="text-foreground font-medium">{diagnosis.level}</span>
        </p>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card title="강점">
          <ul className="space-y-1.5 text-sm">
            {diagnosis.strengths.map((s) => (
              <li key={s} className="text-foreground flex gap-2">
                <span className="text-chart-2 shrink-0">＋</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="약점">
          <ul className="space-y-1.5 text-sm">
            {diagnosis.weaknesses.map((w) => (
              <li key={w} className="text-foreground flex gap-2">
                <span className="text-chart-4 shrink-0">－</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="학습 계획">
        <div className="space-y-4 text-sm">
          <Plan label="즉시 (4주)" items={learningPlan.immediate} />
          <Plan label="이번 학기" items={learningPlan.semester} />
          <Plan label="장기" items={learningPlan.longTerm} />
        </div>
      </Card>

      {recommendedClasses.length > 0 ? (
        <Card title="추천 반">
          <ul className="space-y-2 text-sm">
            {recommendedClasses.map((c) => (
              <li
                key={c.id}
                className="border-border bg-muted/30 flex items-center justify-between rounded-md border px-3 py-2"
              >
                <span className="text-foreground font-medium">{c.className}</span>
                <span className="text-muted-foreground text-xs">{c.subject}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function Plan({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {label}
      </p>
      <ul className="mt-1.5 space-y-1">
        {items.map((item, i) => (
          <li key={i} className="text-foreground flex gap-2">
            <span className="text-muted-foreground shrink-0">·</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
