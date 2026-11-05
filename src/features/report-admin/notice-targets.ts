import { isClassnoteSubjectEnabled } from "@/features/onescreen/classnote-guard";
import type { NoticeAttachment } from "@/features/onescreen/notice-attachments";

/**
 * 반 공지 타깃 해석(순수) — aywa 반에서 고른 학생들을 ClassNote **학생별 개별 보드**로 매핑.
 * Edutrix NoticeWriteModal 패턴 계승: 반 구조는 aywa에 살고, ClassNote 1인 1반은 배달 레일
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
// classId·className = **반 보드 경로**(수학, 2026-10-02) — 있으면 워커가 1인 보드가 아니라 그 반 보드의 그 학생 원아에게 1:1로 올린다
//   (server/notice-class-route.ts가 삼자 일치로 정한다). 이때 `board`는 보드를 찾는 값이 아니라 결과↔대상을 맞추는 표시 키다(classTargetKey).
// subject = `"english"`이면 **영어 반 방 경로**(2026-11-04 · AywaSync 1.0.15) — 그 영어 반에 이어진 ClassNote 반 방(s2_0006)의 그 학생 원아에게.
//   수학 반 보드 대상에는 싣지 않는다(옛 큐 행과 같은 모양 — 워커는 표식이 없으면 수학 반 보드로 본다).
export type NoticeTarget = {
  studentId: string;
  studentName: string;
  board: string;
  body?: string;
  attachments?: NoticeAttachment[];
  classId?: string;
  className?: string;
  subject?: "english";
};
/**
 * 제외 사유. `no_class_board` = 반 보드 경로인데 이 학생이 받을 반 보드가 없다(연결 없음·원아 매칭 보류) ·
 * `not_my_class` = 반 보드는 있지만 보내는 선생님이 맡은 반이 아니다(삼자 일치 실패) ·
 * `not_started`·`on_hold` = 그 과목 수업 시작 전 · 휴원(대기) 중 — ClassNote로 보내지 않는다(원장 2026-11-05, notice-standing.ts). 화면 문구 = NOTICE_SKIP_LABEL.
 */
export type NoticeSkip = {
  name: string;
  reason: "subject_off" | "name_collision" | "no_name" | "no_class_board" | "not_my_class" | "not_started" | "on_hold";
};

/** 제외 사유 한글 문구 — 화면은 이 표만 쓴다(raw 코드 노출 금지). */
export const NOTICE_SKIP_LABEL: Record<NoticeSkip["reason"], string> = {
  name_collision: "동명이인 — 오발송 방지로 제외",
  subject_off: "학원설정에서 발송하지 않는 과목",
  no_name: "이름 없음",
  no_class_board: "ClassNote 반 보드에 연결된 원아가 없음 — '지금 반 보드 동기화' 뒤 다시",
  not_my_class: "보내는 선생님의 담당 반이 아님",
  not_started: "수업 시작 전 — 첫 수업 날부터 ClassNote로 보낼 수 있습니다",
  on_hold: "휴원(대기) 중 — 휴원 중에는 ClassNote로 보내지 않습니다",
};

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
