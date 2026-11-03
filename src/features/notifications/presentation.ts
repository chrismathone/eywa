import type { NotificationItem } from "./types";

export const REPEATED_ABSENCES_LINK = "/dashboard#repeated-absences";

/**
 * 영상 숙제 알림(제출 · 미제출 · 미배정)의 링크는 **강사 화면 주소**로 저장된다(DB 함수가 만든다 — 0409a).
 * 관리자 화면에서 그 주소를 열면 강사뷰가 아니라서 첫 화면으로 돌아간다(원장 2026-10-13 *"알림 누르면 이상한 곳으로 간다"*) →
 * 같은 기간·필터의 관리자용 영상 제출 현황으로 바꿔 연다. 벨(창으로 열 때)과 강사 화면 주소 자체(주소로 들어왔을 때)가 함께 쓴다.
 */
export const TEACHER_VIDEO_LEDGER_PATH = "/onescreen/video-homework";
export const ADMIN_VIDEO_LEDGER_PATH = "/lesson-reports/video-homework";
export function adminVideoLedgerHref(link: string): string {
  const rest = link.slice(TEACHER_VIDEO_LEDGER_PATH.length);
  return link.startsWith(TEACHER_VIDEO_LEDGER_PATH) && (rest === "" || rest[0] === "?" || rest[0] === "#") ? ADMIN_VIDEO_LEDGER_PATH + rest : link;
}

/**
 * 기한 초과 업무 요약 본문(`종류 N · … — 사람 N · … 외 N명`)을 두 줄로 — 종류 셋 · 사람 셋까지(원장 2026-11-02 *"너무 알림이 정신없음"*).
 * 저장된 글은 그대로 두고 보일 때만 줄인다. 모양이 다르면 그대로.
 */
export function compactDigestBody(body: string | null): string | null {
  if (!body) return body;
  const top = (part: string | undefined, unit: string) => {
    if (!part?.trim()) return null;
    const extra = /\s외 (\d+)명$/.exec(part);
    const list = (extra ? part.slice(0, extra.index) : part).split(" · ").map((x) => x.trim()).filter(Boolean);
    const more = Math.max(0, list.length - 3) + (extra ? Number(extra[1]) : 0);
    return `${list.slice(0, 3).join(" · ")}${more > 0 ? ` 외 ${more}${unit}` : ""}`;
  };
  const [kinds, people] = body.split(" — ");
  return [top(kinds, "종"), top(people, "명")].filter(Boolean).join("\n") || body;
}

/** 저장된 알림도 현재 화면 명칭·경로를 사용한다. 당시 학생·건수는 그대로 보존한다. */
export function presentNotification(item: NotificationItem): NotificationItem {
  if (item.type === "staff_task_digest") return { ...item, body: compactDigestBody(item.body) };
  if (item.type !== "absence_alert") return item;
  return {
    ...item,
    title: item.title.startsWith("담당")
      ? "담당 학생 반복 결석"
      : "반복 결석 학생",
    body:
      item.body
        ?.replace(
          / 학생이 최근 14일 (\d+)회 결석으로 반복 결석 위험입니다\./,
          " 학생 · 최근 14일 결석 $1회. 출결을 확인해 주세요.",
        )
        .replace(
          / (\d+)명이 반복 결석 위험 단계\(최근 14일 (\d+)회 이상\)에 도달했습니다\./,
          " 학생 $1명 · 최근 14일 결석 $2회 이상.",
        ) ?? null,
    link: item.link === "/retention" ? REPEATED_ABSENCES_LINK : item.link,
  };
}
