"use client";

/**
 * **계획 비교** 칩 + 모달 — 교시 한 칸의 **원래 월간계획 ↔ 실제**(원장 2026-09-28 *"주간, 달력에서 해당
 * 수업의 진도와 원래 월간계획을 바로 비교할 수 있는 기능 … 모달로 보여주던지 마우스 호버할때 보여주던지"*).
 *
 * 🔑 **모달을 골랐다** — 호버는 터치(태블릿·폰)에선 없는 것과 같고, 두 목록을 나란히 읽기엔 좁다.
 *    대신 달력에선 칩 자체에 판정(계획대로·N차수 늦음…)을 적어 **열지 않아도** 한눈에 보이게 한다.
 *    주간 시트는 열 때 읽는다 — 매일 여는 화면의 첫 페인트에 교재 조회를 얹지 않는다(B7).
 * 🔑 판정·색은 [`plan-compare.ts`](@/features/textbooks/plan-compare.ts) 단일 소스(현황 페이지와 같은 답).
 */
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TONE_SOFT } from "@/lib/design/semantic-color";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import type { SheetDictKey } from "@/features/teacher-view/i18n";
import { VERDICT_TONE, type CellCompare, type CellVerdict, type LineVerdict } from "@/features/textbooks/plan-compare";
import type { SlotCompareResult } from "@/features/textbooks/server/compare-actions";

type VerdictLike = Pick<CellCompare, "verdict" | "lag">;

/** 판정 → 짧은 문구(칩·모달 머리). */
export function useVerdictLabel(): (c: VerdictLike) => string {
  const t = useSheetT();
  const tf = useSheetTf();
  return (c) => {
    if (c.verdict === "behind") return tf("cmp.v.behind", { n: c.lag });
    if (c.verdict === "ahead") return tf("cmp.v.ahead", { n: c.lag });
    return t(`cmp.v.${c.verdict}` as SheetDictKey);
  };
}

type Loaded = Extract<SlotCompareResult, { ok: true }>;
type LoadState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ok"; data: Loaded };

export function PlanCompareButton({
  date,
  slotStart,
  load,
  known,
  size = "md",
  inButton = false,
}: {
  date: string;
  slotStart: string;
  /** 모달이 열릴 때 부른다(서버 액션). */
  load: () => Promise<SlotCompareResult>;
  /** 미리 아는 판정(달력) — 있으면 칩이 그 판정을 적는다. 없으면 '계획 비교'. */
  known?: VerdictLike | null;
  size?: "sm" | "md";
  /**
   * 칩을 `<span role="button">`으로 — 달력 칸은 칸 전체가 `<button>`이라 그 안에 `<button>`을 또 두면
   * 잘못된 HTML이다(React 경고 · 스크린리더가 한 덩어리로 읽는다).
   */
  inButton?: boolean;
}) {
  const t = useSheetT();
  const tf = useSheetTf();
  const label = useVerdictLabel();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const openIt = () => {
    setOpen(true);
    setState({ status: "loading" });
    void load().then(
      (r) => setState(r.ok ? { status: "ok", data: r } : { status: "error", error: r.error }),
      () => setState({ status: "error", error: t("cmp.failed") }),
    );
  };

  const tone = known ? VERDICT_TONE[known.verdict] : null;
  const pad = size === "sm" ? "px-1.5 text-xs leading-4" : "px-2 py-0.5 text-xs";
  const cls = `cursor-pointer rounded-full border font-bold ${pad} ${
    tone
      ? `${TONE_SOFT[tone]} border-transparent`
      : "border-line-strong text-foreground hover:text-primary hover:border-primary"
  }`;
  const text = known ? label(known) : t("plan.compare");
  return (
    // 🔴 클릭을 여기서 멈춘다 — 달력 칸은 칸 전체가 '그 날 열기' 버튼이고, React 이벤트는 포털(모달)에서도
    //    컴포넌트 트리를 따라 올라가므로 안 막으면 모달 안을 누를 때마다 그 날 편집기가 함께 열린다.
    <span className="contents" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {inButton ? (
        <span
          role="button"
          tabIndex={0}
          title={t("plan.compare.title")}
          onClick={openIt}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openIt();
            }
          }}
          className={`self-start ${cls}`}
        >
          {text}
        </span>
      ) : (
        <button type="button" title={t("plan.compare.title")} onClick={openIt} className={cls}>
          {text}
        </button>
      )}
      {open ? (
        <Dialog open onOpenChange={(o) => (o ? null : setOpen(false))}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-base font-bold">
                {tf("cmp.title", { date: date.slice(5).replace("-", "/"), slot: slotStart })}
              </DialogTitle>
            </DialogHeader>
            {state.status === "loading" ? (
              <p className="text-text-dim py-6 text-center text-sm">{t("cmp.loading")}</p>
            ) : state.status === "error" ? (
              <p className="text-danger py-6 text-center text-sm">{state.error}</p>
            ) : (
              <CompareBody data={state.data} verdictLabel={label} />
            )}
          </DialogContent>
        </Dialog>
      ) : null}
    </span>
  );
}

