import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertCircle, Loader2, Mic, Pencil, Printer, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { requireAccess } from "@/lib/auth/require-access";
import { BackLink } from "@/components/back-link";
import { formatCreatedAt } from "@/lib/utils";
import {
  getEnrollmentConsultationById,
  type AiAnalysisDetail,
  type ConsultationAudioReport,
  type ConsultationProcessingStatus,
  type FullConsultationFields,
} from "@/features/enrollment/server/queries";
import { COMMON_FIELDS, ENGLISH_GROUPS, GENDER_OPTIONS, SUBJECT_TABS } from "@/features/enrollment/form-config";
import { getClassesList } from "@/features/classes/server/queries";
import { TranscriptSection } from "@/components/transcript-section";
import { RichText } from "@/components/rich-text";
import { RunAiButton } from "./run-ai-button";
import { ConsultationStatusWatcher } from "./status-watcher";
import { ConvertToStudentDialog } from "./_components/convert-dialog";
import { ConsultationManageButtons } from "./_components/consultation-manage";

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

const PROCESSING_BADGE: Record<
  ConsultationProcessingStatus,
  { label: string; class: string; spin?: boolean } | null
> = {
  idle: null,
  uploaded: { label: "분석 대기", class: "text-chart-3 bg-chart-3/10 border-chart-3/20" },
  transcribing: { label: "전사 중", class: "text-chart-3 bg-chart-3/10 border-chart-3/20", spin: true },
  analyzing: { label: "AI 분석 중", class: "text-chart-3 bg-chart-3/10 border-chart-3/20", spin: true },
  completed: { label: "완료", class: "text-chart-2 bg-chart-2/10 border-chart-2/20" },
  failed: { label: "실패", class: "text-chart-4 bg-chart-4/10 border-chart-4/20" },
};

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return `${m}분 ${r}초`;
}

