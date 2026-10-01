/**
 * 숙제 영상 **제출 링크** 순수 규칙 — 공개 업로드 화면(클라)·서버·테스트가 같이 쓴다(`server-only` 금지, [[#61]]).
 *
 * 원장 2026-10-01 *"가장 베스트네"* — 학부모가 ClassNote에 올리기 힘든 숙제 영상을 aywa 링크로 바로 올린다.
 * 링크 = 학생 × 반 · 7일(원장 *"링크는 일주일 후에 소멸"*) · 영상은 그 반 담임 Drive 폴더로(워커 자동 업로드와 같은 이름).
 */
import { HOMEWORK_VIDEO_MAX_BYTES, HOMEWORK_VIDEO_MAX_LABEL } from "@/features/students/homework-video-limits";
import { shareExpiryDate } from "@/features/onescreen/share-expiry";
import { VIDEO_SUBMIT_LINK_DAYS } from "@/features/link-expired/kinds";

/** 토큰 = 32바이트 난수의 base64url(43자). 모양이 다르면 DB를 묻지도 않는다. */
export const SUBMIT_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const isSubmitTokenShape = (value: unknown): value is string =>
  typeof value === "string" && SUBMIT_TOKEN_RE.test(value);

/** 공개 화면의 학생 이름 — 가운데를 가린다(김민수 → 김*수, 이준 → 이*, 한 글자 → *). 링크가 새어도 실명이 통째로 보이지 않게. */
export function maskStudentName(name: string | null | undefined): string {
  const chars = [...String(name ?? "").trim()];
  if (chars.length <= 1) return chars.length ? "*" : "학생";
  if (chars.length === 2) return `${chars[0]}*`;
  return `${chars[0]}${"*".repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}

/** 받는 영상 형식 → Drive 파일 확장자. 폰 기본 촬영(iPhone .mov · 안드로이드 .mp4)이 다 들어간다. */
const EXT_BY_MIME: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/x-m4v": ".m4v",
  "video/webm": ".webm",
  "video/3gpp": ".3gp",
  "video/3gpp2": ".3g2",
  "video/x-matroska": ".mkv",
  "video/mpeg": ".mpeg",
  "video/x-msvideo": ".avi",
};
/** 형식이 비어 오는 폰 파일(일부 안드로이드)을 위한 확장자 → 형식. */
const MIME_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_BY_MIME).map(([mime, ext]) => [ext, mime]).concat([[".mpg", "video/mpeg"]]),
);

export type VideoFileCheck = { ok: true; mimeType: string; ext: string } | { ok: false; error: string };

/**
 * 고른 파일을 받을 수 있나 — 영상 형식만 · 1GB까지([`HOMEWORK_VIDEO_MAX_BYTES`] 한 값).
 * 서버도 같은 함수로 다시 본다(화면 판정은 게이트가 아니다, [[#77]]).
 */
export function checkVideoFile(file: { size?: unknown; type?: unknown; name?: unknown }): VideoFileCheck {
  const size = Number(file.size);
  if (!Number.isSafeInteger(size) || size <= 0) return { ok: false, error: "빈 파일은 올릴 수 없습니다." };
  if (size > HOMEWORK_VIDEO_MAX_BYTES)
    return { ok: false, error: `영상은 ${HOMEWORK_VIDEO_MAX_LABEL}까지 올릴 수 있습니다. 더 짧게 찍거나 화질을 낮춰 다시 골라 주세요.` };
  const rawType = String(file.type ?? "").split(";")[0]!.trim().toLowerCase();
  // 형식을 못 알아본 폰 파일은 빈 값이나 octet-stream으로 온다 — 그때만 확장자로 판정한다.
  const type = rawType === "application/octet-stream" ? "" : rawType;
  const ext = /\.[A-Za-z0-9]{2,5}$/.exec(String(file.name ?? ""))?.[0]?.toLowerCase() ?? "";
  // 🔴 형식·확장자는 **위 목록에서만** 정한다 — 목록 밖 `video/*`에 파일 이름의 확장자를 그대로 쓰면 `.exe`·`.bat`가
  //    "영상"으로 담임 Drive 폴더에 들어간다(적대 리뷰 2026-10-01). 목록 밖 영상 형식은 받지 않는다.
  //    목록 밖 별칭(`video/avi` 등)은 확장자가 목록에 있을 때만 그 확장자의 형식으로 맞춘다(값은 여전히 목록에서만 나온다).
  const byExt = MIME_BY_EXT[ext];
  const mimeType = EXT_BY_MIME[type] ? type : byExt && (!type || type.startsWith("video/")) ? byExt : "";
  if (!mimeType) {
    const error = type.startsWith("video/") ? "이 영상 형식은 올릴 수 없습니다. 휴대폰 카메라로 찍은 영상(mp4·mov)을 골라 주세요." : "영상 파일만 올릴 수 있습니다.";
    return { ok: false, error };
  }
  return { ok: true, mimeType, ext: EXT_BY_MIME[mimeType]! };
}

/**
 * 링크가 끝나는 순간 = 기준일 + 7일째 **하루가 끝난 뒤**(그날 자정, KST). 기준일 = 보고서에 붙는 링크는 보고서일,
 * 학생 상세에서 만든 링크는 만든 날(KST). 날짜 산술은 공유 보고서 링크(`shareExpiryDate`, UTC date 산술)와 같다 —
 * 7일째 당일까지 쓸 수 있고 그다음 날부터 만료(`isShareExpired(기준일, 오늘, 7)`과 같은 경계).
 */
export function videoLinkExpiresAt(baseDate: string): string {
  return `${shareExpiryDate(baseDate, VIDEO_SUBMIT_LINK_DAYS + 1)}T00:00:00+09:00`;
}

/** 마지막으로 쓸 수 있는 날(KST, 화면 표기용). */
export const videoLinkLastDay = (baseDate: string): string => shareExpiryDate(baseDate, VIDEO_SUBMIT_LINK_DAYS);

/** 만료됐나 — 끝나는 순간을 못 읽으면 만료로 본다(모르는 링크를 열어 두지 않는다). */
export function isVideoLinkExpired(expiresAt: string | null | undefined, nowMs: number = Date.now()): boolean {
  const end = Date.parse(String(expiresAt ?? ""));
  return !Number.isFinite(end) || nowMs >= end;
}
