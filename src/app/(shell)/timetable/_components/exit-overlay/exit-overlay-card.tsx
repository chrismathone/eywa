"use client";

import type { CSSProperties, ReactNode } from "react";
import { WindowLink } from "@/components/workspace/window-link";
import { tipProps } from "@/components/hover-tip/tip";
import type { ExitOverlayData, OverlayGroup, OverlayMonth, OverlayRow } from "@/features/withdrawals/exit-overlay-model";
import { KBD_CLASS } from "./exit-overlay-hint";

/** `loading.prev` = 달을 옮기는 동안 흐리게 남겨 두는 직전 묶음(카드가 줄었다 커지며 자리가 튀지 않게). */
export type ExitOverlayState =
  | { status: "loading"; prev?: ExitOverlayData }
  | { status: "ready"; data: ExitOverlayData }
  | { status: "error"; error: string };

/** 선생님 색의 옅은 면 — 시트 파스텔을 카드 흰 면과 섞는다(글자는 늘 앱 글자색). */
const tint = (color: string | undefined): CSSProperties | undefined =>
  color ? { background: `color-mix(in srgb, ${color} 62%, var(--card))` } : undefined;

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className={KBD_CLASS}>{children}</kbd>;
}

/**
 * 한 달 열의 칸 — 이름 · 학교학년 · 날짜 · 사유가 묶음을 건너 **같은 세로줄**에 선다(원장 2026-10-14 *"열정리"*, 제목 행은 없다).
 * 열 본문이 네 칸 격자이고 묶음·줄은 그 칸을 물려받는다(subgrid).
 */
// 사유 칸은 최소 6em — 좁은 창에서 앞 세 칸(auto)이 폭을 다 가져가 사유가 사라지지 않게(넘치면 이름·학교가 먼저 잘린다).
const COLS = "grid grid-cols-[auto_auto_auto_minmax(6em,1fr)] gap-x-2";
const SUB = "col-span-full grid grid-cols-subgrid";
const ROW = `${SUB} items-baseline px-2 py-0.5 text-xs`;
const CELL = "min-w-0 truncate";
// 일반 화면 문구 — 평가 메뉴(실험실) 이름을 쓰지 않는다(꺼진 지점에선 있었는지도 모르게).
const UNCOUNTED_TIP =
  "선생님 퇴원 수에 넣지 않은 퇴원입니다 — 지난달 절반 이상 맡은 선생님이 없거나(온 지 얼마 안 된 학생 등), 줄을 그은 사유, 끝난 특강 등.";

function Row({ row }: { row: OverlayRow }) {
  const strike = row.excluded ? "line-through" : "";
  return (
    <div className={ROW} {...tipProps(row.reasonTitle)}>
      <b className={`${CELL} font-bold ${strike}`}>{row.name}</b>
      <span className={`${CELL} ${strike}`}>{row.schoolGrade}</span>
      <span className="text-right tabular-nums">{row.dateLabel}</span>
      <span className={`${CELL} ${strike}`}>{row.reason}</span>
    </div>
  );
}

function Group({ group, color }: { group: OverlayGroup; color: string | undefined }) {
  return (
    <div className={`${SUB} bg-bg-soft rounded-md pb-0.5`} style={tint(color)}>
      <div
        className="border-line-strong col-span-full flex items-center gap-1.5 border-b px-2 pt-1.5 pb-1 text-sm font-extrabold"
        {...(group.teacher ? {} : tipProps(UNCOUNTED_TIP))}
      >
        <span>{group.teacher ?? "선생님 미반영"}</span>
        <span className="tabular-nums before:mr-1.5 before:font-normal before:content-['·']">{group.count}</span>
      </div>
      <div className={`${SUB} divide-line-strong divide-y divide-dotted`}>
        {group.rows.map((r) => (
          <Row key={r.key} row={r} />
        ))}
      </div>
    </div>
  );
}

