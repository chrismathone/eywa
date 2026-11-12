"use client";

import type { ReactNode } from "react";
// 업무 요청 창(만들기 · 상세)은 운영실의 것을 그대로 쓴다 — 창이 body에 제 범위(.aywa-instruments)를 씌워 그리므로 그 스타일만 함께 싣는다(범위 밖은 건드리지 않는다).
import "@/app/(shell)/dashboard/_instruments/instruments.css";
import { WorkProvider, useWork } from "@/app/(shell)/dashboard/_instruments/work/work-context";
import { coversLate, lateRequestPrefill, openLateRequest, requestSubject } from "../../late-request";
import type { LateItem } from "../../view-admin";

/** 업무 완성도 화면의 업무 요청 범위 — 요청 목록을 화면이 뜬 뒤 따로 읽는다(GET · 갱신 때 다시). */
export function DutyRequestScope({ today, tick, children }: { today: string; tick: number; children: ReactNode }) {
  // 요청 목록은 단추의 '요청함' 표시에만 쓴다 — 화면 갱신(60초)마다가 아니라 다섯 번에 한 번만 다시 읽는다(보낸 직후에는 창이 스스로 다시 읽는다).
  return <WorkProvider today={today} tick={Math.floor(tick / 5)}>{children}</WorkProvider>;
}

const md = (iso: string) => { const d = new Date(Date.parse(iso) + 9 * 3_600_000).toISOString(); return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`; };

/**
 * '처리 요청' — 그 선생님의 지금 열린 지연을 담당 · 근거 학생 · 내용까지 채운 업무 요청으로 연다(보내기 전에 고칠 수 있다).
 * 이미 보낸 요청이 끝나지 않았으면 '요청함'으로 바뀌고 누르면 그 요청을 연다(같은 재촉을 두 번 보내지 않는다).
 * 업무 요청을 만들 수 없는 계정 · 담당자 없는 의무 · 요청을 받을 수 없는 사람(퇴사 등 — 만들기 창이 담당자에서 조용히 빼 버린다)에게는 그리지 않는다.
 */
export function LateRequestButton({ owner, items }: { owner: { id: string | null; name: string }; items: readonly LateItem[] }) {
  const work = useWork();
  const id = owner.id;
  if (!work.board.enabled || !work.board.canCreate || !id || !items.length || !work.board.staff.some((p) => p.id === id)) return null;
  const sent = openLateRequest(work.board.items, id, requestSubject(items));
  // 요청 뒤에 새로 생긴 지연이 있으면 '요청함'으로 덮지 않고 다시 요청할 수 있게 한다.
  if (sent && coversLate(sent, items)) return <button type="button" onClick={() => work.open(sent.id)} className="border-line text-text-dim hover:text-primary shrink-0 rounded-full border px-2.5 py-1 text-xs font-bold whitespace-nowrap">요청함 · {md(sent.createdAt)}</button>;
  const send = () => { const prefill = lateRequestPrefill(items, { id, name: owner.name }, work.today); if (prefill) work.create(prefill); };
  return <button type="button" onClick={send} className="bg-primary text-primary-foreground shrink-0 rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap hover:opacity-90">처리 요청</button>;
}
