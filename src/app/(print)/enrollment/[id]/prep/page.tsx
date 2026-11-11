import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { requireAccess } from "@/lib/auth/require-access";
import { isFeatureLicensed } from "@/lib/license/server";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getEnrollmentConsultationById } from "@/features/enrollment/server/queries";
import { PrintActions } from "../print/print-actions";

export const metadata = { title: "상담 준비 브리프 — 에이와" };

/**
 * 상담 준비 브리프 A4 — 상담자가 **상담 전에 손에 들고 들어가는** 종이.
 *
 * ⚠️ 학부모 전달용이 아니다(인수인계서와 다르다) — 대응 화법·주의사항·잔여석 같은 내부 정보가 실린다.
 *    머리말에 '내부용'을 못박고, 학부모 연락처·주소는 애초에 스냅샷에 없다.
 * ⚠️ 내용은 전부 생성 시점 스냅샷 — 지금 DB를 다시 읽지 않는다(그때 자료로 상담했음이 재현돼야 함).
 */
export default async function EnrollmentPrepPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await requireAccess("enrollment");
  const { id } = await params;
  const embedded = (await headers()).get("x-embed") === "1";
  const [consult, settings, aiOn] = await Promise.all([
    getEnrollmentConsultationById(id),
    getTenantSettings(),
    // AI 라이선스가 꺼진 지점엔 브리프가 없다(꺼지면 흔적 없이 · 적대 리뷰 2026-11-11 — 인쇄 주소로 직접 열 수 있었다).
    isFeatureLicensed(viewer.tenantId, "ai_analysis"),
  ]);
  if (!aiOn || !consult?.prepBrief) notFound();

  const record = consult.prepBrief;
  const b = record.brief;
  const f = record.facts;
  const printHeader = settings.notifications.printHeader || "에이와";
  const generated = new Date(record.generatedAt).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "long",
    timeStyle: "short",
  });

  return (
    <div className="print-portrait mx-auto max-w-[210mm] bg-white px-12 py-10 text-black print:p-0">
      <PrintActions embedded={embedded} />

      <header className="border-b-2 border-black/80 pb-4">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[11px] tracking-[0.25em] uppercase">{printHeader}</p>
          <p className="font-mono text-[10px] text-black/60">#{consult.id.slice(0, 8).toUpperCase()}</p>
        </div>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight">상담 준비 브리프</h1>
        <p className="mt-1 text-sm text-black/70">
          상담자 내부용 · 학부모에게 전달하지 마세요 · <span className="num">{generated}</span> 기준 학원 데이터
        </p>
      </header>

      <section className="mt-6 grid grid-cols-2 gap-x-12 gap-y-2 text-sm">
        <Row label="학생명" value={f.student.name} bold />
        <Row label="학년 · 학교" value={`${f.student.grade ?? "—"} · ${f.student.school ?? "—"}`} />
        <Row label="상담 과목" value={f.student.subjectLabel ?? "—"} />
        <Row
          label="학부모"
          value={f.parent.name ? `${f.parent.name}${f.parent.relation ? ` (${f.parent.relation})` : ""}` : "—"}
        />
        <Row label="유입 경로" value={f.student.consultationPath ?? "—"} />
        <Row label="셔틀 희망" value={f.student.shuttleRequest ? "예" : "아니오"} />
      </section>

      <p className="mt-5 border-l-4 border-black/70 pl-3 text-base font-bold">{b.headline}</p>
      {record.source === "fallback" ? (
        <p className="mt-1 text-[11px] text-black/60">
          ※ 접수 정보만으로 정리한 기본 브리프입니다(대응 화법은 상담자가 직접 판단하세요).
        </p>
      ) : null}

      <Section title="오프닝 멘트">
        <p className="text-sm leading-relaxed whitespace-pre-line">{b.opening}</p>
      </Section>

      {b.questions.length > 0 ? (
        <Section title="반드시 확인할 질문">
          <ul className="space-y-1.5 text-sm">
            {b.questions.map((q) => (
              <li key={q} className="flex items-start gap-2">
                {/* 상담 중 손으로 체크하며 쓰는 종이라 빈 네모를 둔다. */}
                <span className="mt-[3px] inline-block size-3 shrink-0 border border-black/50" />
                <span className="leading-relaxed">{q}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {b.playbook.length > 0 ? (
        <Section title="걱정 → 대응 화법">
          <div className="space-y-3 text-sm">
            {b.playbook.map((p) => (
              <div key={p.concern} className="border border-black/20 p-3">
                <p className="font-bold">{p.concern}</p>
                <p className="mt-0.5 text-[11px] text-black/60">근거: {p.evidence}</p>
                <p className="mt-1.5 leading-relaxed">{p.response}</p>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {/* 학원 설정에 적힌 운영 안내 원문(스냅샷 · 화면 본문과 같은 값 · 2026-11-12). 옛 브리프엔 없다. */}
      {f.policy.operations && f.policy.operations.length > 0 ? (
        <Section title="학원 운영 안내 (브리프 작성 때의 학원 설정 원문)">
          <dl className="space-y-1.5 text-sm">
            {f.policy.operations.map((o) => (
              <div key={o.label} className="grid grid-cols-[9rem_1fr] gap-3">
                <dt className="font-bold">{o.label}</dt>
                <dd className="leading-relaxed whitespace-pre-line">{o.text}</dd>
              </div>
            ))}
          </dl>
        </Section>
      ) : null}

      <Section title="반 제안 (현재 개설 반)">
        {b.proposal ? <p className="mb-2 text-sm leading-relaxed whitespace-pre-line">{b.proposal}</p> : null}
        {f.classes.length > 0 ? (
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-black/40 text-left">
                <th className="py-1 pr-2 font-semibold">반</th>
                <th className="py-1 pr-2 font-semibold">강사</th>
                <th className="py-1 pr-2 font-semibold">시간</th>
                <th className="py-1 font-semibold">현원</th>
              </tr>
            </thead>
            <tbody>
              {/* 정원·잔여석은 싣지 않는다 — 강의실 수용 인원이라 반 정원이 아니다(검수 2026-11-11 · 옛 스냅숏도 현원만). */}
              {f.classes.map((c) => (
                <tr key={c.id} className="border-b border-black/10">
                  <td className="py-1 pr-2">{c.className}</td>
                  <td className="py-1 pr-2">{c.teacherName ?? "—"}</td>
                  <td className="py-1 pr-2">{c.scheduleLabel ?? "—"}</td>
                  <td className="num py-1">{`${c.enrolled}명`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm">조건에 맞는 개설 반이 없습니다 — 시간표를 먼저 확인하세요.</p>
        )}
      </Section>

      {f.tuition.length > 0 ? (
        <Section title="수강료 (단가표 그대로 안내 · 임의 할인 금지)">
          <ul className="space-y-1 text-[12px]">
            {f.tuition.map((t) => (
              <li key={`${t.category}-${t.name}`} className="flex justify-between gap-4">
                <span>
                  {t.category} {t.name}
                </span>
                {/* ⚠️ 회당/월 구분 필수 — 회당 단가를 월 수강료로 오안내하면 상담 자리에서 바로 사고. */}
                <span className="num shrink-0 font-semibold">
                  {t.modeLabel ? `${t.modeLabel} ` : ""}
                  {t.price.toLocaleString("ko-KR")}원
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[10px] text-black/60">
            회당 단가는 월 수강료가 아닙니다(회당 × 주당 횟수 × 해당 월 수업 주수). 월 금액 확답은 회차 확정 후에.
          </p>
        </Section>
      ) : null}

      {b.objections.length > 0 ? (
        <Section title="예상 반론과 답변">
          <div className="space-y-2 text-sm">
            {b.objections.map((o) => (
              <div key={o.objection}>
                <p className="font-bold">“{o.objection}”</p>
                <p className="leading-relaxed">→ {o.answer}</p>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="클로징 · 다음 단계">
        <p className="text-sm leading-relaxed whitespace-pre-line">{b.closing}</p>
      </Section>

      {b.cautions.length > 0 ? (
        <Section title="주의">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {b.cautions.map((c) => (
              <li key={c} className="leading-relaxed">
                {c}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {f.checklist.length > 0 ? (
        <Section title="학부모 접수 폼 응답 (원문)">
          <dl className="space-y-1 text-[12px]">
            {f.checklist.map((row) => (
              <div key={row.question} className="grid grid-cols-[9rem_1fr] gap-2">
                <dt className="text-black/60">{row.question}</dt>
                <dd className="leading-relaxed">{row.answer}</dd>
              </div>
            ))}
          </dl>
          {f.habits.length > 0 ? (
            <p className="mt-2 text-[12px]">
              학습 행동(1~5점): {f.habits.map((h) => `${h.label} ${h.score}`).join(" · ")}
            </p>
          ) : null}
        </Section>
      ) : null}

      <Section title="상담 메모">
        <div className="border border-black/30">
          <div className="h-8 border-b border-dashed border-black/15" />
          <div className="h-8 border-b border-dashed border-black/15" />
          <div className="h-8 border-b border-dashed border-black/15" />
          <div className="h-8" />
        </div>
      </Section>

      <footer className="mt-8 border-t border-black/20 pt-3 text-[10px] text-black/60">
        <p>
          {f.policy.academyName} · 전체 재원생 {f.peers.total}명
          {f.student.school && f.peers.sameSchool > 0 ? ` · ${f.student.school} 재원 ${f.peers.sameSchool}명` : ""}
          {f.siblings.length > 0 ? ` · 형제 재원 추정: ${f.siblings.map((s) => s.name).join(", ")}` : ""}
        </p>
        <p className="mt-1">
          이 문서는 상담 준비용 내부 자료입니다. 기재된 반·현원·금액은 생성 시점 기준이며 자리는 상담에서 확인합니다. 상담 전 최신 시간표로 다시 확인하세요.
        </p>
      </footer>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex gap-3">
      <span className="w-20 shrink-0 text-black/55">{label}</span>
      <span className={bold ? "font-bold" : ""}>{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 break-inside-avoid">
      <h2 className="mb-2 border-b border-black/20 pb-1 text-xs font-bold tracking-wide uppercase">{title}</h2>
      {children}
    </section>
  );
}
