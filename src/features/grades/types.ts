/**
 * 성적 입력표의 **공용 계약** — 서버 조회·화면 격자·엑셀이 같은 모양을 본다.
 *
 * 🔴 `import "server-only"`를 붙이지 말 것 — 클라 격자와 엑셀 파서가 함께 읽는다([[#61]]·[[#81]]).
 */

import type { EnglishTrack } from "@/features/classes/english-track";
import type { ExamSlotKey } from "./exam-slots";
import type { Term } from "./term";

/** 화면이 고른 축 한 벌. 주소(`/exams?...`)·엑셀 안내 시트가 같은 값을 든다. */
export type GradeSelection = {
  year: number;
  term: Term;
  subject: string;
  /** 영어일 때만. 반을 고르는 필터일 뿐 성적 행에는 안 들어간다(subject-axis.ts). */
  track: EnglishTrack | null;
  /** null = 그 과목의 반 전체(반별 묶음으로 선다). */
  classId: string | null;
  slot: ExamSlotKey;
  /** 시험일 — 저장되는 행의 `taken_on`. 기본은 오늘을 학기 안으로 눌러 담은 날. */
  date: string;
  /** 만점(기본 100). 화면·엑셀·저장이 같은 값을 본다. */
  maxScore: number;
};

/*
 * 🔴 **묶음(반별/학년별) 축은 폐기했다**(원장 2026-09-22 저녁: *"묶음 자체를 없애고 학년을 디폴트로"*).
 *    같은 날 오후에 넣었다가 실제로 써 보고 뒤집힌 것이다 — 묶으면 정렬이 **묶음 안에서만** 걸려
 *    "학년 오름차순"을 눌러도 화면 전체로는 그렇게 안 보였다(반이 먼저라서). 반만 보고 싶으면 반
 *    드롭다운이 이미 있다. 되살리지 말 것.
 */

export type GradeClassOption = {
  id: string;
  className: string;
  track: EnglishTrack | null;
  /**
   * 이 학기 명단 인원. **null = 이번 조회에서 안 셌다**(반 하나만 볼 땐 나머지 반을 세지 않는다).
   * 🔴 0으로 채우지 말 것 — 안 센 반이 "명단 0명"으로 보이면 사람이 반을 잘못 고른다.
   */
  studentCount: number | null;
};

/** 격자 한 줄 = 학생 한 명(그 반 기준). 한 학생이 두 반이면 반마다 줄이 서고 **값은 같다**. */
export type GradeSheetRow = {
  studentId: string;
  name: string;
  school: string | null;
  grade: string | null;
  classId: string;
  className: string;
  score: number | null;
  maxScore: number | null;
  /** 이미 저장된 칸의 시험일. 저장은 **바뀐 칸만** 쓰므로 이 값이 diff의 한 축이다. */
  takenOn: string | null;
  /** 성적표 받기 단계 표식(누른 시각). 0284a 적용 전에는 전부 null. */
  marks: GradeMarks;
  /** 사람이 '시험없음'으로 표시했는가(사유는 아래) — 제도상 해당 없음(`applies`)과는 다른 축이다. */
  noExam: boolean;
  noExamReason: string | null;
  /**
   * 제도상 **그 학생이 치는 시험인가**([`applies.ts`](../applies.ts)) — false면 입력·집계·미기입 색에서 빠진다.
   * 🔴 저장되는 값이 아니다(학년에서 그때그때 도출) — 학년을 고치면 곧바로 따라온다.
   */
  applies: boolean;
  /** 지금도 그 반 명단인가 — 학기 중 나간 학생은 false(회색 줄, 값은 그대로 보인다). */
  onRoster: boolean;
};

export type GradeSheet = {
  selection: GradeSelection;
  classes: GradeClassOption[];
  rows: GradeSheetRow[];
  /**
   * 0284a(독촉 표식 컬럼)가 적용됐는가. false면 점수는 그대로 저장되고 **체크박스만** 잠긴다.
   * 🔴 `schemaReady`와 따로 두는 이유: 하나로 묶으면 표식 마이그레이션이 늦어질 때 **점수 저장까지**
   *    멈춘다(이미 열려 있던 기능을 새 기능이 잠그면 안 된다).
   */
  marksReady: boolean;
  /**
   * 0285a('시험없음'·사유 컬럼)가 적용됐는가. false면 점수·표식은 그대로 되고 **그 버튼만** 잠긴다.
   */
  noExamReady: boolean;
  /**
   * 0283a(학기·시험 칸 컬럼)가 적용됐는가. false면 화면은 살고 **입력만 잠근다**([[#95]]) —
   * 성적 표는 매일 쓰는 경로가 아니지만, 적용 전에 저장을 열어 두면 전건이 400으로 실패한다.
   */
  schemaReady: boolean;
};

/**
 * 성적표 **받기 단계 표식**(원장 2026-09-22) — 칸마다 `1차 요청 · 2차 요청 · 받아서 확인`.
 * 🔑 불리언이 아니라 **시각**이다: "언제 독촉했나"가 다음 독촉을 정한다(화면은 체크박스 + 날짜 툴팁).
 */
export type GradeMarkKey = "ask1" | "ask2" | "received";
export const GRADE_MARK_KEYS: readonly GradeMarkKey[] = ["ask1", "ask2", "received"];
export const GRADE_MARK_LABEL: Record<GradeMarkKey, string> = {
  // 원장 2026-09-22: *"1차 2차를 1차상담, 2차상담으로 변경"* — 키(`ask1`·`ask2`)는 그대로 두고 라벨만.
  ask1: "1차상담",
  ask2: "2차상담",
  received: "성적확인",
};
/** 그 칸의 표식 — 값은 누른 시각(ISO), 안 눌렀으면 null. */
export type GradeMarks = Record<GradeMarkKey, string | null>;
export const EMPTY_GRADE_MARKS: GradeMarks = { ask1: null, ask2: null, received: null };

/** 저장이 받는 한 칸. score가 null이면 점수를 **지운다**(표식이 있으면 행은 남는다). */
export type GradeEntry = {
  studentId: string;
  score: number | null;
  /** 체크 상태(켬/끔) — 서버가 시각으로 바꾼다. 안 보내면 표식을 건드리지 않는다. */
  marks?: Record<GradeMarkKey, boolean>;
  /** 사람이 누른 '시험없음'. 켜면 점수는 비운다(둘은 같이 못 선다). */
  noExam?: boolean;
  /** '시험없음' 사유 — 끄면 함께 지운다. */
  noExamReason?: string | null;
};

export const GRADE_MAX_SCORE_DEFAULT = 100;
/**
 * 만점 상한 — 화면(주소 해석)과 엑셀 안내 시트가 **같은 값**을 쓴다.
 * 🔴 두 곳이 갈리면 시트로만 들어온 큰 만점이 화면에선 100으로 보이고, 그 화면을 저장하는 순간
 *    멀쩡한 점수가 통째로 다시 쓰인다.
 */
export const GRADE_MAX_SCORE_LIMIT = 1000;
