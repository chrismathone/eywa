"use client";

import type { CSSProperties, ReactNode } from "react";
import { WindowLink } from "@/components/workspace/window-link";
import { tipProps } from "@/components/hover-tip/tip";
import type { ExitOverlayData, OverlayGroup, OverlayMonth, OverlayRow } from "@/features/withdrawals/exit-overlay-model";

/** `loading.prev` = 달을 옮기는 동안 흐리게 남겨 두는 직전 묶음(카드가 줄었다 커지며 자리가 튀지 않게). */
export type ExitOverlayState =
  | { status: "loading"; prev?: ExitOverlayData }
  | { status: "ready"; data: ExitOverlayData }
  | { status: "error"; error: string };

/** 선생님 색의 옅은 면 — 시트 파스텔을 카드 흰 면과 섞는다(글자는 늘 앱 글자색). */
const tint = (color: string | undefined): CSSProperties | undefined =>
  color ? { background: `color-mix(in srgb, ${color} 62%, var(--card))` } : undefined;

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="border-line-strong bg-card inline-flex min-w-[1.6em] items-center justify-center rounded border border-b-2 px-1 font-sans text-xs font-bold">
      {children}
    </kbd>
  );
}

function Chip({ children, dashed = false }: { children: ReactNode; dashed?: boolean }) {
  return (
    <span className={`border-line-strong bg-card mr-1 inline-block rounded-full border px-1.5 text-xs leading-snug font-bold ${dashed ? "ml-1 mr-0 border-dashed" : ""}`}>
      {children}
    </span>
  );
}

const ROW = "grid grid-cols-[8.8em_2.9em_minmax(0,1fr)] items-baseline gap-2 px-2 py-px text-xs";

function Row({ row }: { row: OverlayRow }) {
  const strike = row.excluded ? "line-through" : "";
  return (
    <div className={ROW} {...tipProps(row.reasonTitle)}>
      <span className={`truncate ${strike}`}>
        <b className="font-bold">{row.name}</b> {row.schoolGrade}
      </span>
      <span className="text-right tabular-nums">{row.dateLabel}</span>
      <span className={`truncate ${strike}`}>
        {row.kind === "subject-ended" ? <Chip>수강종료</Chip> : null}
        {row.reason}
        {row.excluded ? <Chip dashed>제외</Chip> : null}
      </span>
    </div>
  );
}

function Group({ group, color }: { group: OverlayGroup; color: string | undefined }) {
  return (
    <div className="bg-bg-soft rounded-md pt-0.5 pb-1" style={tint(color)}>
      <div className="flex items-center gap-1.5 px-2 pt-1 pb-0.5 text-xs font-extrabold">
        <span>{group.teacher ?? "담임 미상"}</span>
        <span className="tabular-nums before:mr-1.5 before:font-normal before:content-['·']">{group.count}</span>
        {group.inferred > 0 ? (
          <span {...tipProps(`담임 기록이 없어 ${group.inferred}줄은 마지막 보고서·출결로 추정했습니다(줄에 마우스를 올리면 근거)`)}>
            <Chip dashed>추정</Chip>
          </span>
        ) : null}
      </div>
      {group.rows.map((r) => (
        <Row key={r.key} row={r} />
      ))}
    </div>
  );
}

function Column({ month, tints }: { month: OverlayMonth; tints: Record<string, string> }) {
  const { counts } = month;
  return (
    <section aria-label={month.label} className="border-line-faint flex min-w-0 flex-col border-r last:border-r-0 max-[760px]:border-r-0 max-[760px]:border-b">
      <div className="border-line bg-card sticky top-0 z-[1] border-b px-3 pt-2.5 pb-2">
        <div className="flex items-center gap-2 text-base font-extrabold">
          {month.label}
          {month.live ? <span className="bg-primary-soft text-primary rounded-full px-2 text-xs font-bold">진행 중</span> : null}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums">
          <span><b className="mr-0.5 text-sm font-extrabold">{counts.withdrawn}</b>퇴원</span>
          <span><b className="mr-0.5 text-sm font-extrabold">{counts.subjectEnded}</b>수강종료</span>
          <span>
            제외 <b className="font-bold">{counts.excluded}</b>
            {month.holds ? <> · 휴원 <b className="font-bold">{month.holds.length}</b></> : null}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 px-2.5 pt-2 pb-3">
        {month.groups.length === 0 ? <p className="px-0.5 py-2.5 text-xs">이 달에는 퇴원 · 수강종료가 없습니다.</p> : null}
        {month.groups.map((g) => (
          <Group key={g.teacher ?? "—"} group={g} color={g.teacher ? tints[g.teacher] : undefined} />
        ))}
        {month.holds && month.holds.length > 0 ? (
          <div className="bg-bg-soft rounded-md pt-0.5 pb-1">
            <div className="px-2 pt-1 pb-0.5 text-xs font-extrabold">지금 휴원 중 · {month.holds.length}</div>
            {month.holds.map((h) => (
              <div key={h.key} className={ROW}>
                <span className="truncate"><b className="font-bold">{h.name}</b> {h.schoolGrade}</span>
                <span />
                <span className="truncate">{[h.className, h.teacher].filter(Boolean).join(" · ")}</span>
              </div>
            ))}
          </div>
        ) : null}
        {month.zero?.length ? (
          <div className="border-line mt-0.5 flex flex-wrap items-center gap-1.5 border-t px-0.5 pt-1.5 text-xs">
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
        <span className="text-sm font-extrabold">퇴원 · 수강종료</span>
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
          선생님은 그때 담임입니다(기록이 없으면 보고서 · 출결로 추정). 이사 · 질병 · 권고퇴원 · 졸업은 줄을 긋고 건수에서 뺍니다. 휴원은 건수에 넣지 않습니다.
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
