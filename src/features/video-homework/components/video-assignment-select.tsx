"use client";

import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { kstDateOf, kstTimeOf } from "@/lib/date-kst";
import type { AssignableVideo } from "../video-assignment";
import styles from "./video-assignment-select.module.css";

const shortDate = (date: string) => date.slice(5).replace("-", ".");
/**
 * 이 영상이 지금 어느 숙제에 붙어 있나(원장 2026-10-13 — "2026-10-08 배정"이 "10/8에 배정한 날"로 읽혀 바꿨다).
 * `linked` = 장부가 게시일 순서로 자동으로 붙인 숙제일(영상 id → 숙제일) — 숙제를 고르지 않은 영상도 칸에 붙어 있으면 그렇게 말한다.
 */
export function assignmentLabel(video: Pick<AssignableVideo, "id" | "excluded" | "homeworkDate" | "classId" | "free">, linked?: ReadonlyMap<string, string>, rowClassId?: string): string {
  if (video.excluded) return "집계 제외";
  if (video.homeworkDate) return `${shortDate(video.homeworkDate)} 숙제에 연결됨`;
  // 같은 과목 다른 반으로 분류된 영상 — 이 줄의 칸만 아는 자동 연결로는 그 반에서 어떤지 모른다.
  if (video.classId && rowClassId && video.classId !== rowClassId) return "다른 반 영상";
  const auto = linked?.get(video.id);
  if (auto) return `${shortDate(auto)} 숙제에 자동 연결됨`;
  // "이 기간 숙제엔 안 붙음"은 "이 기간 숙제엔 붙일 수 없다"로 읽혔다(원장 2026-10-15 — 하은결 10/14 영상) → 짧게 사실만.
  // 숙제를 고르지 않고 올린 영상은 장부가 자동으로 붙이지 않는다(rounds.ts ②) — 왜 안 붙었는지를 그대로 말한다.
  // 자동 연결(`linked`)은 기간 밖 숙제까지 본다(video-homework-management.tsx) — 장부가 읽는 범위(최근 60일 + 2주) 안에서는 정확하다.
  return video.free ? "숙제 없이 올림" : "연결 안 됨";
}

export function VideoAssignmentSelect({ videos, value, disabled, onChange, linked, rowClassId }: {
  videos: AssignableVideo[]; value: string; disabled: boolean; onChange: (value: string) => void; linked?: ReadonlyMap<string, string>; rowClassId?: string;
}) {
  const selected = videos.find(video => video.id === value);
  return <Select value={value || null} onValueChange={value => onChange(value ?? "")} disabled={disabled || !videos.length}>
    <SelectTrigger className="w-full" aria-label="영상 선택">
      <span className="truncate">{selected ? `${kstDateOf(selected.postedAt)} ${kstTimeOf(selected.postedAt)} · ${selected.className ?? "반 미지정"} · ${assignmentLabel(selected, linked, rowClassId)}${selected.note ? ` · ${selected.note}` : ""}` : "영상을 골라 주세요"}</span>
    </SelectTrigger>
    <SelectContent alignItemWithTrigger={false} align="start" className={styles.popup}>
      {videos.map(video => <SelectItem key={video.id} value={video.id} className={styles.item}
        label={`${kstDateOf(video.postedAt)} ${kstTimeOf(video.postedAt)} ${video.className ?? "반 미지정"} ${assignmentLabel(video, linked, rowClassId)}${video.note ? ` ${video.note}` : ""}`}>
        <span className={styles.columns}>
          <span className={styles.date}>{kstDateOf(video.postedAt)} <small>{kstTimeOf(video.postedAt)}</small></span>
          <span className={styles.className}>{video.className ?? "반 미지정"}</span>
          <span className={styles.homework}>{assignmentLabel(video, linked, rowClassId)}</span>
          {/* 학생이 남긴 메모(숙제 없이 올린 영상) — 학생이 쓴 글이라 글자로만 보여 준다. 격자의 한 줄을 통째로 쓴다. */}
          {video.note ? <span className={styles.note}>학생 메모: {video.note}</span> : null}
        </span>
      </SelectItem>)}
    </SelectContent>
  </Select>;
}
