/**
 * 교재요청 → 학부모 ClassNote 발송의 공용 타입(순수 — 클라·서버 공용, server-only/use client 금지).
 * 발송 다이얼로그(클라)와 서버 액션이 같은 타입을 보도록 여기 한 곳에 둔다.
 */
import type { NoticeAttachment } from "@/features/onescreen/notice-attachments";

export type TextbookNoticeOrder = {
  id: string;
  studentId: string | null;
  studentName: string | null;
  /** 요청서 카드에 찍히는 담임 이름(발송 첨부 PNG를 저장값 그대로 만들기 위해 필요). */
  teacherName: string | null;
  bookName: string;
  bookDetail: string | null;
  price: number;
  requestDate: string | null;
  /** 발송 가능 과목 키(보드 prefix가 있는 것만). 1개=자동 확정, 2개+=선택, 0개=발송 불가. */
  subjects: string[];
  /**
   * 알림장 기본값 — 이 요청을 낸 선생님이 그 학생을 가르치는 과목(textbook-notice-subject.ts).
   * null = 정하지 못함(화면이 고르게 한다). 가나다순 첫 과목으로 채우지 말 것 — 수학 교재가 영어 알림장으로 나간다.
   */
  defaultSubject: string | null;
};

export type TextbookNoticeSkip = {
  name: string;
  // 뒤 3개 = 중복 발송 차단(0174a, textbook-send-dedup.ts). 한글 라벨은 화면 SKIP_LABEL이 붙인다.
  reason:
    | "no_subject"
    | "no_student"
    | "subject_off"
    | "name_collision"
    | "no_name"
    // 수학 반 보드 경로(2026-10-02) — 받을 반 보드가 없다 / 보내는 선생님의 담당 반이 아니다.
    | "no_class_board"
    | "not_my_class"
    // 그 과목 수업 시작 전 · 휴원(대기) 중 — ClassNote로 보내지 않는다(원장 2026-11-05, notice-standing.ts).
    | "not_started"
    | "on_hold"
    | "already_sent"
    | "same_book_sent"
    | "dup_in_batch";
};

export type PreparedTextbookNotice = {
  ok: boolean;
  error?: string;
  orders?: TextbookNoticeOrder[];
  /** 저장된 내 멘트 ?? 기본 템플릿 */
  ment?: string;
  account?: { bank: string; holder: string; number: string };
  /** 학원설정 'ClassNote 실제 발송' 스위치 — off면 dry-run(보내지 않음)임을 화면이 미리 알린다. */
  sendEnabled?: boolean;
  /**
   * 학원설정 '사진/파일 첨부'(report.showAttachments) — 학부모에게 사진·파일을 보내지 않는다는 방침 스위치.
   * 이 발송은 요청서 그림이 본체라 방침과 충돌 → off면 화면이 막고 서버도 거부한다(이중 방어).
   * 🔴 공지 워커는 이 설정을 읽지 않는다 — 방침을 지키는 지점은 발송 액션 한 곳뿐이다.
   */
  showAttachments?: boolean;
  /**
   * 수학 알림장이 **어느 반 보드로 가는지**(studentId → 반 이름 또는 못 보내는 사유) — 수학 반 보드 경로가 켜져 있을 때만 있다
   * (꺼져 있으면 undefined = 지금까지처럼 1인 보드). 발송 액션과 **같은 함수**로 정한 값이라 화면에 보인 반으로 실제로 나간다.
   * 사유가 든 학생은 수학 알림장으로 보낼 수 없다(화면이 미리 알리고 대상 수에서 뺀다).
   */
  mathRoute?: Record<string, { className: string } | { reason: "no_class_board" | "not_my_class" }>;
  /**
   * 그 과목 **수업 시작 전 · 휴원(대기) 중**이라 ClassNote로 보내지 않는 학생(studentId → 알림장 과목 → 사유 · 원장 2026-11-05).
   * 발송 액션과 **같은 함수**(resolveNoticeStandings)로 정한 값이다 — 화면이 미리 알리고 대상 수에서 뺀다. 판정을 못 했으면 undefined(발송 때 다시 판정).
   */
  standing?: Record<string, Record<string, "not_started" | "on_hold">>;
  /**
   * 연동 PC 워커가 **이미지 첨부를 아직 지원하지 않을 때의 한글 사유**(지원하면 undefined).
   * 구버전 워커는 첨부를 무시하고 글자만 게시한 뒤 성공으로 기록하므로 발송 전에 막는다.
   */
  workerError?: string;
};

export type SendTextbookNoticeResult = {
  ok: boolean;
  error?: string;
  queued?: number;
  dryRun?: boolean;
  skipped?: TextbookNoticeSkip[];
};

export type { NoticeAttachment };
