"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore, useTransition } from "react";
import { EmbedLink } from "@/components/embed-link";
import { BREAKDOWN_AXES, type BreakdownAxis } from "@/features/withdrawals/breakdown";
import { saveWithdrawalTrendPrefs } from "@/features/withdrawals/server/trend-prefs-actions";

/** 막대 한 줄 — 누르면 명단이 그 값으로 걸러진다(`href` · 고른 칸은 해제 주소). 거를 수 없는 칸(과목 미상)은 `href` 없음. */
export type BreakdownRow = { value: string; label: string; count: number; href: string | null; active: boolean };
/**
 * 축 하나의 그림 — 머리 아래 설명 · 비중의 분모(그 축이 센 줄 수) · 맨 아래 안내(담당 미반영 까닭 등).
 * `share` = 비중(%)을 보일지 — 강사는 건수만(원장 2026-10-15 답: 강사 = 건수만 · 함께 맡은 줄은 두 번 세어 합이 100%를 넘는다).
 */
export type BreakdownView = { caption: string; total: number; rows: BreakdownRow[]; note?: string | null; share: boolean };

const SEG = "text-xs px-2 py-0.5 transition";
const ON = "bg-primary text-primary-foreground font-semibold";
const OFF = "bg-card text-text-dim hover:text-foreground";

/**
 * 이 창(문서)에서 마지막으로 고른 축 — 대기 카드 · 흘려받은 카드 · 이동 뒤 새 카드가 같은 축을 보인다. 저장은 계정(`ui_prefs`)이 하고,
 * 이건 저장을 기다리는 동안과 저장이 안 되는 화면(운영 콘솔의 읽기 전용 지점 보기)을 잇는 다리다. 서버 렌더·첫 하이드레이션은 null(서버가 준 축).
 */
let pickedAxis: BreakdownAxis | null = null;
const axisListeners = new Set<() => void>();
const subscribeAxis = (fn: () => void) => {
  axisListeners.add(fn);
  return () => void axisListeners.delete(fn);
};
const setPickedAxis = (next: BreakdownAxis) => {
  pickedAxis = next;
  for (const fn of axisListeners) fn();
};
/** 지금 주소에 강사 축을 실은 주소 — 핸들러·효과에서만 부른다(렌더에서 `window` 금지). 창 안의 `embed=1`도 그대로 남는다. */
const teacherHref = () => {
  const url = new URL(window.location.href);
  url.searchParams.set("axis", "teacher");
  return `${url.pathname}?${url.searchParams}`;
};

/**
 * **분석 카드** — 과목 · 강사 · 학년 · 학교 축을 바꿔 본다(원장 2026-10-15 *"과목별을 기본으로 강사별, 학년별, 학교별"*).
 * 고른 축은 누르는 순간 계정에 저장한다(`ui_prefs.withdrawals.breakdown_axis` — 다른 PC에서도 같은 축). 과목·학년·학교는 서버가 이미
 * 세어 보내 바로 바뀐다. 강사는 계산이 무거워 그 축일 때만 서버가 계산한다 — 강사 칸이 없으면 **저장이 끝난 뒤 지금 주소 그대로**
 * 다시 받는다(`router.refresh`는 진행 중인 필터 이동 뒤에 줄을 선다 · 🔴 `history.replaceState`·새 주소 이동은 그 이동을 버린다).
 * 저장이 안 되면 주소의 축(`axis=teacher`)으로 받는다. 이동해 온 새 화면에 강사 칸이 비어도 같은 방법으로 한 번 받는다.
 */
