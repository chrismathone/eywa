"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { homeworkVideoLinks, HOMEWORK_VIDEO_STATUS, type HomeworkVideo } from "@/features/students/homework-videos";
import { HomeworkVideoPlayer } from "./homework-video-player";

const dateLabel = (value: string | null) => value
  ? new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
  : "제출일 미확인";

/** `showDriveLink` = 관리자뷰일 때만 'Drive 열기'(원장 2026-10-01 *"drive 열기는 관리자뷰에서만"*). */
export function HomeworkVideosView({ rows, subjectLabels, showDriveLink, initialVideoId = null }: {
  rows: HomeworkVideo[]; subjectLabels: Record<string, string>; showDriveLink: boolean;
  /** 영상 제출 현황의 ▶가 넘긴 `?video=` — 이 학생의 영상 목록에 있는 id만 미리 고른다(없는 id·남의 영상 id는 무시). */
  initialVideoId?: string | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(() => rows.some((row) => row.id === initialVideoId) ? initialVideoId : null);
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const links = homeworkVideoLinks(selected?.drive_file_id ?? null);
  const groups = new Map<string, HomeworkVideo[]>();
  for (const row of rows) {
    const key = row.subject ?? "";
    const list = groups.get(key) ?? [];
    list.push(row); groups.set(key, list);
  }
  const subjectLabel = (key: string | null) => key ? subjectLabels[key] ?? "기타 과목" : "과목 미분류";
  if (!rows.length) return <div className="border-line rounded-xl border p-6 text-sm">
    <p className="font-bold">아직 보관된 숙제 영상이 없습니다.</p>
    <p className="mt-2">클래스노트에 올린 학부모 영상이 수집되면 과목별로 표시됩니다.</p>
  </div>;
  return <div className="space-y-4">
    <p className="text-sm">숙제 영상 <strong className="num">{rows.length}</strong>개 · 영상을 선택하면 바로 볼 수 있습니다.</p>
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(280px,1fr)_minmax(0,2fr)]">
      <div className="min-w-0 space-y-5">
        {[...groups].map(([key, items]) => <section key={key} aria-label={`${subjectLabel(key)} 숙제 영상`}>
          <h3 className="border-line border-b pb-2 text-base font-bold">{subjectLabel(key)} <span className="num text-sm">{items.length}개</span></h3>
          <ul className="divide-line divide-y">
            {items.map((row) => {
              const rowLinks = homeworkVideoLinks(row.drive_file_id);
              const playable = row.status === "uploaded" && !!rowLinks;
              return <li key={row.id} className="flex items-center gap-3 py-3">
                <button type="button" disabled={!playable} onClick={() => setSelectedId(row.id)} aria-pressed={selectedId === row.id}
                  className={`min-w-0 flex-1 rounded-lg p-2 text-left focus-visible:outline-2 focus-visible:outline-primary ${selectedId === row.id ? "bg-primary/10" : "hover:bg-muted"}`}>
                  <span className="block text-sm font-bold">{dateLabel(row.posted_at)}</span>
                  <span className="mt-1 block text-xs">{row.comment_id ? "학부모 댓글" : "학부모 글"} · {HOMEWORK_VIDEO_STATUS[row.status]}</span>
                </button>
                {playable && showDriveLink ? <a href={rowLinks.view} target="_blank" rel="noopener noreferrer" className="shrink-0 text-sm text-primary underline underline-offset-4">Drive 열기</a> : null}
              </li>;
            })}
          </ul>
        </section>)}
      </div>
      <div className="min-w-0 lg:sticky lg:top-4">
        {selected && links ? <section className="space-y-3" aria-label="숙제 영상 뷰어">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-bold">{subjectLabel(selected.subject)} · {dateLabel(selected.posted_at)}</h3>
            <Button type="button" variant="outline" onClick={() => setSelectedId(null)}>닫기</Button>
          </div>
          <HomeworkVideoPlayer key={selected.id} preview={links.preview} thumbnail={links.thumbnail} uploadedAt={selected.uploaded_at}
            title={`${subjectLabel(selected.subject)} 숙제 영상 ${dateLabel(selected.posted_at)}`} />
        </section> : <div className="border-line flex aspect-video items-center justify-center rounded-xl border bg-muted/30 p-6 text-sm">목록에서 재생할 영상을 선택하세요.</div>}
      </div>
    </div>
  </div>;
}