const hasText = (a: { textbook: string | null; progress: string | null }) =>
  !!((a.textbook ?? "").trim() || (a.progress ?? "").trim());

function lineTone(v: LineVerdict) {
  return VERDICT_TONE[(v === "missing" ? "differ" : v) as CellVerdict];
}

function CompareBody({ data, verdictLabel }: { data: Loaded; verdictLabel: (c: VerdictLike) => string }) {
  const t = useSheetT();
  const tf = useSheetTf();
  const { compare, baseline, scheduled, shift } = data;
  const actual = data.actual.filter(hasText);
  // 일정이 원래 계획과 다를 때만(미루기·당기기) 그 사실을 따로 적는다 — 같으면 소음이다.
  const sig = (ls: { title: string; lessonNo: number }[]) => ls.map((l) => `${l.title}#${l.lessonNo}`).join("|");
  const scheduleDiffers = sig(scheduled) !== sig(baseline);

  const lineLabel = (l: CellCompare["lines"][number]) => {
    if (l.verdict === "missing") return t("cmp.line.missing");
    if (l.verdict === "behind" || l.verdict === "ahead") return tf("cmp.line.lesson", { n: l.actualLessonNo ?? "?" });
    return verdictLabel({ verdict: l.verdict, lag: 0 });
  };

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${TONE_SOFT[VERDICT_TONE[compare.verdict]]}`}>
          {verdictLabel(compare)}
        </span>
        {shift ? (
          <span className="text-text-dim text-xs font-bold">
            {t(shift === "skip" ? "cmp.shift.skip" : "cmp.shift.advance")}
          </span>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <section className="border-line rounded-xl border p-3">
          <h3 className="text-text-dim mb-2 text-xs font-bold">{t("cmp.baseline")}</h3>
          {baseline.length === 0 ? (
            <p className="text-text-faint text-xs">{t("cmp.noBaseline")}</p>
          ) : (
            <ul className="space-y-2">
              {compare.lines.map((l, i) => (
                <li key={i} className="space-y-0.5">
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="font-bold">{l.baseline.title}</span>
                    <span className="num text-text-dim text-xs">{tf("month.plannedNo", { n: l.baseline.lessonNo })}</span>
                    {actual.length > 0 ? (
                      <span className={`rounded px-1 text-xs font-bold ${TONE_SOFT[lineTone(l.verdict)]}`}>
                        {lineLabel(l)}
                      </span>
                    ) : null}
                  </div>
                  {l.baseline.progress ? <p className="text-text-dim text-xs">{l.baseline.progress}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="border-line rounded-xl border p-3">
          <h3 className="text-text-dim mb-2 text-xs font-bold">{t("cmp.actual")}</h3>
          {actual.length === 0 ? (
            <p className="text-text-faint text-xs">{t("cmp.noActual")}</p>
          ) : (
            <ul className="space-y-2">
              {actual.map((a, i) => (
                <li key={i} className="space-y-0.5">
                  <span className="font-bold">{a.textbook || "—"}</span>
                  {a.progress ? <p className="text-text-dim text-xs">{a.progress}</p> : null}
                  {a.homework ? <p className="text-text-faint text-xs">{a.homework}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {scheduleDiffers ? (
        <section className="bg-bg-soft rounded-xl p-3">
          <h3 className="text-text-dim mb-1 text-xs font-bold">{t("cmp.scheduled")}</h3>
          {scheduled.length === 0 ? (
            <p className="text-text-faint text-xs">{t("cmp.scheduled.none")}</p>
          ) : (
            <ul className="space-y-0.5 text-xs">
              {scheduled.map((s, i) => (
                <li key={i}>
                  <span className="font-bold">{s.title}</span>{" "}
                  <span className="num text-text-dim">{tf("month.plannedNo", { n: s.lessonNo })}</span>
                  {s.progress ? <span className="text-text-dim"> · {s.progress}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
