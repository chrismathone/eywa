"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KANBAN_SEED, OS_MENT, STUDENTS, TODAY, TODO_ITEMS, seedAttendance, type Att, type AttMap, type KanCard, type Subj } from "./data";
import { parseAtt, type RoomId } from "./rooms";

export type SparkFn = (from: RoomId, to: RoomId, done: () => void) => void;
export type FlashKey = "att" | "bill" | "kan";

/** 예시 학원의 바뀌는 값(출결·수납·상담 칸반·셔틀·원스크린)과 그 조작. 화면을 떠나면 사라진다(저장 없음). */
export function useDeskData(spark: SparkFn) {
  const [att, setAtt] = useState<AttMap>(seedAttendance);
  const [paid, setPaid] = useState<Record<string, boolean>>(() => {
    const p: Record<string, boolean> = {};
    for (const n of Object.keys(STUDENTS)) p[n] = n !== "한지우" && n !== "윤서아";
    return p;
  });
  const [kanban, setKanban] = useState<{ k: string; c: KanCard[] }[]>(() => KANBAN_SEED.map((c) => ({ ...c, c: [...c.c] })));
  const [ride, setRide] = useState<Record<string, boolean>>({ 정하린: true, 노은채: false });
  const [todo, setTodo] = useState<boolean[]>(() => TODO_ITEMS.map(() => false));
  const [consSel, setConsSel] = useState(0);
  const [ttFilter, setTtFilter] = useState<"all" | Subj>("all");
  const [stuQ, setStuQ] = useState("");
  const [os, setOs] = useState({ text: "", typing: false, sent: false });
  const [flash, setFlash] = useState<Record<FlashKey, number>>({ att: 0, bill: 0, kan: 0 });
  const typing = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (typing.current) clearInterval(typing.current); }, []);

  const bump = useCallback((k: FlashKey) => setFlash((f) => ({ ...f, [k]: f[k] + 1 })), []);

  const cycleCell = useCallback((arg: string, name: string) => {
    const { k, d } = parseAtt(arg);
    setAtt((a) => {
      const cur: Att = a[k][d]?.[name] ?? "";
      const next: Att = cur === "p" ? "a" : cur === "a" ? "l" : "p";
      return { ...a, [k]: { ...a[k], [d]: { ...a[k][d], [name]: next } } };
    });
    if (d === TODAY) spark("classA", "office", () => bump("att"));
  }, [spark, bump]);

  const fillPresent = useCallback((arg: string) => {
    const { k, d } = parseAtt(arg);
    setAtt((a) => {
      const day = { ...a[k][d] };
      for (const n of Object.keys(day)) if (!day[n]) day[n] = "p";
      return { ...a, [k]: { ...a[k], [d]: day } };
    });
    if (d === TODAY) spark("classA", "office", () => bump("att"));
  }, [spark, bump]);

  const pay = useCallback((name: string) => {
    setPaid((p) => ({ ...p, [name]: true }));
    spark("desk", "office", () => bump("bill"));
  }, [spark, bump]);

  const moveCard = useCallback((ci: number, i: number) => {
    if (ci >= 3) return;
    setKanban((kb) => {
      const next = kb.map((c) => ({ ...c, c: [...c.c] }));
      const [card] = next[ci].c.splice(i, 1);
      if (card) next[ci + 1].c.unshift(card);
      return next;
    });
    if (ci === 0) spark("desk", "office", () => bump("kan"));
  }, [spark, bump]);

  const osGenerate = useCallback(() => {
    if (typing.current) clearInterval(typing.current);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setOs({ text: OS_MENT, typing: false, sent: false }); return; }
    let i = 0;
    setOs({ text: "", typing: true, sent: false });
    typing.current = setInterval(() => {
      i += 2;
      if (i >= OS_MENT.length) {
        if (typing.current) clearInterval(typing.current);
        typing.current = null;
        setOs({ text: OS_MENT, typing: false, sent: false });
      } else setOs({ text: OS_MENT.slice(0, i), typing: true, sent: false });
    }, 28);
  }, []);

  const act = useMemo(() => ({
    cycleCell, fillPresent, pay, moveCard, osGenerate,
    osSend: () => setOs((o) => ({ ...o, sent: true })),
    toggleRide: (n: string) => setRide((r) => ({ ...r, [n]: !r[n] })),
    toggleTodo: (i: number) => setTodo((t) => t.map((v, j) => (j === i ? !v : v))),
    setConsSel, setTtFilter, setStuQ,
  }), [cycleCell, fillPresent, pay, moveCard, osGenerate]);

  // 끄는 동안(창 좌표만 바뀔 때) 창 내용이 다시 그려지지 않게 값 묶음의 정체성을 고정한다.
  const data = useMemo(() => ({ att, paid, kanban, ride, todo, consSel, ttFilter, stuQ, os, flash }), [att, paid, kanban, ride, todo, consSel, ttFilter, stuQ, os, flash]);
  return { data, act };
}

export type DeskData = ReturnType<typeof useDeskData>["data"];
export type DeskActs = ReturnType<typeof useDeskData>["act"];
