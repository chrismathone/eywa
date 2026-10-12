"use client";

import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { kstDateOf, kstTimeOf } from "@/lib/date-kst";
import type { AssignableVideo } from "../video-assignment";
import styles from "./video-assignment-select.module.css";

export function VideoAssignmentSelect({ videos, value, disabled, onChange }: {
  videos: AssignableVideo[]; value: string; disabled: boolean; onChange: (value: string) => void;
}) {
  const selected = videos.find(video => video.id === value);
  return <Select value={value || null} onValueChange={value => onChange(value ?? "")} disabled={disabled || !videos.length}>
    <SelectTrigger className="w-full" aria-label="영상 선택">
      <span className="truncate">{selected ? `${kstDateOf(selected.postedAt)} ${kstTimeOf(selected.postedAt)} · ${selected.className ?? "반 미지정"}` : "영상을 골라 주세요"}</span>
    </SelectTrigger>
    <SelectContent alignItemWithTrigger={false} align="start" className={styles.popup}>
      <div className={styles.heading} aria-hidden="true"><span>게시일</span><span>반</span><span>연결된 숙제</span></div>
      {videos.map(video => <SelectItem key={video.id} value={video.id} className={styles.item}
        label={`${kstDateOf(video.postedAt)} ${kstTimeOf(video.postedAt)} ${video.className ?? "반 미지정"}`}>
        <span className={styles.columns}>
          <span className={styles.date}>{kstDateOf(video.postedAt)}<small>{kstTimeOf(video.postedAt)}</small></span>
          <span className={styles.className}>{video.className ?? "반 미지정"}</span>
          <span className={styles.homework}>{video.excluded ? "집계 제외" : video.homeworkDate ?? "날짜 미지정"}</span>
        </span>
      </SelectItem>)}
    </SelectContent>
  </Select>;
}
