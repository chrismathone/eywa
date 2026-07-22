import { isClassnoteSubjectEnabled } from "@/features/onescreen/classnote-guard";
import type { NoticeAttachment } from "@/features/onescreen/notice-attachments";

/**
 * 반 공지 타깃 해석(순수) — eywa 반에서 고른 학생들을 ClassNote **학생별 개별 보드**로 매핑.
 * Edutrix NoticeWriteModal 패턴 계승: 반 구조는 eywa에 살고, ClassNote 1인 1반은 배달 레일
 * (docs/classnote-integration.md §3 "왜 학생 1명=반 1개인가"). 보드명 = `(과목라벨)유효이름`,
 * 유효이름 = classnote_name(오버라이드) ?? name — 발송 워커 boardClassName과 동일 규약.
 */

/** 발송 가능 과목 키 → 실보드 prefix. classnote-guard CLASSNOTE_SENDABLE_SUBJECTS와 동일 목록 유지. */
export const BOARD_PREFIX: Record<string, string> = {
  math: "(수학)",
  subject_1: "(수학)",
  english: "(영어)",
};

export type NoticeCandidate = {
  studentId: string;
  name: string;
  classnoteName: string | null;
  subject: string | null; // 선택된 반의 과목 키(보드 prefix 결정)
};

// body?: 학생별 개별 내용(공통과 다르게 쓴 학생만). 워커는 target.body ?? notice.body(공통)를 게시.
// ⚠️ body는 resolveNoticeTargets **이후** studentId lookup으로 붙일 것(target↔student 고정 — 오발송 방지).
// attachments = 그 학생에게만 붙는 이미지/파일(0130a, 예: 학생별 교재요청서 PNG). 공통 첨부는 큐 행(classnote_notices.attachments).
export type NoticeTarget = {
  studentId: string;
  studentName: string;
  board: string;
  body?: string;
  attachments?: NoticeAttachment[];
};
export type NoticeSkip = { name: string; reason: "subject_off" | "name_collision" | "no_name" };

/**
 * 후보(선택된 반들의 재원생) → 발송 타깃 + 제외 목록.
 * - 과목 게이트: 학원설정 opt-in(allowedSubjects) + 화이트리스트(isClassnoteSubjectEnabled 재사용).
 * - 중복 제거: 같은 학생이 같은 보드로 여러 반에서 뽑혀도 1회.
 * - 동명이인: **서로 다른 학생**이 같은 보드명으로 해석되면 양쪽 다 제외(오발송 방지 — 보고서 경로의
 *   name_conflict와 동일 철학). classnote_name 접미사 지정 후 재시도.
 */
export function resolveNoticeTargets(
  candidates: NoticeCandidate[],
  allowedSubjects: readonly string[],
): { targets: NoticeTarget[]; skipped: NoticeSkip[] } {
  const skipped: NoticeSkip[] = [];
  const byBoard = new Map<string, Map<string, NoticeTarget>>(); // board -> studentId -> target
  for (const c of candidates) {
    const eff = (c.classnoteName || c.name || "").trim();
    if (!eff) {
      skipped.push({ name: c.name || "(이름 없음)", reason: "no_name" });
      continue;
    }
    if (!isClassnoteSubjectEnabled(c.subject, allowedSubjects) || !c.subject || !BOARD_PREFIX[c.subject]) {
      skipped.push({ name: eff, reason: "subject_off" });
      continue;
    }
    const board = `${BOARD_PREFIX[c.subject]}${eff}`;
    if (!byBoard.has(board)) byBoard.set(board, new Map());
    byBoard.get(board)!.set(c.studentId, { studentId: c.studentId, studentName: eff, board });
  }
  const targets: NoticeTarget[] = [];
  for (const [, students] of byBoard) {
    if (students.size > 1) {
      // 같은 보드명으로 학생 2명+ = 동명이인 — 전원 제외(어느 가족 보드인지 확정 불가)
      for (const t of students.values()) skipped.push({ name: t.studentName, reason: "name_collision" });
      continue;
    }
    targets.push([...students.values()][0]);
  }
  targets.sort((a, b) => a.board.localeCompare(b.board, "ko"));
  return { targets, skipped };
}
