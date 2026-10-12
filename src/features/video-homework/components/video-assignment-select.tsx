"use client";

import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { kstDateOf, kstTimeOf } from "@/lib/date-kst";
import type { AssignableVideo } from "../video-assignment";
import styles from "./video-assignment-select.module.css";

function assignmentLabel(video: AssignableVideo): string {
  if (video.excluded) return "집계 제외";
  if (video.homeworkDate) return `${video.homeworkDate} 배정`;
  // 반만 정해진 영상은 장부에서 날짜를 자동으로 추정할 수 있으므로 미배정으로 단정하지 않는다.
  return video.className ? "숙제일 미지정" : "미배정";
}

export function VideoAssignmentSelect({ videos, value, disabled, onChange }: {
  videos: AssignableVideo[]; value: string; disabled: boolean; onChange: (value: string) => void;
}) {
  const selected = videos.find(video => video.id === value);
  return <Select value={value || null} onValueChange={value => onChange(value ?? "")} disabled={disabled || !videos.length}>
    <SelectTrigger className="w-full" aria-label="영상 선택">
      <span className="truncate">{selected ? `${kstDateOf(selected.postedAt)} ${kstTimeOf(selected.postedAt)} · ${selected.className ?? "반 미지정"} · ${assignmentLabel(selected)}` : "영상을 골라 주세요"}</span>
    </SelectTrigger>
    <SelectContent alignItemWithTrigger={false} align="start" className={styles.popup}>
      {videos.map(video => <SelectItem key={video.id} value={video.id} className={styles.item}
        label={`${kstDateOf(video.postedAt)} ${kstTimeOf(video.postedAt)} ${video.className ?? "반 미지정"} ${assignmentLabel(video)}`}>
        <span className={styles.columns}>
          <span className={styles.date}>{kstDateOf(video.postedAt)} <small>{kstTimeOf(video.postedAt)}</small></span>
          <span className={styles.className}>{video.className ?? "반 미지정"}</span>
          <span className={styles.homework}>{assignmentLabel(video)}</span>
        </span>
      </SelectItem>)}
    </SelectContent>
  </Select>;
}
