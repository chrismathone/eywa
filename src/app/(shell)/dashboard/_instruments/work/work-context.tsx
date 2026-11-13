"use client";

import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { NO_WORK, type WorkBoard, type WorkPrefill } from "@/features/work-requests/model";
import { WorkDrawer } from "./work-drawer";
import "./work.css";

// 만들기 창(서식 편집기 포함)은 열 때만 받는다 — 강사 홈은 요청을 만들지 않는다(B5).
const WorkForm = dynamic(() => import("./work-form").then((m) => m.WorkForm), { ssr: false });

export type { WorkPrefill };
type WorkValue = {
  board: WorkBoard;
  /** 마지막 읽기가 실패했나 — 실패를 '0건'으로 보이지 않게(받은 업무 요청). 다음에 성공하면 내려간다. */
  failed: boolean;
  today: string;
  refresh: () => Promise<void>;
  open: (id: string) => void;
  create: (prefill?: WorkPrefill) => void;
  /** 업무 창을 셸 머리글 위로 올리나(강사 홈 — 미니셸 머리글 z-60). 운영실 · 업무 완성도는 종전 층 그대로. */
  raised: boolean;
};

const WorkContext = createContext<WorkValue | null>(null);
/** 업무 창 층 — 공급자 밖(쓰일 일 없음)이면 종전 층. */
export const useWorkRaised = () => useContext(WorkContext)?.raised ?? false;
export function useWork(): WorkValue {
  const value = useContext(WorkContext);
  if (!value) throw new Error("useWork는 WorkProvider 안에서만 쓴다");
  return value;
}

/**
 * 업무 요청 — 화면이 뜬 뒤 따로 읽고(`/api/work-requests`) 처리 뒤 다시 읽는다. 상세·만들기 창은 여기 하나다.
 * 개발 화면(`demo`)은 서버에 묻지 않는다.
 */
export function WorkProvider({ today, demo, tick, raised = false, children }: { today: string; demo?: WorkBoard; tick: number; raised?: boolean; children: ReactNode }) {
  const [board, setBoard] = useState<WorkBoard>(demo ?? NO_WORK);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkPrefill | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => fetch("/api/work-requests", { cache: "no-store" }).then((res) => (res.ok ? (res.json() as Promise<WorkBoard>) : null)).catch(() => null), []);
  const take = useCallback((next: WorkBoard | null) => { setFailed(!next); if (next) setBoard(next); }, []);
  const refresh = useCallback(async () => {
    if (demo) return;
    take(await load());
  }, [demo, load, take]);
  useEffect(() => {
    if (demo) return;
    let alive = true;
    void load().then((next) => { if (alive) take(next); });
    return () => { alive = false; };
  }, [demo, load, take, tick]);

  const value = useMemo<WorkValue>(() => ({ board, failed, today, refresh, open: setOpenId, create: (prefill) => setDraft(prefill ?? {}), raised }), [board, failed, today, refresh, raised]);
  const item = openId ? board.items.find((i) => i.id === openId) ?? null : null;
  return (
    <WorkContext.Provider value={value}>
      {children}
      {item ? <WorkDrawer key={item.id} item={item} onClose={() => setOpenId(null)} /> : null}
      {draft ? <WorkForm prefill={draft} onClose={() => setDraft(null)} onCreated={(id) => { setDraft(null); void refresh().then(() => setOpenId(id)); }} /> : null}
    </WorkContext.Provider>
  );
}
