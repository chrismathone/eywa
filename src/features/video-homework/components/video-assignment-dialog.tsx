"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { HomeworkVideoPlayer } from "@/features/students/components/homework-video-player";
import { getVideoAssignmentOptions, assignHomeworkVideo } from "../server/video-assignment";
import { isVideoAssignableToDate, type VideoAssignmentOptions } from "../video-assignment";
import type { VideoHomeworkLedgerRow } from "../types";
import { assignmentLabel, VideoAssignmentSelect } from "./video-assignment-select";

export function VideoAssignmentDialog({ row, fromDate, toDate, onClose, linked }: {
  row: VideoHomeworkLedgerRow; fromDate: string; toDate: string; onClose: () => void;
  /** 장부가 이 줄에 자동으로 붙인 영상(영상 id → 숙제일) — 표기에만 쓴다. */
  linked?: ReadonlyMap<string, string>;
}) {
  const router = useRouter();
  const [options, setOptions] = useState<VideoAssignmentOptions | null>(null);
  const [videoId, setVideoId] = useState(""); const [date, setDate] = useState(""); const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void getVideoAssignmentOptions({ classId: row.classId, studentId: row.studentId, fromDate, toDate }).then(result => {
      if (!active) return;
      setOptions(result); if (result.ok) setDate(result.dates.find(date => result.videos.some(video => isVideoAssignableToDate(video.postedAt, date))) ?? result.dates[0] ?? "");
    }).catch(() => { if (active) setOptions({ ok: false, error: "영상 목록을 읽지 못했습니다." }); });
    return () => { active = false; };
  }, [row.classId, row.studentId, fromDate, toDate]);
  const videos = options?.ok ? options.videos.filter(video => date === "exclude"
    ? options.dates.some(date => isVideoAssignableToDate(video.postedAt, date)) : isVideoAssignableToDate(video.postedAt, date)).slice(0, 100) : [];
  const selected = videos.find(v => v.id === videoId);
  async function save() {
    if (!selected || busy) return;
    setBusy(true); setError("");
    try {
      const result = await assignHomeworkVideo({ classId: row.classId, studentId: row.studentId, videoId,
        homeworkDate: date === "exclude" ? null : date, excluded: date === "exclude", revision: selected.revision, reason });
      if (!result.ok) setError(result.error ?? "저장하지 못했습니다.");
      else { router.refresh(); onClose(); }
    } catch { setError("연결을 확인한 뒤 다시 시도해 주세요."); } finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" showCloseButton={!busy}>
      <DialogHeader><DialogTitle>{row.studentName} · 영상 숙제 배정</DialogTitle>
        <DialogDescription>{row.className}의 숙제에 영상을 연결합니다. 같은 과목이면 이 학생의 다른 반에 잘못 올라간 영상도 고를 수 있습니다(확실히 다른 과목인 영상은 보이지 않습니다).</DialogDescription></DialogHeader>
      {!options ? <p role="status">영상 목록을 읽는 중…</p> : !options.ok ? <p role="alert">{options.error}</p> : !options.dates.length ? <p>조회 기간에 배정할 영상 숙제가 없습니다.</p> : <div className="space-y-4 text-sm">
        <label className="block space-y-1"><span>배정할 영상 숙제</span><select className="border-line w-full rounded border p-2" value={date} disabled={busy} onChange={e => { setDate(e.target.value); setVideoId(""); setError(""); }}>
          {options.dates.map(d => <option key={d} value={d}>{row.className} · {d}</option>)}<option value="exclude">숙제 완료 집계에서 제외</option>
        </select></label>
        <div className="space-y-1"><p>영상 선택{videos.length ? ` (${videos.length}개)` : ""}</p>
          <VideoAssignmentSelect key={date} videos={videos} value={videoId} disabled={busy} onChange={setVideoId} linked={linked} rowClassId={row.classId} />
          <p className="text-text-dim text-xs">{date === "exclude" ? "조회 기간의 각 숙제를" : "선택한 숙제를"} 낸 날부터 14일 뒤까지 게시된 영상만 표시합니다. 최대 100개까지 최신순으로 보여 줍니다.</p>
          {!videos.length ? <p role="status">이 기간에 배정할 수 있는 업로드 완료 영상이 없습니다.</p>
            : !selected ? <p className="text-text-dim text-xs">영상을 고르면 아래에서 바로 재생해 볼 수 있습니다. 저장을 누르기 전에는 아무것도 바뀌지 않습니다.</p> : null}
        </div>
        {selected ? <div className="space-y-2"><p>현재 연결: {selected.className ?? "반 미지정"} · {assignmentLabel(selected, linked, row.classId)}{selected.postId ? ` · 게시물 ${selected.postId}` : ""}</p>
          {selected.note ? <p className="bg-bg-soft rounded-md px-3 py-2 break-keep">학생 메모: {selected.note}</p> : null}
          {selected.playback ? <HomeworkVideoPlayer key={selected.id} videoId={selected.id} {...selected.playback} title={`${row.studentName} 배정할 영상`} /> : <p>이 영상은 아직 재생할 수 없습니다.</p>}</div> : null}
        <label className="block space-y-1"><span>변경 사유</span><input className="border-line w-full rounded border p-2" value={reason} maxLength={300} disabled={busy} onChange={e => setReason(e.target.value)} placeholder="예: 영어 게시물에 잘못 올린 수학 숙제" /></label>
        <p className="text-text-dim">저장하면 영상의 기존 연결이 바뀝니다. 수행 상태는 실제 영상과 제출 기한에 따라 갱신됩니다. 변경 전후와 처리자를 기록합니다.</p>
        {error ? <p role="alert" className="text-danger">{error}</p> : null}
        <Button disabled={busy || !selected || !date || !reason.trim()} onClick={() => void save()}>{busy ? "저장 중…" : "영상 배정 저장"}</Button>
      </div>}
    </DialogContent>
  </Dialog>;
}
