"use client";

import { SheetText } from "@/features/teacher-view/interface-label";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { homeworkVideoLinks, homeworkVideoOrigin, HOMEWORK_VIDEO_STATUS, type HomeworkVideo } from "@/features/students/homework-videos";
import { HomeworkVideoPlayer } from "@/features/students/components/homework-video-player";

const dateLabel = (value: string | null, dateOnly = false) => value
  ? new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    ...(dateOnly ? {} : { hour: "2-digit", minute: "2-digit" }) })
  : "제출일 미확인";
/** 직접 제출 영상의 게시 시각은 파일 이름의 날짜(정오로 둔 값)뿐이라 시각을 보이지 않는다. */
const rowDate = (row: Pick<HomeworkVideo, "posted_at" | "source">) => dateLabel(row.posted_at, row.source === "drive");

/** 영상은 이 화면에서만 재생한다 — Drive로 나가는 링크는 두지 않는다(원장 2026-10-04, 10-01의 "관리자뷰에서만 Drive 열기"를 거뒀다). */
export function HomeworkVideosView({ rows, subjectLabels, initialVideoId = null }: {
  rows: HomeworkVideo[]; subjectLabels: Record<string, string>;
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
    <p className="font-bold"><SheetText value={"아직 보관된 숙제 영상이 없습니다."} /></p>
    <p className="mt-2"><SheetText value={"클래스노트에 올린 학부모 영상이나 담임 폴더에 직접 올린 영상이 들어오면 과목별로 표시됩니다."} /></p>
  </div>;
  return <div className="space-y-4">
    <p className="text-sm"><SheetText value={"숙제 영상 "} /><strong className="num">{rows.length}</strong><SheetText value={"개 · 영상을 선택하면 바로 볼 수 있습니다."} /></p>
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(280px,1fr)_minmax(0,2fr)]">
      <div className="min-w-0 space-y-5">
        {[...groups].map(([key, items]) => <section key={key} aria-label={`${subjectLabel(key)} 숙제 영상`}>
          <h3 className="border-line border-b pb-2 text-base font-bold">{subjectLabel(key)} <span className="num text-sm">{items.length}<SheetText value={"개"} /></span></h3>
          <ul className="divide-line divide-y">
            {items.map((row) => {
              const rowLinks = homeworkVideoLinks(row.drive_file_id);
              const playable = row.status === "uploaded" && !!rowLinks;
              return <li key={row.id} className="flex items-center gap-3 py-3">
                <button type="button" disabled={!playable} onClick={() => setSelectedId(row.id)} aria-pressed={selectedId === row.id}
                  className={`min-w-0 flex-1 rounded-lg p-2 text-left focus-visible:outline-2 focus-visible:outline-primary ${selectedId === row.id ? "bg-primary/10" : "hover:bg-muted"}`}>
                  <span className="block text-sm font-bold">{rowDate(row)}</span>
                  <span className="mt-1 block text-xs">{homeworkVideoOrigin(row)} · {HOMEWORK_VIDEO_STATUS[row.status] ?? "확인 중"}</span>
                </button>
              </li>;
            })}
          </ul>
        </section>)}
      </div>
      <div className="min-w-0 lg:sticky lg:top-4">
        {selected && links ? <section className="space-y-3" aria-label="숙제 영상 뷰어">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-bold">{subjectLabel(selected.subject)} · {rowDate(selected)}</h3>
            <Button type="button" variant="outline" onClick={() => setSelectedId(null)}><SheetText value={"닫기"} /></Button>
          </div>
          <HomeworkVideoPlayer key={selected.id} videoId={selected.id} preview={links.preview} thumbnail={links.thumbnail} uploadedAt={selected.uploaded_at}
            title={`${subjectLabel(selected.subject)} 숙제 영상 ${rowDate(selected)}`} />
        </section> : <div className="border-line flex aspect-video items-center justify-center rounded-xl border bg-muted/30 p-6 text-sm"><SheetText value={"목록에서 재생할 영상을 선택하세요."} /></div>}
      </div>
    </div>
  </div>;
}
