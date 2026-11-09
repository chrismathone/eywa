/**
 * 수업보고서 **영상 첨부**(원장 2026-11-06 *"eie 일일이랑 월간에 첨부파일 붙이고 클래스노트 발송 테스트"*) — 순수 규약.
 * 서버(attachment-actions)·클라(영상 넣기 버튼)·발송 PC(scripts/_classnote/report-video.mjs)가 같은 값을 쓴다.
 *
 * 🔑 ClassNote 알림장은 영상을 **한 개**만 받는다(`attached_video`) — 그래서 보고서 한 장에 영상도 한 개.
 *    영상은 ClassNote 글의 영상 칸으로 따로 올라가고, 보고서 그림(스크린샷)은 그 아래 이미지로 붙는다.
 * ⚠️ 보고서 그림에는 영상이 찍히지 않는다(visibleAttachments는 그림만 남긴다).
 */

/** 영상 확장자 — 발송 PC의 `VIDEO_NAME_RE`(report-video.mjs)와 같은 집합. */
export const REPORT_VIDEO_EXTS = ["mp4", "mov", "m4v"] as const;

/** 고를 수 있는 영상 형식(휴대폰 영상 = mp4 · 아이폰 mov). */
export const REPORT_VIDEO_ACCEPT = "video/mp4,video/quicktime,video/x-m4v";

/** 영상 한 개 상한 — 100MB. 저장소 버킷 상한(report-attachments)도 이 값이어야 한다(scripts/setup-storage.ts). */
export const REPORT_VIDEO_MAX_BYTES = 100 * 1024 * 1024;

/** 영상 아닌 첨부(사진·문서) 상한 — 종전 그대로 20MB. */
export const REPORT_FILE_MAX_BYTES = 20 * 1024 * 1024;

/** 보고서 한 장에 붙일 수 있는 영상 수(ClassNote 글 하나 = 영상 하나). */
export const REPORT_VIDEO_MAX_COUNT = 1;

export function isReportVideoCT(ct: string): boolean {
  return ct === "video/mp4" || ct === "video/quicktime" || ct === "video/x-m4v";
}

/** 영상 형식 → 확장자(이름에 확장자가 없는 영상도 경로·이름이 영상으로 읽히게 — 판정은 어디서나 이름이 기준). */
export function videoExtOf(ct: string): string | null {
  if (ct === "video/mp4") return "mp4";
  if (ct === "video/quicktime") return "mov";
  if (ct === "video/x-m4v") return "m4v";
  return null;
}

/** 영상 이름을 영상 확장자로 끝나게 — 이미 그렇면 그대로. */
export function withVideoExt(name: string, ct: string): string {
  if (isVideoAttachment(name)) return name;
  return `${name || "영상"}.${videoExtOf(ct) ?? "mp4"}`;
}

/** 파일명(또는 경로)이 영상인가 — 확장자로 본다. */
export function isVideoAttachment(nameOrPath: string): boolean {
  const base = nameOrPath.split("?")[0]!;
  const dot = base.lastIndexOf(".");
  if (dot < 0) return false; // 확장자 없음 = 영상 아님(발송 PC `VIDEO_NAME_RE`와 같은 판정)
  return (REPORT_VIDEO_EXTS as readonly string[]).includes(base.slice(dot + 1).toLowerCase());
}

/** 이 첨부 목록에 영상이 이미 있나(이름 또는 경로). */
export function hasVideoAttachment(list: readonly { name?: string | null; path: string }[] | null | undefined): boolean {
  return (list ?? []).some((a) => isVideoAttachment(a.name || a.path));
}
