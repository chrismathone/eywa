import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { getTenantSettings } from "@/features/owner/server/queries";
import {
  getEnrollmentConsultationById,
  type ConsultationAudioReport,
} from "@/features/enrollment/server/queries";
import { RichText } from "@/components/rich-text";
import { PrintActions } from "./print-actions";

export const metadata = { title: "신입생 인수인계서 — eywa" };

// 과목 라벨은 print_payload 스냅샷에 이미 한글로 동결돼 있어 별도 맵이 필요 없다(과목 하드코딩 금지).
// 향후 라벨이 필요하면 buildSubjectMaps(getTenantSettings).labelOf로 읽을 것.

export default async function EnrollmentPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccess("enrollment");
  const { id } = await params;
  const [consult, settings] = await Promise.all([
    getEnrollmentConsultationById(id),
    getTenantSettings(),
  ]);
  if (!consult || !consult.aiAnalysis) notFound();
  const printHeader = settings.notifications.printHeader || "eywa · 인재원 학원관리";

  // 학원 연락처·정책 — owner 설정에서(값 있을 때만 인쇄물에 노출). 인수인계서는 학부모 전달용 1부 포함.
  const profile = settings.profile;
  const academyName = profile.name || "인재원";
  const contactLine = [
    profile.representativeName ? `대표 ${profile.representativeName}` : "",
    profile.phone,
    profile.email,
  ]
    .filter(Boolean)
    .join(" · ");
  const latePolicy = settings.billing.latePolicy?.trim();

  const p = consult.aiAnalysis.printPayload;
  const consultedDate = new Date(p.consultedAt).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="print-portrait mx-auto max-w-[210mm] bg-white px-12 py-10 text-black print:p-0">
      <PrintActions />

      <header className="border-b-2 border-black/80 pb-4">
        {profile.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- 인쇄물 외부 이미지(최적화 불필요)
          <img src={profile.logoUrl} alt={academyName} className="mb-3 h-12 w-auto object-contain" />
        ) : null}
        <div className="flex items-center justify-between">
          <p className="font-mono text-[11px] tracking-[0.25em] uppercase">
            {printHeader}
          </p>
          <p className="font-mono text-[10px] text-black/60">
            #{consult.id.slice(0, 8).toUpperCase()}
          </p>
        </div>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight">신입생 인수인계서</h1>
        <p className="mt-1 text-sm text-black/70">
          첫 수업 전 담임에게 전달 · 보관용 1부 · 학부모 전달용 1부
        </p>
      </header>

      <section className="mt-6 grid grid-cols-2 gap-x-12 gap-y-2 text-sm">
        <Row label="학생명" value={p.prospect.name} bold />
        <Row label="학년 · 학교" value={`${p.prospect.grade ?? "—"} · ${p.prospect.school ?? "—"}`} />
        <Row
          label="학부모"
          value={`${p.prospect.parentName ?? "—"} (${p.prospect.parentPhone ?? "—"})`}
        />
        <Row label="상담일" value={consultedDate} />
        <Row label="상담사" value={p.consultantName ?? "—"} />
        <Row label="종합 수준" value={p.diagnosis.level} bold />
      </section>

      <hr className="my-6 border-black/20" />

      <Section title="학부모 요구사항">
        <p className="text-sm leading-relaxed">{p.parentRequest ?? "—"}</p>
      </Section>

      {p.learningHistory ? (
        <Section title="학습 이력">
          <dl className="space-y-1.5 text-sm">
            {p.learningHistory.prevAcademy ? (
              <Detail label="이전 학원" value={p.learningHistory.prevAcademy} />
            ) : null}
            {p.learningHistory.lastScore ? (
              <Detail label="최근 성적" value={p.learningHistory.lastScore} />
            ) : null}
            {p.learningHistory.weakSubjects?.length ? (
              <Detail label="약점 단원" value={p.learningHistory.weakSubjects.join(", ")} />
            ) : null}
          </dl>
        </Section>
      ) : null}

      {(p as unknown as { audioReport?: ConsultationAudioReport }).audioReport ? (
        <AudioReportSections
          report={
            (p as unknown as { audioReport: ConsultationAudioReport }).audioReport
          }
        />
      ) : (
        <>
          <Section title="AI 진단 요약">
            <p className="text-sm leading-relaxed">{p.diagnosis.summary}</p>
            <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
              <div>
                <p className="text-xs font-semibold tracking-wide uppercase">강점</p>
                <ul className="mt-1 list-disc pl-5">
                  {p.diagnosis.strengths.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold tracking-wide uppercase">약점</p>
                <ul className="mt-1 list-disc pl-5">
                  {p.diagnosis.weaknesses.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            </div>
          </Section>

          <Section title="학습 계획">
            <div className="grid grid-cols-3 gap-x-6 text-sm">
              <Plan label="즉시 (4주)" items={p.learningPlan.immediate} />
              <Plan label="이번 학기" items={p.learningPlan.semester} />
              <Plan label="장기" items={p.learningPlan.longTerm} />
            </div>
          </Section>
        </>
      )}

      {p.recommendedClasses.length > 0 ? (
        <Section title="추천 반">
          <ul className="space-y-1 text-sm">
            {p.recommendedClasses.map((c) => (
              <li key={c} className="flex items-center gap-2">
                <span className="text-black/40">▸</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="담임 메모">
        <div className="border border-black/30">
          <div className="h-8 border-b border-dashed border-black/15" />
          <div className="h-8 border-b border-dashed border-black/15" />
          <div className="h-8 border-b border-dashed border-black/15" />
          <div className="h-8" />
        </div>
      </Section>

      {latePolicy ? (
        <Section title="수납 정책 안내">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{latePolicy}</p>
        </Section>
      ) : null}

      <footer className="mt-10 flex items-end justify-between gap-6 border-t border-black/20 pt-4 text-[10px] text-black/60">
        <div className="flex items-end gap-4">
          {profile.sealUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- 인쇄물 외부 이미지(최적화 불필요)
            <img src={profile.sealUrl} alt="직인" className="size-16 shrink-0 object-contain" />
          ) : null}
          <div className="space-y-0.5">
            <p className="font-semibold text-black/80">
              {academyName}
              {profile.branchLabel ? ` · ${profile.branchLabel}` : ""}
            </p>
            {contactLine ? <p>{contactLine}</p> : null}
            {profile.address ? <p>{profile.address}</p> : null}
            {profile.bizRegNo ? <p>사업자등록번호 {profile.bizRegNo}</p> : null}
          </div>
        </div>
        <p className="shrink-0 text-right font-mono">
          MODEL {consult.aiAnalysis.modelVersion} · GENERATED{" "}
          {new Date(consult.aiAnalysis.generatedAt).toLocaleDateString("ko-KR")}
        </p>
      </footer>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="w-20 shrink-0 text-xs font-semibold tracking-wide text-black/60 uppercase">
        {label}
      </dt>
      <dd className={`text-sm ${bold ? "font-bold" : ""}`}>{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 break-inside-avoid">
      <h2 className="text-xs font-bold tracking-[0.15em] uppercase">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-black/60">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function AudioReportSections({ report }: { report: ConsultationAudioReport }) {
  // list=나열형 섹션 → 불릿. 웹 상세(enrollment/[id]/page.tsx)와 동일 분류로 인쇄도 같은 형식.
  const sections: { key: keyof ConsultationAudioReport; label: string; list?: boolean }[] = [
    { key: "consultationType", label: "상담 성격" },
    { key: "familyBackground", label: "가정 배경" },
    { key: "parentConcerns", label: "학부모 걱정", list: true },
    { key: "parentQuestions", label: "학부모 질문", list: true },
    { key: "parentRequests", label: "학부모 요청", list: true },
    { key: "parentSatisfaction", label: "학부모 만족도" },
    { key: "studentTraits", label: "학생 특이사항", list: true },
    { key: "teacherResponse", label: "교사 대응", list: true },
    { key: "salesPoints", label: "세일즈 포인트", list: true },
    { key: "agreements", label: "합의 사항", list: true },
    { key: "followUps", label: "후속 조치", list: true },
    { key: "warnings", label: "주의 신호", list: true },
  ];
  return (
    <>
      {sections.map(({ key, label, list }) => {
        const body = report[key];
        if (typeof body !== "string" || !body.trim()) return null;
        return (
          <Section key={key} title={label}>
            <RichText text={body} bulletize={list} className="space-y-1 text-sm leading-relaxed" />
          </Section>
        );
      })}
    </>
  );
}

function Plan({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="text-xs font-semibold tracking-wide uppercase">{label}</p>
      <ul className="mt-1 list-disc pl-5">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}
