"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DAYS, SUBJ_LABEL, type Att, type Subj } from "./data";
import type { DeskActs, DeskData } from "./use-desk-data";

/** 창 내용들이 함께 쓰는 값·조작(props 전달 대신 문맥으로). */
export type DeskCtxValue = {
  data: DeskData; act: DeskActs;
  openStudent: (name: string) => void;
  openAtt: (k: string, d: number) => void;
};
export const DeskCtx = createContext<DeskCtxValue | null>(null);
export function useDesk() {
  const v = useContext(DeskCtx);
  if (!v) throw new Error("DeskCtx 밖에서 창 내용을 그렸다");
  return v;
}

export const Pill = ({ tone, children }: { tone: string; children: ReactNode }) => <span className={`pill ${tone}`}>{children}</span>;
export const SubjPill = ({ s }: { s: Subj }) => <span className={`pill s-${s}`}>{SUBJ_LABEL[s]}</span>;

export function WDays({ slots }: { slots: [number, number][] }) {
  const on = new Set(slots.map((s) => s[0]));
  return <span className="wdays">{DAYS.map((d, i) => <i key={d} className={on.has(i) ? "on" : ""}>{d}</i>)}</span>;
}

export function Dots({ past, today }: { past: Att[]; today?: Att | null }) {
  return (
    <span className="dots">
      {past.map((v, i) => <i key={i} className={v} />)}
      {today != null ? <i className={`${today} today`} title="오늘" /> : null}
    </span>
  );
}

export function StuLink({ n }: { n: string }) {
  const { openStudent } = useDesk();
  return <button type="button" className="lnkname" onClick={() => openStudent(n)}>{n}</button>;
}

export const FootNote = ({ left, right }: { left: ReactNode; right?: ReactNode }) => (
  <div className="foot-note"><span>{left}</span>{right ? <span>{right}</span> : null}</div>
);
