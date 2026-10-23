"use client";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { HomeworkVideoPlayer } from "@/features/students/components/homework-video-player";
import { getVideoAssignmentOptions, assignHomeworkVideo } from "../server/video-assignment";
import { isVideoAssignableToDate, type AssignableVideo, type VideoAssignmentOptions } from "../video-assignment";
import type { VideoHomeworkLedgerRow } from "../types";
import { assignmentLabel, VideoAssignmentSelect } from "./video-assignment-select";
import { useLedgerRefresh } from "./ledger-refresh";
import { kstDateOf } from "@/lib/date-kst";

export function VideoAssignmentDialog({ row, initialDate, fromDate, toDate, onClose, linked }: {
  row: VideoHomeworkLedgerRow; fromDate: string; toDate: string; onClose: () => void;
  /** 먼저 골라 둘 숙제일 — 칸 편집 창에서 그 칸에 붙이려고 열었을 때. 목록에 없으면 종전대로 고른다. */
  initialDate?: string;
  /** 장부가 이 줄에 자동으로 붙인 영상(영상 id → 숙제일) — 표기에만 쓴다. */
  linked?: ReadonlyMap<string, string>;
}) {
  const refresh = useLedgerRefresh();
  const [options, setOptions] = useState<VideoAssignmentOptions | null>(null);
  const [videoId, setVideoId] = useState(""); const [picked, setPicked] = useState(""); const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  /** 이 창에서 이미 이 숙제로 고정한 자동 영상 — 둘째 저장이 실패해 다시 누를 때 또 고정하지 않는다. */
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void getVideoAssignmentOptions({ classId: row.classId, studentId: row.studentId, fromDate, toDate }).then(result => { if (active) setOptions(result); })
      .catch(() => { if (active) setOptions({ ok: false, error: "영상 목록을 읽지 못했습니다." }); });
    return () => { active = false; };
  }, [row.classId, row.studentId, fromDate, toDate]);
  // 숙제없음 수업일(원장 2026-10-22 '숙제없음 칸에 바로 배정')엔 **아직 칸에 안 붙은 영상만** — 다른 숙제 칸에 붙은 영상(고른 숙제 · 자동 연결 ·
  // 다른 반 영상)을 옮기면 그 숙제가 다시 미확인·미수행이 되고 미제출 알림이 나간다(적대적 리뷰 2026-10-22). 옮기려면 숙제 날짜에서 고른다.
  const unlinked = (video: AssignableVideo) => !video.excluded && !linked?.has(video.id)
    && (!video.homeworkDate || !row.assignedDates.includes(video.homeworkDate)) && (!video.classId || video.classId === row.classId);
  const fits = (d: string, only = false) => !!options?.ok && options.videos.some(video => (!only || unlinked(video)) && isVideoAssignableToDate(video.postedAt, d));
  // 영상이 들어갈 수 있는 수업일만 늘어놓는다(칸에서 연 날은 늘) — 수업일을 다 늘어놓으면 숙제 목록이 묻힌다. 서버가 같은 판정으로 다시 본다.
  const blankChoices = options?.ok ? (options.blankDates ?? []).filter(d => d === initialDate || fits(d, true)) : [];
  const listed = !!initialDate && options?.ok === true && (options.dates.includes(initialDate) || blankChoices.includes(initialDate));
  // 이 줄에서 이미 영상이 붙은 숙제(자동 연결 · 고른 숙제) — 아직 안 붙은 영상을 받을 빈 숙제를 먼저 고르는 데 쓴다.
  const filled = new Set([...(linked?.values() ?? []), ...(options?.ok
    ? options.videos.flatMap(video => video.homeworkDate && video.classId === row.classId ? [video.homeworkDate] : []) : [])]);
  // 고르기 전 = 칸에서 연 날 → 아직 안 붙은 영상이 들어갈 빈 숙제 → 그 영상이 들어갈 숙제 → 그 영상이 들어갈 숙제없음 수업일 → 영상이 들어갈 첫 숙제.
  // 안 붙은 영상부터 — 최근 숙제를 먼저 고르면 이미 붙은 영상만 보여 "다 배정됐다"로 읽혔다(원장 2026-10-23 이영준 10/15 '숙제 없이 올린' 영상).
  const date = picked || (!options?.ok ? "" : listed ? initialDate! : options.dates.find(d => !filled.has(d) && fits(d, true))
    ?? options.dates.find(d => fits(d, true)) ?? blankChoices.find(d => fits(d, true)) ?? options.dates.find(d => fits(d))
    ?? options.dates[0] ?? blankChoices[0] ?? "");
  const blank = blankChoices.includes(date);
  // 아직 안 붙은 영상을 목록 위로(같은 무리 안은 최신순 그대로).
  const videos = options?.ok ? options.videos.filter(video => date === "exclude"
    ? [...options.dates, ...blankChoices].some(d => isVideoAssignableToDate(video.postedAt, d))
    : isVideoAssignableToDate(video.postedAt, date) && (!blank || unlinked(video)))
    .sort((a, b) => Number(unlinked(b)) - Number(unlinked(a))).slice(0, 100) : [];
  const selected = videos.find(v => v.id === videoId);
  // 옮겨 남긴 숙제 칸(보고서에 영상 과제 표시가 없던 수업)에 붙은 영상(고른 숙제 · 자동 연결)을 옮기면 그 칸에서 영상이 빠진다 — 거두는 길을 미리 알린다.
  const attachedTo = selected ? selected.homeworkDate ?? linked?.get(selected.id) ?? null : null;
  const leavesEmpty = attachedTo && attachedTo !== date && row.kept?.includes(attachedTo) ? attachedTo : null;
  // 같은 숙제에 영상을 더 붙일 때(한 숙제에 여러 개 — 원장 2026-10-21) 그 칸의 대표가 숙제를 고르지 않고 자동으로 붙은 영상이면 그 영상도 이 숙제로
  // 함께 고정한다 — 안 그러면 새로 붙인 영상이 칸의 대표가 되고, 밀려난 자동 영상이 다음 숙제 칸을 거짓으로 채운다(적대적 리뷰 2026-10-21).
  const anchorId = date === "exclude" || !videoId ? undefined : [...(linked ?? [])].find(([id, d]) => d === date && id !== videoId)?.[0];
  const anchor = anchorId && anchorId !== pinnedId && options?.ok ? options.videos.find(v => v.id === anchorId && !v.homeworkDate && !v.excluded) : undefined;
  async function save() {
    if (!selected || busy) return;
    setBusy(true); setError("");
    let changed = !!pinnedId;
    try {
      if (anchor) {
        const pinned = await assignHomeworkVideo({ classId: row.classId, studentId: row.studentId, videoId: anchor.id, homeworkDate: date, excluded: false,
          revision: anchor.revision, reason: `같은 숙제에 영상을 더 붙이며 원래 영상도 고정 — ${reason.trim()}`.slice(0, 300) });
        if (!pinned.ok) { setError(pinned.error ?? "저장하지 못했습니다."); return; }
        // 고정은 저장됐다 — 다시 누를 때 낡은 버전으로 또 고정하지 않는다(재리뷰: 매번 '다른 곳에서 변경됐습니다'가 떴다).
        setPinnedId(anchor.id); changed = true;
      }
      const result = await assignHomeworkVideo({ classId: row.classId, studentId: row.studentId, videoId,
        homeworkDate: date === "exclude" ? null : date, excluded: date === "exclude", revision: selected.revision, reason });
      if (!result.ok) {
        setError(result.error ?? "저장하지 못했습니다.");
        // 고정만 되고 이 영상은 실패했으면 장부를 새로 읽는다(바뀐 것이 화면에 남게).
        if (changed) refresh();
      } else { refresh(); onClose(); }
    } catch { setError("연결을 확인한 뒤 다시 시도해 주세요."); if (changed) refresh(); } finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" showCloseButton={!busy}>
      <DialogHeader><DialogTitle>{row.studentName} · 영상 숙제 배정</DialogTitle>
        <DialogDescription>{row.className}의 숙제에 영상을 연결합니다. 같은 과목이면 이 학생의 다른 반에 잘못 올라간 영상도 고를 수 있습니다(확실히 다른 과목인 영상은 보이지 않습니다).</DialogDescription></DialogHeader>
      {!options ? <p role="status">영상 목록을 읽는 중…</p> : !options.ok ? <p role="alert">{options.error}</p> : !options.dates.length && !blankChoices.length ? <p>조회 기간에 영상을 붙일 숙제나 수업일이 없습니다.</p> : <div className="space-y-4 text-sm">
        <label className="block space-y-1"><span>배정할 영상 숙제</span><select className="border-line w-full rounded border p-2" value={date} disabled={busy} onChange={e => { setPicked(e.target.value); setVideoId(""); setError(""); }}>
          {options.dates.map(d => <option key={d} value={d}>{row.className} · {d}</option>)}
          {blankChoices.map(d => <option key={`blank:${d}`} value={d}>{row.className} · {d} · 숙제없음 수업</option>)}
          <option value="exclude">숙제 완료 집계에서 제외</option>
        </select></label>
        {initialDate && !listed ? <p className="text-text-dim text-xs break-keep">{initialDate}은(는) 고를 수 있는 숙제·수업일이 아니어서 다른 날짜를 골라 두었습니다(그날 출결·시간표를 확인해 주세요).</p> : null}
        {blank ? <p className="bg-bg-soft rounded-md px-3 py-2 break-keep">영상 숙제가 없던 수업입니다. 붙이면 이 날짜가 영상 숙제 칸으로 서고 이 영상으로 완료됩니다(학생에게 새 숙제가 나가지 않습니다). 아직 숙제에 안 붙은 영상만 보입니다.{date < fromDate ? " 조회 기간 밖 날짜라 붙인 뒤에는 그 기간을 조회해야 칸이 보입니다." : ""}</p> : null}
        <div className="space-y-1"><p>영상 선택{videos.length ? ` (${videos.length}개)` : ""}</p>
          <VideoAssignmentSelect key={date} videos={videos} value={videoId} disabled={busy} onChange={setVideoId} linked={linked} rowClassId={row.classId} />
          <p className="text-text-dim text-xs">{date === "exclude" ? "조회 기간의 각 숙제·수업일부터" : blank ? "선택한 수업일부터" : "선택한 숙제를 낸 날부터"} 14일 뒤까지 게시된 영상만 표시합니다. 최대 100개까지 최신순으로 보여 줍니다.</p>
          {!videos.length ? <p role="status">이 기간에 배정할 수 있는 업로드 완료 영상이 없습니다.</p>
            : !selected ? <p className="text-text-dim text-xs">영상을 고르면 아래에서 바로 재생해 볼 수 있습니다. 저장을 누르기 전에는 아무것도 바뀌지 않습니다.</p> : null}
        </div>
        {selected ? <div className="space-y-2"><p>현재 연결: {selected.className ?? "반 미지정"} · {assignmentLabel(selected, linked, row.classId)}{selected.postId ? ` · 게시물 ${selected.postId}` : ""}</p>
          {selected.note ? <p className="bg-bg-soft rounded-md px-3 py-2 break-keep">학생 메모: {selected.note}</p> : null}
          {leavesEmpty ? <p className="bg-bg-soft rounded-md px-3 py-2 break-keep">이 영상은 지금 {leavesEmpty} 칸(보고서에 영상 과제 표시가 없던 수업)에 붙어 있습니다. 옮기면 그 칸에서 이 영상이 빠집니다 — 칸에 다른 기록이 없고 필요 없는 칸이면 그 칸을 눌러 {"'숙제 취소'"}로 거둘 수 있습니다.</p> : null}
          {selected.playback ? <HomeworkVideoPlayer key={selected.id} videoId={selected.id} {...selected.playback} title={`${row.studentName} 배정할 영상`} /> : <p>이 영상은 아직 재생할 수 없습니다.</p>}</div> : null}
        <label className="block space-y-1"><span>변경 사유</span><input className="border-line w-full rounded border p-2" value={reason} maxLength={300} disabled={busy} onChange={e => setReason(e.target.value)} placeholder="예: 영어 게시물에 잘못 올린 수학 숙제" /></label>
        {/* 자동으로 붙어 있던 영상도 함께 고정된다는 것을 미리 알린다(재리뷰 — 말없이 고정하면 그 영상을 다른 숙제로 보낼 길을 모른다). */}
        {anchor ? <p className="bg-bg-soft rounded-md px-3 py-2 break-keep">이 숙제에 자동으로 붙어 있던 영상({kstDateOf(anchor.postedAt)} 올림)도 이 숙제로 함께 고정됩니다. 다른 숙제 영상이면 먼저 그 영상을 옮겨 주세요.</p> : null}
        <p className="text-text-dim">저장하면 영상의 기존 연결이 바뀝니다. 수행 상태는 실제 영상과 제출 기한에 따라 갱신됩니다. 변경 전후와 처리자를 기록합니다.</p>
        {error ? <p role="alert" className="text-danger">{error}</p> : null}
        <Button disabled={busy || !selected || !date || !reason.trim()} onClick={() => void save()}>{busy ? "저장 중…" : "영상 배정 저장"}</Button>
      </div>}
    </DialogContent>
  </Dialog>;
}