export function WithdrawalBreakdownCard({ views, initialAxis, teacherError, teacherLoading }: {
  views: Record<Exclude<BreakdownAxis, "teacher">, BreakdownView> & { teacher: BreakdownView | null };
  initialAxis: BreakdownAxis;
  /** 강사 판정을 불러오다 실패했다. */
  teacherError?: boolean;
  /** 서버가 강사 칸을 흘려보내는 중이다(Suspense 대기 카드) — 다시 받지 않는다. */
  teacherLoading?: boolean;
}) {
  const router = useRouter();
  const axis = useSyncExternalStore(subscribeAxis, () => pickedAxis, () => null) ?? initialAxis;
  const [pending, startTransition] = useTransition();
  // 강사 칸을 이미 청한 서버 화면(`views`는 서버가 새로 내려줄 때마다 새 객체) — 같은 화면에 두 번 청하지 않는다.
  const asked = useRef<object | null>(null);
  const needsTeacher = axis === "teacher" && !views.teacher && !teacherError && !teacherLoading;
  // 이동해 온 화면에 강사 칸이 없다(이 창이 고른 축이 아직 저장되지 않았거나 저장이 안 되는 화면) → 주소의 축으로 한 번 받는다.
  useEffect(() => {
    if (!needsTeacher || pending || asked.current === views) return;
    asked.current = views;
    startTransition(() => router.replace(teacherHref(), { scroll: false }));
  }, [needsTeacher, pending, views, router]);
  const pick = (next: BreakdownAxis) => {
    if (next === axis) return;
    setPickedAxis(next);
    // 표시 취향 — 저장 실패해도 화면은 바뀐 그대로.
    const saved = saveWithdrawalTrendPrefs({ axis: next }).then((r) => r.ok, () => false);
    if (next !== "teacher" || views.teacher || teacherError || teacherLoading) return;
    asked.current = views;
    startTransition(async () => {
      if (await saved) router.refresh();
      else router.replace(teacherHref(), { scroll: false });
    });
  };
  const view = axis === "teacher" ? views.teacher : views[axis];
  const max = Math.max(1, ...(view?.rows.map((r) => r.count) ?? [1]));
  return (
    <section className="bg-card shadow-card flex flex-col rounded-2xl p-5" aria-busy={pending || undefined}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-foreground text-base font-bold">{BREAKDOWN_AXES.find((a) => a.key === axis)?.label}별 분포</h2>
          {view ? <p className="text-text-faint mt-0.5 text-xs">{view.caption}</p> : null}
        </div>
        <div role="group" aria-label="분석 기준" className="border-border inline-flex shrink-0 overflow-hidden rounded-md border">
          {BREAKDOWN_AXES.map((a, i) => (
            <button
              key={a.key}
              type="button"
              aria-pressed={axis === a.key}
              onClick={() => pick(a.key)}
              className={`${SEG} ${i > 0 ? "border-border border-l" : ""} ${axis === a.key ? ON : OFF}`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </header>
      {!view ? (
        <p className="text-text-dim py-6 text-center text-sm" role="status">
          {teacherError ? "강사별 집계를 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요." : "강사별로 세는 중입니다…"}
        </p>
      ) : view.rows.length === 0 ? (
        <p className="text-text-dim py-6 text-center text-sm">걸린 조건에 맞는 줄이 없습니다.</p>
      ) : (
        // 학교·강사는 줄이 많다 — 카드 안에서만 스크롤한다(옆 추이 카드 높이를 밀어 올리지 않게 · 링 테두리가 잘리지 않게 px-1, #114).
        <ul className="-mx-1 max-h-64 space-y-2.5 overflow-y-auto px-1">
          {view.rows.map((r) => (
            <li key={r.value}>
              <BarRow row={r} max={max} total={view.share ? view.total : null} />
            </li>
          ))}
        </ul>
      )}
      {view?.note ? <p className="text-text-faint mt-3 text-xs leading-relaxed">{view.note}</p> : null}
    </section>
  );
}

/** `total`이 null이면 비중을 보이지 않는다(강사 축). */
function BarRow({ row: r, max, total }: { row: BreakdownRow; max: number; total: number | null }) {
  const body = (
    <>
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className={`truncate text-xs font-bold ${r.active ? "text-primary" : "text-foreground"}`}>{r.label}</span>
        <span className="text-text-dim num shrink-0 text-xs">
          <span className="text-foreground font-bold">{r.count}</span>건
          {total !== null ? ` · ${Math.round((r.count / Math.max(total, 1)) * 100)}%` : ""}
        </span>
      </span>
      <span className="bg-bg-soft block h-2 overflow-hidden rounded-full">
        <span className={`${r.active ? "bg-primary" : "bg-rose"} block h-full`} style={{ width: `${(r.count / max) * 100}%` }} />
      </span>
    </>
  );
  if (!r.href) return <div>{body}</div>;
  return (
    <EmbedLink
      href={r.href}
      scroll={false}
      aria-current={r.active ? "true" : undefined}
      aria-label={`${r.label} ${r.count}건${r.active ? " · 필터 해제" : " · 명단 거르기"}`}
      className="hover:bg-bg-soft -mx-1 block rounded-md px-1 py-0.5 transition"
    >
      {body}
    </EmbedLink>
  );
}
