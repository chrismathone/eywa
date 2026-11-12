"use client";

/**
 * 영어 템플릿 칸의 **결과지 고르기**(2026-09-28 원장 *"어떤 시험인지 선택이 안 되자나"*) — 인재원에서 본 시험 목록
 * (단어장마다 마지막 제출·최신순)을 체크해서 글의 `[시험결과지]` 자리에 붙일 결과지를 정한다.
 *
 * 🔑 기본(아무것도 안 건드림) = 이날 본 시험 전부 — 종전 동작 그대로. 처음 누르면 지금 붙어 있는 것에서 출발한다(jj-day.ts).
 * 🔑 다른 날 본 시험도 고를 수 있다 — 보카킹 월례 시험(9/17 응시)을 며칠 뒤 보고서에 붙이는 것이 이 기능의 이유다.
 * 🔴 고른 값은 저장할 때 서버가 **다시 받아** 확인한다(이 학생 응시인지) — 여기 목록은 고르는 재료일 뿐이다.
 */
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import type { IjwExamListItem } from "@/features/ijw/contract";
import { JJ_PICK_MAX } from "@/features/ijw/snapshot";
import { kstDateOf } from "@/lib/date-kst";
import { jjOptionChecked, toggleJjPick } from "../jj-day";

export type JjExamPickState = {
  options: readonly IjwExamListItem[];
  /** 지금 고르기 — `null` = 기본(이날 본 시험). */
  pick: readonly string[] | null;
  /** 보고서 날짜(YYYY-MM-DD) — 기본 판정의 '이날'. */
  date: string;
  /** 받는 중 — 연달아 누른 체크가 옛 목록 위에서 계산되지 않게 잠근다. */
  busy: boolean;
};

/** `2026-09-17T08:34:00Z` → `9/17`(KST). */
function shortDate(iso: string): string {
  const d = kstDateOf(iso);
  if (!d) return "";
  const [, m, day] = d.split("-");
  return `${Number(m)}/${Number(day)}`;
}

export function JjExamPicker({
  state,
  onPick,
}: {
  state: JjExamPickState;
  /** 새 고르기(`null` = 기본으로). */
  onPick: (pick: string[] | null) => void;
}) {
  const t = useSheetT();
  const tf = useSheetTf();
  const { options, pick, date, busy } = state;
  const count = pick
    ? pick.length
    : options.filter((o) => jjOptionChecked(o, pick, date)).length;
  const full = count >= JJ_PICK_MAX;
  const summary = pick
    ? count
      ? tf("os.tpl.jjPickCount", { n: count })
      : t("os.tpl.jjPickNone")
    : t("os.tpl.jjPickDefault");

  return (
    <details className="border-line rounded-lg border text-xs">
      <summary className="flex cursor-pointer flex-wrap items-center gap-1.5 px-2 py-1.5 select-none">
        <span className="text-foreground font-bold">{t("os.tpl.jjPickTitle")}</span>
        <span
          className={pick && !count ? "text-amber font-bold" : "text-text-dim"}
        >
          {summary}
        </span>
      </summary>
      <div className="border-line-faint flex flex-col gap-1 border-t px-2 py-1.5">
        {options.length === 0 ? (
          <p className="text-text-faint">{t("os.tpl.jjPickEmpty")}</p>
        ) : (
          <ul className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
            {options.map((o) => {
              const on = jjOptionChecked(o, pick, date);
              return (
                <li key={o.attemptId}>
                  <label className="hover:bg-surface-hi flex cursor-pointer items-center gap-2 rounded-md px-1 py-1">
                    <input
                      type="checkbox"
                      className="size-4 shrink-0"
                      checked={on}
                      disabled={busy || (!on && full)}
                      onChange={() =>
                        onPick(toggleJjPick(options, pick, date, o.attemptId))
                      }
                    />
                    <span
                      className="text-foreground min-w-0 flex-1 overflow-hidden font-bold text-ellipsis whitespace-nowrap"
                      title={o.deck}
                    >
                      {o.deck}
                    </span>
                    <span className="text-text-dim num shrink-0">
                      {shortDate(o.submittedAt)}
                    </span>
                    <span className="text-text-dim num w-16 shrink-0 text-right">
                      {o.correct}/{o.total}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {full ? (
            <span className="text-text-faint">
              {tf("os.tpl.jjPickMax", { n: JJ_PICK_MAX })}
            </span>
          ) : null}
          {pick ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onPick(null)}
              className="text-primary underline underline-offset-2"
            >
              {t("os.tpl.jjPickReset")}
            </button>
          ) : null}
        </div>
        <p className="text-text-faint break-keep">{t("os.tpl.jjPickHint")}</p>
      </div>
    </details>
  );
}
