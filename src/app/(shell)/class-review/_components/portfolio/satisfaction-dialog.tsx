"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { StoredPeriod } from "@/features/teacher-portfolio/model/types";
import {
  addSatisfactionClaim, cancelSatisfactionClaim, decideJudgment, loadSatisfactionBoard, refreshAfterSatisfaction, type SatisfactionBoard,
} from "@/features/teacher-portfolio/server/satisfaction-actions";
import { dayLabel, monthName } from "@/features/teacher-portfolio/view";
import { kstToday } from "@/lib/date-kst";
import { SectionTitle } from "./parts";

/**
 * 학부모 만족도 관리(계획서 3번 · 원장 결정 8 *"확실한 것은 즉시, 애매한 것은 확인 후"*) — 확인 대기 글 반영/무시 · 반영한 글 취소 ·
 * 클레임·칭찬 넣기/취소. 기록은 지우지 않는다(취소로 남긴다). 열 때 DB에서 다시 읽는다(포트폴리오 행은 다시 매기기 전엔 옛 값).
 * 점수는 창을 닫을 때 한 번 다시 매긴다(바꾼 게 있을 때만). 마감한 달은 서버가 막는다.
 */
export function SatisfactionDialog({ open, onClose, period, teacherId, teacherName }: {
  open: boolean; onClose: () => void; period: StoredPeriod; teacherId: string; teacherName: string;
}) {
  const router = useRouter();
  const [board, setBoard] = useState<SatisfactionBoard | null>(null);
  const [version, setVersion] = useState(0);
  const [pending, start] = useTransition();
  const [claim, setClaim] = useState({ day: "", points: "", content: "" });
  const [changed, setChanged] = useState(false);
  const metric = period.items.find((m) => m.id === "satisfaction");
  const appliedIds = (Array.isArray(metric?.detail) ? (metric!.detail as { key: string; source: string; waiting: boolean }[]) : [])
    .filter((r) => r.source === "글" && !r.waiting).map((r) => r.key);
  const idsKey = appliedIds.join(",");
  useEffect(() => {
    if (!open) return;
    let live = true;
    loadSatisfactionBoard(teacherId, period.month, idsKey ? idsKey.split(",") : []).then(
      (r) => { if (live) setBoard(r); },
      () => { if (live) setBoard({ ok: false, error: "불러오지 못했습니다. 잠시 후 다시 열어 주세요" }); },
    );
    return () => { live = false; };
  }, [open, teacherId, period.month, idsKey, version]);
  const ok = board?.ok ? board : null;
  const closed = Boolean(period.closing.closedAt) || (ok ? period.month < ok.floor : false);
  const run = (task: () => Promise<{ ok: boolean; error?: string; notice?: string }>) => start(async () => {
    setChanged(true); // 응답 전에 창을 닫아도 다시 매기게(저장은 이미 출발했다)
    const r = await task();
    if (!r.ok) { toast.error(r.error ?? "저장하지 못했습니다"); return; }
    toast.success(r.notice ?? "저장했습니다");
    setVersion((v) => v + 1);
  });
  // 바꾼 게 있으면 닫을 때 한 번 다시 매긴다 — 클릭마다 지점 전체 집계를 돌리지 않는다.
  const close = () => {
    onClose();
    if (!changed) return;
    void refreshAfterSatisfaction().then((r) => { if (r.ok) { toast.success("점수를 다시 매기고 있습니다 — 1분쯤 뒤 새로고침하면 반영됩니다"); router.refresh(); } });
  };
  const points = Number(claim.points);
  const claimReady = /^\d{4}-\d{2}-\d{2}$/.test(claim.day) && claim.day.startsWith(period.month) && Number.isFinite(points) && points !== 0 && claim.content.trim() !== "";
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent showCloseButton={false} className="flex max-h-[min(90dvh,52rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <div className="border-line flex items-center justify-between gap-3 border-b px-5 py-3.5">
          <DialogTitle className="text-base font-bold">학부모 만족도 · {teacherName} · {monthName(period.month)}</DialogTitle>
          <DialogClose aria-label="닫기" className="hover:bg-muted focus-visible:outline-primary rounded-lg p-1.5 focus-visible:outline-2"><EyIcon name="close" size={18} /></DialogClose>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" aria-busy={pending}>
          {!board ? <p role="status" className="text-sm">불러오는 중…</p> : !board.ok ? <p role="alert" className="text-danger text-sm">{board.error}</p>
            : board.tableMissing ? <p role="status" className="bg-amber-soft rounded-lg px-3.5 py-2.5 text-sm">학부모 만족도 저장 표가 아직 준비되지 않았습니다(DB 반영 전).</p> : null}
          {ok && !ok.tableMissing ? (
            <>
              <SectionTitle sub={`${ok.queueMore ? `${ok.queue.length}건 넘음` : `${ok.queue.length}건`} · 학원 전체 · 마감 안 한 달`}>확인 대기</SectionTitle>
              <p className="mb-1 text-xs">과목을 모르는 보드의 글은 그날 담임이 한 명일 때만 그 담임에게 셉니다.</p>
              {ok.queue.length ? (
                <ul className="divide-line-faint divide-y">
                  {ok.queue.map((q) => (
                    <li key={q.id} className="space-y-1.5 py-3">
                      <p className="text-xs">{dayLabel(q.day)} · {q.student}{q.board ? ` · ${q.board}` : ""} · {q.ai ? `AI 제안 ${q.verdict === "plus" ? "가점" : q.verdict === "minus" ? "감점" : "없음"}` : "문구 판정 애매"}{q.reason ? ` (${q.reason})` : ""}</p>
                      <p className="text-sm break-keep whitespace-pre-wrap">{q.content || "(내용 없음)"}</p>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => decideJudgment(q.id, "plus"))}>가점 반영</Button>
                        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => decideJudgment(q.id, "minus"))}>감점 반영</Button>
                        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(() => decideJudgment(q.id, "dismiss"))}>무시</Button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm">확인할 글이 없습니다.</p>}
              <SectionTitle sub={`${ok.applied.length}건`}>이 달 반영한 글</SectionTitle>
              {ok.applied.length ? (
                <ul className="divide-line-faint divide-y">
                  {ok.applied.map((a) => (
                    <li key={a.id} className="flex items-start justify-between gap-3 py-2.5">
                      <span className="min-w-0 text-sm"><small className="block text-xs">{dayLabel(a.day)} · {a.student} · {a.verdict === "plus" ? "가점" : "감점"}{a.phrase ? ` · “${a.phrase}”` : ""}</small>{a.content}</span>
                      <Button type="button" size="sm" variant="ghost" disabled={pending || closed} onClick={() => run(() => decideJudgment(a.id, "cancel"))}>반영 취소</Button>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm">이 달 반영한 글이 없습니다.</p>}
              <SectionTitle sub="학원으로 온 클레임·칭찬 — 원장이 직접 넣는다">클레임·칭찬</SectionTitle>
              <ul className="divide-line-faint divide-y">
                {ok.claims.map((c) => (
                  <li key={c.id} className={`flex items-start justify-between gap-3 py-2.5 ${c.cancelled ? "text-text-dim line-through" : ""}`}>
                    <span className="min-w-0 text-sm"><small className="block text-xs">{dayLabel(c.day)} · {c.points > 0 ? "+" : ""}{c.points}점</small>{c.content}</span>
                    {c.cancelled ? <small className="text-xs no-underline">취소됨</small>
                      : <Button type="button" size="sm" variant="ghost" disabled={pending || closed} onClick={() => run(() => cancelSatisfactionClaim(c.id))}>취소</Button>}
                  </li>
                ))}
              </ul>
              {closed ? <p className="mt-2 text-xs">마감한 달이라 클레임을 넣거나 취소해도 점수가 바뀌지 않아 막아 두었습니다.</p> : (
                <fieldset disabled={pending} className="mt-3 grid gap-2 sm:grid-cols-[10rem_7rem_minmax(0,1fr)_auto]">
                  <Input type="date" aria-label="날짜" value={claim.day} min={`${period.month}-01`} max={period.end > kstToday() ? kstToday() : period.end} onChange={(e) => setClaim((c) => ({ ...c, day: e.target.value }))} />
                  <Input aria-label="점수(±)" inputMode="decimal" placeholder="-2 또는 1" className="num text-right" value={claim.points} onChange={(e) => setClaim((c) => ({ ...c, points: e.target.value }))} />
                  <Input aria-label="내용" maxLength={500} placeholder="클레임·칭찬 내용" value={claim.content} onChange={(e) => setClaim((c) => ({ ...c, content: e.target.value }))} />
                  <Button type="button" disabled={!claimReady} onClick={() => run(async () => {
                    const r = await addSatisfactionClaim({ teacherId, occurredOn: claim.day, points, content: claim.content });
                    if (r.ok) setClaim({ day: "", points: "", content: "" });
                    return r;
                  })}>넣기</Button>
                </fieldset>
              )}
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
