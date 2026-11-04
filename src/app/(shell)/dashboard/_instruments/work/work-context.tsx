"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { NO_WORK, type WorkBoard, type WorkPrefill } from "@/features/work-requests/model";
import { WorkDrawer } from "./work-drawer";
import { WorkForm } from "./work-form";
import "./work.css";

export type { WorkPrefill };
type WorkValue = {
  board: WorkBoard;
  today: string;
  refresh: () => Promise<void>;
  open: (id: string) => void;
  create: (prefill?: WorkPrefill) => void;
};

const WorkContext = createContext<WorkValue | null>(null);
export function useWork(): WorkValue {
  const value = useContext(WorkContext);
  if (!value) throw new Error("useWork는 WorkProvider 안에서만 쓴다");
  return value;
}

/**
 * 업무 요청 — 화면이 뜬 뒤 따로 읽고(`/api/work-requests`) 처리 뒤 다시 읽는다. 상세·만들기 창은 여기 하나다.
 * 개발 화면(`demo`)은 서버에 묻지 않는다.
 */
export function WorkProvider({ today, demo, tick, children }: { today: string; demo?: WorkBoard; tick: number; children: ReactNode }) {
  const [board, setBoard] = useState<WorkBoard>(demo ?? NO_WORK);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkPrefill | null>(null);

  const load = useCallback(() => fetch("/api/work-requests", { cache: "no-store" }).then((res) => (res.ok ? (res.json() as Promise<WorkBoard>) : null)).catch(() => null), []);
  const refresh = useCallback(async () => {
    if (demo) return;
    const next = await load();
    if (next) setBoard(next);
  }, [demo, load]);
  useEffect(() => {
    if (demo) return;
    let alive = true;
    void load().then((next) => { if (alive && next) setBoard(next); });
    return () => { alive = false; };
  }, [demo, load, tick]);

  const value = useMemo<WorkValue>(() => ({ board, today, refresh, open: setOpenId, create: (prefill) => setDraft(prefill ?? {}) }), [board, today, refresh]);
  const item = openId ? board.items.find((i) => i.id === openId) ?? null : null;
  return (
    <WorkContext.Provider value={value}>
      {children}
      {item ? <WorkDrawer key={item.id} item={item} onClose={() => setOpenId(null)} /> : null}
      {draft ? <WorkForm prefill={draft} onClose={() => setDraft(null)} onCreated={(id) => { setDraft(null); void refresh().then(() => setOpenId(id)); }} /> : null}
    </WorkContext.Provider>
  );
}
