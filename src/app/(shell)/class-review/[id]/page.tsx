import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "@/components/icons/eywa-icon-compat";
import { PageHeader } from "@/components/page-header";
import { BigStat } from "@/components/atoms/big-stat";
import { Pill } from "@/components/atoms/pill";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { Button } from "@/components/ui/button";
import { DeleteReviewButton } from "../_components/delete-review-button";
import {
  getClassReview,
  getReviewPrivileges,
  myScoreSlot,
  observerColumns,
  observerLimitOf,
} from "@/features/class-review/server/queries";
import { averageTotals, computeTotals, itemCountOf, normalizeScore } from "@/features/class-review/checklist";

export const metadata = { title: "수업 평가 상세 — eywa" };

/**
 * 참관 상세 — 시트 모양의 문항×평가자 매트릭스 + 영역 소계 + 총점/환산/등급 + 내 채점.
 * 평가자 실명은 **원장·지정 인원만**(원장 지시 2026-08-04) — 그 외는 '평가자 A/B/C'로 익명화.
 * 디자인은 구조·위계 위주(원장 2026-08-05 "색칠 말고") — 스탯은 공용 BigStat, 표는 소프트 패널.
 */
export default async function ClassReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireAccess("class_review");
  const { id } = await params;
  const [found, settings, priv, canDelete] = await Promise.all([
    getClassReview(id),
    getTenantSettings(),
    getReviewPrivileges(viewer),
    // 삭제 버튼 노출 조건 = 서버 액션(deleteClassReview)의 게이트와 **같은 함수** — 화면 조건은 게이트가 아니다(#77).
    canWriteTenant(viewer.systemRole, "class_review"),
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
  // 정원은 문서마다 다르다(생성 시 선택) — 고정 상수로 되돌리면 5명짜리에 빈 칸이 3개만 그려진다.
  const emptyOpenSlots = openMode ? Math.max(0, observerLimitOf(doc) - observerCols.length) : 0;
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

  // 채점이 실제로 들어온 열 수 — 상단 '제출' 스탯과 삭제 확인 문구가 같은 수를 쓴다("몇 명 것이 사라지나").
  const submittedCount = cols.filter((c) => c.totals.answered > 0).length;

  const headerBits = [
    doc.header.subject ? subjects.labelOf(doc.header.subject) : null,
    openMode ? "선착순 3명" : "평가자 지정",
    doc.templateName ?? null,
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
            mine || canDelete ? (
              <span className="flex flex-wrap items-center gap-2">
                {mine ? (
                  <Button render={<Link href={`/class-review/${doc.id}/score`} />}>
                    {mine.submitted ? "내 평가 수정하기" : "평가하기"}
                  </Button>
                ) : null}
                {canDelete ? (
                  <DeleteReviewButton
                    docId={doc.id}
                    teacherName={doc.header.teacherName}
                    date={doc.header.date}
                    submittedCount={submittedCount}
                  />
                ) : null}
              </span>
            ) : undefined
          }
        />
      </div>

      {/* 종합 — 평균 기준 빅 스탯(공용 아톰, 화면 로컬 Stat 금지 규칙) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <BigStat label="제출" value={submittedCount} unit={`/ ${cols.length}`} sub="평가자 + 본인" />
        <BigStat
          label="총점(평균)"
          value={avg ? avg.total : "—"}
          unit={`/ ${itemCountOf(areas) * 4}`}
          sub="제출된 채점 평균"
        />
        <BigStat label="환산점수" value={avg ? avg.percent.toFixed(1) : "—"} unit="/ 100" sub="100점 환산" />
        <BigStat
          label="종합 등급"
          value={avg ? avg.grade : "—"}
          sub={avg?.grade === "재참관" ? "기준 미달 — 재참관 대상" : "등급 컷 기준"}
          valueClass={avg?.grade === "재참관" ? "text-danger" : undefined}
        />
      </div>

      {/* 문항 × 평가자 매트릭스 */}
      <div className="bg-card overflow-x-auto rounded-2xl shadow-card">
        <table className="w-full min-w-[860px] border-collapse text-[13px]">
          <thead>
            <tr className="border-line bg-bg-soft/60 border-b text-left">
              <th className="text-text-dim w-10 px-3 py-2.5 text-xs font-medium">No.</th>
              <th className="text-text-dim px-3 py-2.5 text-xs font-medium">평가항목</th>
              {cols.map((c) => (
                <th key={c.slot} className="w-20 px-2 py-2.5 text-center text-xs font-medium">
                  <span className="text-foreground font-bold">{c.label}</span>
                  {c.totals.answered === 0 ? (
                    <span className="text-text-dim block text-[10px] font-normal">미제출</span>
                  ) : null}
                </th>
              ))}
              <th className="text-text-dim bg-bg-soft/40 w-16 px-2 py-2.5 text-center text-xs font-medium">
                평균
              </th>
            </tr>
          </thead>
          <tbody>
            {areas.map((area, ai) => {
              const base = areas.slice(0, ai).reduce((n, a) => n + a.items.length, 0);
              return [
                <tr key={area.key} className="border-line/60 bg-bg-soft/50 border-y">
                  <td colSpan={cols.length + 3} className="px-3 py-2">
                    <span className="text-foreground text-xs font-bold">{area.title}</span>
                    <span className="text-text-dim ml-2 text-xs">
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
                          className={`num px-2 py-2.5 text-center ${
                            v === 0 ? "text-text-dim/50" : v <= 2 ? "text-danger font-bold" : "font-medium"
                          }`}
                        >
                          {v || "—"}
                        </td>
                      ))}
                      <td className="num bg-bg-soft/40 px-2 py-2.5 text-center font-bold">{rowAvg ?? "—"}</td>
                    </tr>
                  );
                }),
              ];
            })}
          </tbody>
          <tfoot>
            <tr className="border-line bg-bg-soft/60 border-t">
              <td colSpan={2} className="px-3 py-2.5 text-right text-xs font-bold">
                총점 ({itemCountOf(areas) * 4}점)
              </td>
              {cols.map((c) => (
                <td key={c.slot} className="num px-2 py-2.5 text-center font-bold">
                  {c.totals.answered > 0 ? c.totals.total : "—"}
                </td>
              ))}
              <td className="num bg-bg-soft/40 px-2 py-2.5 text-center font-bold">{avg ? avg.total : "—"}</td>
            </tr>
            <tr className="border-line bg-bg-soft/40 border-t">
              <td colSpan={2} className="px-3 py-2.5 text-right text-xs font-bold">
                환산 (100점) · 등급
              </td>
              {cols.map((c) => (
                <td key={c.slot} className="num px-2 py-2.5 text-center">
                  {c.totals.answered > 0 ? (
                    <>
                      <span className="font-bold">{c.totals.percent.toFixed(1)}</span>{" "}
                      <Pill color={c.totals.grade === "재참관" ? "danger" : "primary"} soft>
                        {c.totals.grade}
                      </Pill>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              ))}
              <td className="num bg-bg-soft/40 px-2 py-2.5 text-center">
                {avg ? (
                  <>
                    <span className="font-bold">{avg.percent.toFixed(1)}</span>{" "}
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

      {/* 평가자 코멘트 — 이름 익명화 규칙 동일, 인용 스타일(구조로 구분) */}
      {cols.some((c) => c.sheet?.comment) ? (
        <div className="bg-card rounded-2xl p-5 shadow-card">
          <p className="micro mb-3">평가자 코멘트</p>
          <ul className="space-y-3">
            {cols
              .filter((c) => c.sheet?.comment)
              .map((c) => (
                <li key={c.slot} className="border-line border-l-2 pl-3">
                  <p className="text-foreground text-xs font-bold">{c.label}</p>
                  <p className="mt-0.5 text-sm leading-relaxed whitespace-pre-wrap">{c.sheet!.comment}</p>
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      {/* 채점은 별도 페이지(/score) — 상세는 보기 전용(원장 지시 2026-08-04). */}
      {mine ? (
        <div className="bg-bg-soft/40 flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
          <p className="text-text-dim text-sm">
            {mine.submitted
              ? "내 채점이 저장돼 있습니다 — 필요하면 수정할 수 있습니다."
              : mine.slot === "self"
                ? "본인 평가가 아직 없습니다 — 지금 채점해 주세요."
                : "내 채점이 아직 없습니다 — 수업 내용을 채점해 주세요."}
          </p>
          <Button render={<Link href={`/class-review/${doc.id}/score`} />}>
            {mine.submitted ? "내 평가 수정하기" : "평가하기"}
          </Button>
        </div>
      ) : (
        <p className="text-text-dim text-xs">
          {openMode
            ? "선착순 평가자 3명이 이미 채점을 마쳐 열람만 가능합니다."
            : "이 평가 건의 평가자로 지정되어 있지 않아 채점은 열람만 가능합니다."}
        </p>
      )}
    </div>
  );
}