function Column({ month, tints }: { month: OverlayMonth; tints: Record<string, string> }) {
  return (
    <section aria-label={month.label} className="border-line-faint flex min-w-0 flex-col border-r last:border-r-0 max-[760px]:border-r-0 max-[760px]:border-b">
      <div className="border-line bg-card sticky top-0 z-[1] border-b px-3 pt-2.5 pb-2">
        <div className="flex items-center gap-2 text-base font-extrabold">
          {month.label}
          {month.live ? <span className="bg-primary-soft text-primary rounded-full px-2 text-xs font-bold">진행 중</span> : null}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums">
          <span><b className="mr-0.5 text-sm font-extrabold">{month.count}</b>퇴원</span>
          {month.holds ? <span>휴원 <b className="font-bold">{month.holds.length}</b></span> : null}
        </div>
      </div>
      <div className={`${COLS} content-start gap-y-1.5 px-2.5 pt-2 pb-3`}>
        {month.groups.length === 0 ? <p className="col-span-full px-0.5 py-2.5 text-xs">이 달에는 퇴원이 없습니다.</p> : null}
        {month.groups.map((g) => (
          <Group key={g.teacher ?? "—"} group={g} color={g.teacher ? tints[g.teacher] : undefined} />
        ))}
        {month.holds && month.holds.length > 0 ? (
          <div className={`${SUB} bg-bg-soft rounded-md pb-0.5`}>
            <div className="border-line-strong col-span-full border-b px-2 pt-1.5 pb-1 text-sm font-extrabold">지금 휴원 중 · {month.holds.length}</div>
            <div className={`${SUB} divide-line-strong divide-y divide-dotted`}>
              {month.holds.map((h) => (
                <div key={h.key} className={ROW}>
                  <b className={`${CELL} font-bold`}>{h.name}</b>
                  <span className={CELL}>{h.schoolGrade}</span>
                  <span />
                  <span className={CELL}>{[h.className, h.teacher].filter(Boolean).join(" · ")}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {month.zero.length ? (
          <div className="border-line col-span-full mt-0.5 flex flex-wrap items-center gap-1.5 border-t px-0.5 pt-1.5 text-xs">
            <b className="mr-0.5 font-extrabold">퇴원 0</b>
            {month.zero.map((t) => (
              <span key={t} className="bg-bg-soft rounded-full px-2 font-bold" style={tint(tints[t])}>{t}</span>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

const BTN = "border-line bg-card hover:border-line-strong inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-bold disabled:cursor-default disabled:opacity-40";

/** X 겹침 카드 본문 — 위 줄(제목·달 이동·닫기) · 석 달 열 · 아래 줄(키 · 규칙 · 퇴원관리). */
export function ExitOverlayCard({
  state,
  onOlder,
  onNewer,
  onClose,
}: {
  state: ExitOverlayState;
  onOlder: () => void;
  onNewer: () => void;
  onClose: () => void;
}) {
  const data = state.status === "ready" ? state.data : state.status === "loading" ? (state.prev ?? null) : null;
  const busy = state.status === "loading";
  return (
    <div className="border-line bg-card shadow-modal flex max-h-[min(660px,calc(100vh-16px))] w-[min(1040px,calc(100vw-16px))] flex-col rounded-lg border">
      <div className="border-line flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b px-3 py-2">
        <span className="text-sm font-extrabold">퇴원</span>
        <span className="text-xs">{data?.subjectLabel ?? ""}</span>
        <span className="flex-1" />
        <button type="button" className={BTN} onClick={onOlder} disabled={busy || !data?.canOlder}>‹ 이전 달</button>
        <button type="button" className={BTN} onClick={onNewer} disabled={busy || !data?.canNewer}>다음 달 ›</button>
        <button type="button" className={BTN} onClick={onClose}>닫기 <Kbd>X</Kbd></button>
      </div>
      {data ? (
        <div
          aria-busy={busy}
          className={`grid min-h-0 grid-cols-3 overflow-y-auto overscroll-contain transition-opacity max-[760px]:grid-cols-1 ${busy ? "opacity-50" : ""}`}
        >
          {data.months.map((m) => (
            <Column key={m.month} month={m} tints={data.tints} />
          ))}
        </div>
      ) : (
        <p className="px-3 py-8 text-center text-sm" role={state.status === "error" ? "alert" : "status"}>
          {state.status === "error" ? state.error : "퇴원 목록을 불러오는 중…"}
        </p>
      )}
      <div className="border-line flex flex-wrap items-center gap-x-3.5 gap-y-1.5 border-t px-3 py-2 text-xs">
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          <span><Kbd>X</Kbd> 열고 닫기</span>
          <span><Kbd>←</Kbd> <Kbd>→</Kbd> 한 달씩</span>
          <span><Kbd>Esc</Kbd> 닫기</span>
        </span>
        <span className="min-w-0 flex-[1_1_340px]">
          선생님 = 그날 담임 + 교시 담당(지난달 절반 이상 맡은 학생). {data?.rulesNote} 데이터 정리 일괄 퇴원과 휴원은 넣지 않습니다.
        </span>
        {data ? (
          <WindowLink href={data.withdrawalsHref} className="text-primary font-bold hover:underline">
            퇴원관리에서 보기 →
          </WindowLink>
        ) : null}
      </div>
    </div>
  );
}