export default async function EnrollmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccess("enrollment");
  const { id } = await params;
  const [consult, allClasses] = await Promise.all([
    getEnrollmentConsultationById(id),
    getClassesList({ active: "active" }),
  ]);
  if (!consult) notFound();

  const badge = OUTCOME_BADGE[consult.outcome] ?? OUTCOME_BADGE.pending!;
  const procBadge = PROCESSING_BADGE[consult.processingStatus];
  const isProcessing =
    consult.processingStatus === "uploaded" ||
    consult.processingStatus === "transcribing" ||
    consult.processingStatus === "analyzing";

  return (
    <div className="space-y-6">
      <ConsultationStatusWatcher
        consultationId={consult.id}
        initialStatus={consult.processingStatus}
      />

      <BackLink href="/enrollment" label="등록상담으로" />

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
            {procBadge ? (
              <span
                className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${procBadge.class}`}
              >
                {procBadge.spin ? <Loader2 className="size-3 animate-spin" /> : null}
                {procBadge.label}
              </span>
            ) : null}
          </div>
          <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
            <span>{consult.prospectGrade ?? "—"}</span>
            {consult.prospectSchool ? <span>· {consult.prospectSchool}</span> : null}
            {consult.hasAudio && consult.audioDurationSec ? (
              <span className="inline-flex items-center gap-1">
                · <Mic className="size-3" />
                <span className="num">{formatDuration(consult.audioDurationSec)}</span>
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" render={<Link href={`/enrollment/${id}/edit`} />}>
            <Pencil className="size-4" />
            수정
          </Button>
          <ConsultationManageButtons
            values={{
              id: consult.id,
              prospectName: consult.prospectName,
              prospectGrade: consult.prospectGrade,
              prospectSchool: consult.prospectSchool,
              parentName: consult.parentName,
              parentPhone: consult.parentPhone,
              parentRequest: consult.parentRequest,
              prevAcademy: consult.learningHistory?.prevAcademy ?? null,
              lastScore: consult.learningHistory?.lastScore ?? null,
              outcome: consult.outcome,
            }}
          />
          {consult.aiAnalysis ? (
            <Button variant="outline" render={<Link href={`/enrollment/${id}/print`} target="_blank" />}>
              <Printer className="size-4" />
              인쇄 양식
            </Button>
          ) : !consult.hasAudio ? (
            <RunAiButton consultationId={id} />
          ) : null}
          <ConvertToStudentDialog
            consultationId={consult.id}
            defaults={{
              name: consult.prospectName,
              grade: consult.prospectGrade,
              school: consult.prospectSchool,
              parentName: consult.parentName,
              parentPhone: consult.parentPhone,
            }}
            classes={allClasses.map((c) => ({
              id: c.id,
              className: c.className,
              subject: c.subject,
              teacherName: c.teacherName,
            }))}
            recommendedIds={consult.recommendedClasses.map((r) => r.id)}
            alreadyConverted={!!consult.studentId}
            linkedStudentId={consult.studentId}
          />
        </div>
      </header>

      {consult.processingStatus === "failed" ? (
        <section className="border-chart-4/40 bg-chart-4/5 rounded-lg border p-4">
          <div className="inline-flex items-center gap-2">
            <AlertCircle className="text-chart-4 size-4" />
            <h2 className="text-foreground text-sm font-semibold">처리 실패</h2>
          </div>
          <p className="text-muted-foreground mt-2 text-sm">
            {consult.processingError ?? "알 수 없는 오류"}
          </p>
        </section>
      ) : null}

      {isProcessing ? (
        <section className="bg-card border-border space-y-3 rounded-lg border p-5">
          <div className="inline-flex items-center gap-2">
            <Loader2 className="text-chart-3 size-4 animate-spin" />
            <h2 className="text-foreground text-sm font-semibold">
              {consult.processingStatus === "uploaded" || consult.processingStatus === "transcribing"
                ? "녹음을 한국어로 전사 중입니다"
                : "AI가 상담록을 13개 섹션으로 분석 중입니다"}
            </h2>
          </div>
          <p className="text-muted-foreground text-xs">
            상담 1분당 5–10초 정도 소요됩니다. 페이지를 떠나도 백그라운드에서 계속 진행됩니다.
          </p>
          <div className="space-y-2">
            <div className="bg-muted h-3 w-3/4 animate-pulse rounded" />
            <div className="bg-muted h-3 w-1/2 animate-pulse rounded" />
            <div className="bg-muted h-3 w-2/3 animate-pulse rounded" />
          </div>
        </section>
      ) : null}

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

          <ExtraInfoCard f={consult.fields} />
        </div>

        <div className="space-y-4 lg:col-span-2">
          {consult.audioReport ? (
            <ConsultationReportPanel
              report={consult.audioReport}
              generatedAt={consult.aiAnalysis?.generatedAt ?? null}
            />
          ) : consult.aiAnalysis ? (
            <AiAnalysisPanel
              analysis={consult.aiAnalysis}
              recommendedClasses={consult.recommendedClasses}
            />
          ) : !isProcessing ? (
            <Card title="AI 분석 결과">
              <p className="text-muted-foreground py-12 text-center text-sm">
                아직 AI 분석이 실행되지 않았습니다.
                <br />
                상담 완료 후 분석을 실행하면 학생 진단과 추천 반이 자동 생성됩니다.
              </p>
            </Card>
          ) : null}

          <SubjectScoresCard details={consult.fields.subjectDetails} />

          {consult.transcription || (consult.speakerLabels?.length ?? 0) > 0 ? (
            <TranscriptSection
              utterances={consult.speakerLabels}
              speakerRoles={consult.speakerRoles}
              plainText={consult.transcription}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ConsultationReportPanel({
  report,
  generatedAt,
}: {
  report: ConsultationAudioReport;
  generatedAt: string | null;
}) {
  // emoji=섹션 시각 앵커. list=나열형(불릿). 나머지는 산문 문단(RichText가 쉼표/줄바꿈 처리).
  const sections: { key: keyof ConsultationAudioReport; label: string; emoji: string; list?: boolean }[] = [
    { key: "consultationType", label: "상담 성격", emoji: "🧭" },
    { key: "familyBackground", label: "가정 배경", emoji: "🏠" },
    { key: "parentConcerns", label: "학부모 걱정", emoji: "😟", list: true },
    { key: "parentQuestions", label: "학부모 질문", emoji: "❓", list: true },
    { key: "parentRequests", label: "학부모 요청", emoji: "🙋", list: true },
    { key: "parentSatisfaction", label: "학부모 만족도", emoji: "😊" },
    { key: "studentTraits", label: "학생 특이사항", emoji: "🎒", list: true },
    { key: "teacherResponse", label: "교사 대응", emoji: "🧑‍🏫", list: true },
    { key: "salesPoints", label: "세일즈 포인트", emoji: "💡", list: true },
    { key: "agreements", label: "합의 사항", emoji: "🤝", list: true },
    { key: "followUps", label: "후속 조치", emoji: "📞", list: true },
    { key: "warnings", label: "주의 신호", emoji: "⚠️", list: true },
  ];

  return (
    <section className="space-y-3">
      <header className="flex items-baseline justify-between">
        <div className="inline-flex items-center gap-2">
          <Sparkles className="text-chart-4 size-4" />
          <h2 className="text-foreground text-sm font-semibold">상담 AI 분석</h2>
        </div>
        {generatedAt ? (
          <span className="text-muted-foreground num text-[11px]">
            {formatCreatedAt(generatedAt)}
          </span>
        ) : null}
      </header>

      {/* 섹션마다 이모지 헤더 + 테두리 카드로 또렷이 구분(나열형으로 뭉치지 않게). */}
      {sections.map(({ key, label, emoji, list }) => {
        const body = report[key];
        if (typeof body !== "string" || !body.trim()) return null;
        return (
          <div key={key} className="border-line bg-card overflow-hidden rounded-md border">
            <div className="bg-bg-soft border-line flex items-center gap-2 border-b px-4 py-2">
              <span className="text-[15px] leading-none">{emoji}</span>
              <h3 className="text-foreground text-[13px] font-semibold">{label}</h3>
            </div>
            <div className="px-4 py-3">
              <RichText
                text={body}
                bulletize={list}
                className="text-foreground space-y-1.5 text-sm leading-relaxed"
              />
            </div>
          </div>
        );
      })}
    </section>
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

function ExtraInfoCard({ f }: { f: FullConsultationFields }) {
  const genderLabel = f.gender ? (GENDER_OPTIONS.find((g) => g.value === f.gender)?.label ?? f.gender) : null;
  const rows: [string, string | null][] = [
    ["성별", genderLabel],
    ["생년월일", f.birthDate],
    ["학생 연락처", f.studentPhone],
    ["집 전화", f.homePhone],
    ["보호자 관계", f.parentRelation],
    ["주소", [f.address, f.addressDetail].filter(Boolean).join(" ") || null],
    ["유입 경로", f.consultationPath],
    ["희망 진로", f.careerGoal],
    ["형제관계", f.siblings],
    ["안전사항", f.safetyNotes],
    ["등록 상태", f.registrationStatus],
    ["결제 금액", f.paymentAmount ? `${Number(f.paymentAmount).toLocaleString()}원` : null],
    ["결제일", f.paymentDate],
    ["등록자", f.registrar],
    ["후속 조치일", f.followUpDate],
    ["조치 내용", f.followUpContent],
    ["미등록 사유", f.nonRegistrationReason],
  ];
  const flags = [
    f.shuttleBusRequest ? "셔틀버스" : null,
    f.privacyAgreement ? "개인정보 동의" : null,
    f.installmentAgreement ? "할부 동의" : null,
  ].filter(Boolean) as string[];
  const visible = rows.filter(([, v]) => v);
  if (visible.length === 0 && flags.length === 0) return null;
  return (
    <Card title="학생 상세 정보">
      <dl className="space-y-2.5 text-sm">
        {visible.map(([label, val]) => (
          <Field key={label} label={label} value={val} />
        ))}
      </dl>
      {flags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {flags.map((t) => (
            <span key={t} className="bg-muted text-muted-foreground rounded px-2 py-0.5 text-[11px]">
              {t}
            </span>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

function subjectLabelMap(subjectKey: string): Record<string, string> {
  const map: Record<string, string> = { testType: "테스트 유형" };
  // 공통 필드(학원히스토리·진도·추천반·기타 등)는 모든 과목에서 추출될 수 있어 항상 한글 라벨 포함
  // (영어는 ENGLISH_GROUPS에 공통필드가 없어 raw 키로 떨어지던 것 해소).
  COMMON_FIELDS.fields.forEach((fd) => (map[fd.key] = fd.label));
  const tab = SUBJECT_TABS.find((t) => t.key === subjectKey);
  if (!tab) return map;
  if (tab.english) {
    Object.values(ENGLISH_GROUPS)
      .flat()
      .forEach((g) => g.fields.forEach((fd) => (map[fd.key] = fd.label)));
  } else {
    (tab.groups ?? []).forEach((g) => g.fields.forEach((fd) => (map[fd.key] = fd.label)));
  }
  return map;
}

function SubjectScoresCard({ details }: { details: Record<string, Record<string, string>> | null }) {
  if (!details) return null;
  const entries = Object.entries(details).filter(
    ([, vals]) => vals && Object.values(vals).some((v) => String(v).trim()),
  );
  if (entries.length === 0) return null;
  const ENG_TYPE: Record<string, string> = { ai: "AI 레벨테스트", nelt: "NELT", eie: "EiE" };
  return (
    <Card title="과목별 점수">
      <div className="space-y-4">
        {entries.map(([subj, vals]) => {
          const tab = SUBJECT_TABS.find((t) => t.key === subj);
          const labels = subjectLabelMap(subj);
          const items = Object.entries(vals).filter(([k, v]) => String(v).trim() && k !== "testType");
          return (
            <div key={subj}>
              <p className="text-primary text-xs font-semibold">
                {tab?.label ?? subj}
                {subj === "english" && vals.testType
                  ? ` · ${ENG_TYPE[vals.testType] ?? vals.testType}`
                  : ""}
              </p>
              <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1">
                {items.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground text-xs">{labels[k] ?? k}</dt>
                    <dd className="text-foreground text-right text-xs">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
