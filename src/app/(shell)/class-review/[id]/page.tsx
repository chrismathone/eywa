import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "@/components/icons/eywa-icon-compat";
import { PageHeader } from "@/components/page-header";
import { Pill } from "@/components/atoms/pill";
import { requireAccess } from "@/lib/auth/require-access";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { getClassReview } from "@/features/class-review/server/queries";
import { averageTotals, CHECKLIST_AREAS, computeTotals, normalizeScore } from "@/features/class-review/checklist";
import { ScorePanel } from "../_components/score-panel";

export const metadata = { title: "수업 평가 상세 — eywa" };

/** 참관 상세 — 시트 모양의 문항×평가자 매트릭스 + 영역 소계 + 총점/환산/등급 + 내 채점. */
export default async function ClassReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireAccess("class_review");
  const { id } = await params;
  const [doc, settings] = await Promise.all([getClassReview(id), getTenantSettings()]);
  if (!doc) notFound();
  const subjects = buildSubjectMaps(settings.operations.subjects);

  // 열 = 지정 평가자 순서(관찰자 A/B/C → 본인). 슬롯 키: 관찰자=userId, 본인='self'.
  const cols = doc.evaluators.map((e) => {
    const slot = e.kind === "self" ? "self" : (e.id ?? e.name);
    const sheet = doc.submissions[slot] ?? null;
    return { ...e, slot, sheet, totals: computeTotals(sheet) };
  });
  const avg = averageTotals(cols.map((c) => c.sheet ?? { scores: [] }));
  const mine = doc.evaluators.find((e) => e.id === viewer.id);
  const mySlot = mine ? (mine.kind === "self" ? "self" : viewer.id) : null;
  const myScores = mySlot ? (doc.submissions[mySlot]?.scores ?? []) : [];
  const myComment = mySlot ? (doc.submissions[mySlot]?.comment ?? "") : "";

  const headerBits = [
    doc.header.subject ? subjects.labelOf(doc.header.subject) : null,
    doc.header.className || null,
    doc.header.session ? `${doc.header.session}회차` : null,
    doc.header.classTime || null,
    doc.header.studentCount ? `학생 ${doc.header.studentCount}명` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-5 p-6">
      <div>
        <Link
          href="/class-review"
          className="text-text-dim hover:text-primary mb-2 inline-flex items-center gap-1 text-xs font-medium transition"
        >
          <ArrowLeft className="size-3.5" /> 목록으로
        </Link>
        <PageHeader
          eyebrow="수업 평가"
          title={`${doc.header.teacherName} · ${doc.header.date}`}
          description={headerBits.join(" · ") || "참관 정보"}
          embedLabel={`수업 평가 — ${doc.header.teacherName}`}
        />
      </div>

      {/* 종합 — 평균 기준 빅스탯 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "제출", value: `${cols.filter((c) => c.totals.answered > 0).length}/${cols.length}` },
          { label: "총점(평균)", value: avg ? `${avg.total}` : "—", sub: "/ 120" },
          { label: "환산점수", value: avg ? avg.percent.toFixed(1) : "—", sub: "/ 100" },
          { label: "종합 등급", value: avg ? avg.grade : "—" },
        ].map((s) => (
          <div key={s.label} className="border-line bg-card rounded-2xl border p-4 shadow-card">
            <p className="micro">{s.label}</p>
            <p className="num text-foreground mt-1 text-2xl font-bold">
              {s.value}
              {s.sub ? <span className="text-text-faint ml-1 text-xs font-normal">{s.sub}</span> : null}
            </p>
          </div>
        ))}
      </div>

      {/* 문항 × 평가자 매트릭스 */}
      <div className="border-line bg-card overflow-x-auto rounded-2xl border shadow-card">
        <table className="w-full min-w-[860px] border-collapse text-[13px]">
          <thead>
            <tr className="border-line bg-bg-soft/60 border-b text-left">
              <th className="w-10 px-3 py-2 font-semibold">No.</th>
              <th className="px-3 py-2 font-semibold">평가항목</th>
              {cols.map((c) => (
                <th key={c.slot} className="w-20 px-2 py-2 text-center font-semibold">
                  {c.kind === "self" ? "본인" : c.name}
                  {c.totals.answered === 0 ? <span className="text-text-faint block text-[10px] font-normal">미제출</span> : null}
                </th>
              ))}
              <th className="w-16 px-2 py-2 text-center font-semibold">평균</th>
            </tr>
          </thead>
          <tbody>
            {CHECKLIST_AREAS.map((area, ai) => {
              const base = CHECKLIST_AREAS.slice(0, ai).reduce((n, a) => n + a.items.length, 0);
              return [
                <tr key={area.key} className="bg-primary/5">
                  <td colSpan={cols.length + 3} className="text-primary px-3 py-1.5 text-xs font-bold">
                    {area.title}
                    <span className="text-text-dim ml-2 font-normal">
                      소계 {cols.map((c) => c.totals.areaSubtotals[ai]).join(" · ")}
                      {avg ? ` · 평균 ${avg.areaSubtotals[ai]}` : ""}
                    </span>
                  </td>
                </tr>,
                ...area.items.map((item, i) => {
                  const qi = base + i;
                  const rowVals = cols.map((c) => normalizeScore(c.sheet?.scores?.[qi]));
                  const done = rowVals.filter((v) => v > 0);
                  const rowAvg = done.length ? Math.round((done.reduce((a, b) => a + b, 0) / done.length) * 10) / 10 : null;
                  return (
                    <tr key={`${area.key}-${i}`} className="border-line/50 border-b last:border-0">
                      <td className="num text-text-dim px-3 py-1.5">{qi + 1}</td>
                      <td className="px-3 py-1.5 break-keep">{item}</td>
                      {rowVals.map((v, ci) => (
                        <td key={ci} className={`num px-2 py-1.5 text-center font-semibold ${v === 0 ? "text-text-faint" : v <= 2 ? "text-danger" : ""}`}>
                          {v || "—"}
                        </td>
                      ))}
                      <td className="num text-text-dim px-2 py-1.5 text-center">{rowAvg ?? "—"}</td>
                    </tr>
                  );
                }),
              ];
            })}
          </tbody>
          <tfoot>
            <tr className="border-line bg-bg-soft/60 border-t font-bold">
              <td colSpan={2} className="px-3 py-2 text-right">
                총점 (120점)
              </td>
              {cols.map((c) => (
                <td key={c.slot} className="num px-2 py-2 text-center">
                  {c.totals.answered > 0 ? c.totals.total : "—"}
                </td>
              ))}
              <td className="num px-2 py-2 text-center">{avg ? avg.total : "—"}</td>
            </tr>
            <tr className="border-line bg-bg-soft/40 border-t">
              <td colSpan={2} className="px-3 py-2 text-right font-semibold">
                환산 (100점) · 등급
              </td>
              {cols.map((c) => (
                <td key={c.slot} className="num px-2 py-2 text-center">
                  {c.totals.answered > 0 ? (
                    <>
                      {c.totals.percent.toFixed(1)}{" "}
                      <Pill color={c.totals.grade === "재참관" ? "danger" : "primary"} soft>
                        {c.totals.grade}
                      </Pill>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              ))}
              <td className="num px-2 py-2 text-center">
                {avg ? (
                  <>
                    {avg.percent.toFixed(1)}{" "}
                    <Pill color={avg.grade === "재참관" ? "danger" : "primary"} soft>
                      {avg.grade}
                    </Pill>
                  </>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* 참관자 코멘트 */}
      {cols.some((c) => c.sheet?.comment) ? (
        <div className="border-line bg-card rounded-2xl border p-5 shadow-card">
          <p className="micro mb-2">참관자 코멘트</p>
          <ul className="space-y-2">
            {cols
              .filter((c) => c.sheet?.comment)
              .map((c) => (
                <li key={c.slot} className="text-sm">
                  <span className="text-text-dim font-medium">{c.kind === "self" ? "본인" : c.name}:</span>{" "}
                  <span className="whitespace-pre-wrap">{c.sheet!.comment}</span>
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      {/* 내 채점 — 평가자로 지정된 경우에만 */}
      {mySlot ? (
        <ScorePanel docId={doc.id} initialScores={myScores} initialComment={myComment} />
      ) : (
        <p className="text-text-faint text-xs">이 참관 건의 평가자로 지정되어 있지 않아 채점은 열람만 가능합니다.</p>
      )}
    </div>
  );
}
