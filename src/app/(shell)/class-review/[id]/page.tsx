import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "@/components/icons/eywa-icon-compat";
import { PageHeader } from "@/components/page-header";
import { Pill } from "@/components/atoms/pill";
import { requireAccess } from "@/lib/auth/require-access";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { Button } from "@/components/ui/button";
import {
  getClassReview,
  getReviewPrivileges,
  myScoreSlot,
  observerColumns,
  OPEN_MODE_OBSERVER_LIMIT,
} from "@/features/class-review/server/queries";
import { averageTotals, computeTotals, itemCountOf, normalizeScore } from "@/features/class-review/checklist";

export const metadata = { title: "수업 평가 상세 — eywa" };

/**
 * 참관 상세 — 시트 모양의 문항×평가자 매트릭스 + 영역 소계 + 총점/환산/등급 + 내 채점.
 * 평가자 실명은 **원장·지정 인원만**(원장 지시 2026-08-04) — 그 외는 '평가자 A/B/C'로 익명화.
 */
export default async function ClassReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireAccess("class_review");
  const { id } = await params;
  const [found, settings, priv] = await Promise.all([
    getClassReview(id),
    getTenantSettings(),
    getReviewPrivileges(viewer),
  ]);
  if (!found) notFound();
  const { doc, areas } = found;
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const openMode = doc.header.observerMode === "open";

  // 열 = 관찰자들(지정 순서 또는 선착순 제출 순서) + 본인. 익명화 시 관찰자 이름 → 평가자 A/B/C.
  const anon = (i: number) => `평가자 ${String.fromCharCode(65 + i)}`;
  const observerCols = observerColumns(doc).map((c, i) => ({
    slot: c.slot,
    label: priv.seeNames ? c.name : anon(i),
  }));
  // 선착순 모드: 아직 안 찬 슬롯을 빈 열로 보여준다(자리가 남았음이 보이게).
  const emptyOpenSlots = openMode
    ? Math.max(0, OPEN_MODE_OBSERVER_LIMIT - observerCols.length)
    : 0;
  const cols = [
    ...observerCols,
    ...Array.from({ length: emptyOpenSlots }, (_, i) => ({
      slot: `__empty${i}`,
      label: anon(observerCols.length + i),
    })),
    { slot: "self", label: "본인" },
  ].map((c) => {
    const sheet = c.slot.startsWith("__empty") ? null : (doc.submissions[c.slot] ?? null);
    return { ...c, sheet, totals: computeTotals(sheet, areas) };
  });
  const avg = averageTotals(
    cols.filter((c) => !c.slot.startsWith("__empty")).map((c) => c.sheet ?? { scores: [] }),
    areas,
  );

  // 내 채점 자격(공용 헬퍼) — 있으면 헤더에 평가하기/수정하기 버튼(채점은 별도 페이지, 원장 지시 2026-08-04).
  const mine = myScoreSlot(doc, viewer.id);

  const headerBits = [
    doc.header.subject ? subjects.labelOf(doc.header.subject) : null,
    openMode ? "선착순 3명" : "평가자 지정",
  ].filter(Boolean);

  return (
    // 폭 1000px 중앙 고정(원장 2026-08-04 — 넓은 창에서 좌측에 쏠려 휑함), 좁은 창은 그대로 반응형 축소.
    <div className="mx-auto w-full max-w-[1000px] space-y-5 p-6">
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
          description={headerBits.join(" · ")}
          embedLabel={`수업 평가 — ${doc.header.teacherName}`}
          actions={
            mine ? (
              <Button render={<Link href={`/class-review/${doc.id}/score`} />}>
                {mine.submitted ? "내 평가 수정하기" : "평가하기"}
              </Button>
            ) : undefined
          }
        />
      </div>

      {/* 종합 — 평균 기준 빅스탯 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          {
            label: "제출",
            value: `${cols.filter((c) => c.totals.answered > 0).length}/${cols.length}`,
          },
          { label: "총점(평균)", value: avg ? `${avg.total}` : "—", sub: `/ ${itemCountOf(areas) * 4}` },
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
              <th className="w-10 px-3 py-2.5 font-semibold">No.</th>
              <th className="px-3 py-2.5 font-semibold">평가항목</th>
              {cols.map((c) => (
                <th key={c.slot} className="w-20 px-2 py-2.5 text-center font-semibold">
                  {c.label}
                  {c.totals.answered === 0 ? (
                    <span className="text-text-faint block text-[10px] font-normal">미제출</span>
                  ) : null}
                </th>
              ))}
              <th className="w-16 px-2 py-2.5 text-center font-semibold">평균</th>
            </tr>
          </thead>
          <tbody>
            {areas.map((area, ai) => {
              const base = areas.slice(0, ai).reduce((n, a) => n + a.items.length, 0);
              return [
                <tr key={area.key} className="bg-primary/5">
                  <td colSpan={cols.length + 3} className="text-primary px-3 py-2 text-xs font-bold">
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
                  const rowAvg = done.length
                    ? Math.round((done.reduce((a, b) => a + b, 0) / done.length) * 10) / 10
                    : null;
                  return (
                    <tr key={`${area.key}-${i}`} className="border-line/50 border-b last:border-0">
                      <td className="num text-text-dim px-3 py-2.5">{qi + 1}</td>
                      <td className="px-3 py-2.5 leading-relaxed break-keep">{item}</td>
                      {rowVals.map((v, ci) => (
                        <td
                          key={ci}
                          className={`num px-2 py-2.5 text-center font-semibold ${v === 0 ? "text-text-faint" : v <= 2 ? "text-danger" : ""}`}
                        >
                          {v || "—"}
                        </td>
                      ))}
                      <td className="num text-text-dim px-2 py-2.5 text-center">{rowAvg ?? "—"}</td>
                    </tr>
                  );
                }),
              ];
            })}
          </tbody>
          <tfoot>
            <tr className="border-line bg-bg-soft/60 border-t font-bold">
              <td colSpan={2} className="px-3 py-2 text-right">
                총점 ({itemCountOf(areas) * 4}점)
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

      {/* 평가자 코멘트 — 이름 익명화 규칙 동일 */}
      {cols.some((c) => c.sheet?.comment) ? (
        <div className="border-line bg-card rounded-2xl border p-5 shadow-card">
          <p className="micro mb-2">평가자 코멘트</p>
          <ul className="space-y-2">
            {cols
              .filter((c) => c.sheet?.comment)
              .map((c) => (
                <li key={c.slot} className="text-sm">
                  <span className="text-text-dim font-medium">{c.label}:</span>{" "}
                  <span className="whitespace-pre-wrap">{c.sheet!.comment}</span>
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      {/* 채점은 별도 페이지(/score) — 상세는 보기 전용(원장 지시 2026-08-04). */}
      {mine ? (
        <div className="border-line bg-bg-soft/40 flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4">
          <p className="text-text-dim text-sm">
            {mine.submitted
              ? "내 채점이 저장돼 있습니다 — 필요하면 수정할 수 있습니다."
              : mine.slot === "self"
                ? "본인 평가가 아직 없습니다 — 지금 채점해 주세요."
                : "내 채점이 아직 없습니다 — 참관 내용을 채점해 주세요."}
          </p>
          <Button render={<Link href={`/class-review/${doc.id}/score`} />}>
            {mine.submitted ? "내 평가 수정하기" : "평가하기"}
          </Button>
        </div>
      ) : (
        <p className="text-text-faint text-xs">
          {openMode
            ? "선착순 평가자 3명이 이미 채점을 마쳐 열람만 가능합니다."
            : "이 참관 건의 평가자로 지정되어 있지 않아 채점은 열람만 가능합니다."}
        </p>
      )}
    </div>
  );
}
