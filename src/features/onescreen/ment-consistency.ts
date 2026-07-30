/**
 * 멘트와 **기록 칸이 서로 다른 말을 하는지** 검사 — 순수 함수(Vitest).
 *
 * 학부모 카드에는 멘트와 기록(진도·테스트 점수)이 **나란히** 보인다. 둘이 어긋나면 학부모는
 * 두 개의 사실을 동시에 받는다. 2026-07-30 발송 감사(226건)에서 두 갈래가 반복해서 잡혔다.
 *
 * 🔴 ① 시험 본 날인데 진도 칸은 일반 차시 — **45건(20%), 강사 5명 전원**.
 *      멘트: "오늘은 6학년 2학기 1-2 단원 월말평가를 진행했습니다"
 *      진도: "2-1-5 (가분수)÷(분수) 알아보기"   ← 카드에 이대로 함께 나간다.
 *      진도 중단 상태(월말평가·모의고사·내신대비·시험대비)를 진도 칸에 넣는 장치가 이미 있는데
 *      (progress-status.ts) 아무도 안 쓰고 멘트에 손으로 적는다.
 * 🔴 ② 점수를 멘트에만 적고 테스트 칸은 빈 채 — **12건**.
 *      그 점수는 추세 그래프·성적 이력 어디에도 안 들어간다. 다음 회차 추세에서 그 날이 통째로 사라진다.
 *
 * ⚠️ **막지 않는다.** 강사가 일부러 그렇게 쓸 수도 있고(예: 시험 얘기를 곁들인 정규 수업),
 *    발송을 잠그면 진짜 필요한 알림장이 안 나간다. 화면에 사실만 알리고 판단은 강사가 한다.
 */
import { isSkipStatus } from "./progress-status";

export type MentWarning = "exam-progress" | "score-not-recorded";

/**
 * 멘트가 '오늘 시험을 봤다'고 말하는가.
 *
 * ⚠️ 시험 **이름만** 나온다고 시험을 본 게 아니다 — "다음 주 중간고사 대비로 기출을 풀었습니다"는
 *    정규 수업이다. 그래서 **치렀다는 서술어**가 붙은 경우만 잡는다(오탐보다 미탐이 낫다:
 *    이 경고는 강사를 멈춰 세우는 게 아니라 확인을 권하는 것이라, 헛경고가 쌓이면 아무도 안 본다).
 */
const MENT_SAYS_EXAM =
  /(월말평가|단원평가|중간고사|기말고사|모의고사|레벨테스트|진단평가|시험|평가)\s*(를|을)?\s*(진행|봤|보았|치렀|응시|실시)/;

/** 멘트가 점수를 말하는가 — "25문제 중 21개" · "92점" 꼴. */
const MENT_HAS_SCORE = /\d+\s*문제\s*중\s*\d+\s*개|\d+\s*점\s*만점|(?<!\d)\d{1,3}\s*점(?!수)/;

/**
 * 진도 칸이 **이미 시험 이야기를 하고 있는가**. 여기 걸리면 경고하지 않는다.
 *
 * 🔴 왜 `isSkipStatus`만으로 부족한가(2026-07-30 적대검증에서 잡음): 그 판정은 라벨이 **단독**일 때만
 *    인정한다("월말평가" ⭕ / "수학 월말평가" ❌ / "월말평가 오답풀이" ❌). 그런데 진도값은 표면마다
 *    과목 라벨이 붙은 형태로 돌아다닌다(저장된 `lesson_reports.progress`는 `"수학 월말평가"`).
 *    실측: 접두가 붙은 값으로 판정하면 41건 중 **21건이 오탐**(강사가 제대로 '월말평가'라 적었는데 경고).
 *    경고는 막지 않고 권하는 장치라 **헛경고가 쌓이면 아무도 안 본다** → 시험 단어가 조금이라도 있으면 침묵한다.
 *    (실데이터 재측정: 이 완화로 진짜 경고 20건은 그대로 남았다 — 잃는 것 없음.)
 */
const PROGRESS_MENTIONS_EXAM =
  /월말평가|단원평가|중간고사|기말고사|모의고사|레벨테스트|진단평가|월간테스트|내신|시험|평가/;

export const MENT_WARNING_LABEL: Record<MentWarning, string> = {
  "exam-progress": "진도 칸 확인",
  "score-not-recorded": "점수 칸 확인",
};

export const MENT_WARNING_HINT: Record<MentWarning, string> = {
  "exam-progress":
    "멘트는 시험·평가를 봤다고 하는데 진도 칸에는 일반 차시가 적혀 있습니다 — 학부모 카드에는 둘 다 보입니다. 진도 칸을 '월말평가'처럼 바꾸면 카드와 멘트가 같은 말을 합니다.",
  "score-not-recorded":
    "멘트에는 점수가 있는데 테스트 칸이 비어 있습니다 — 이 점수는 성적 추이·이력에 남지 않습니다. 점수는 테스트 칸에 넣어 주세요.",
};

/**
 * 어긋난 곳을 찾는다(빈 배열 = 이상 없음).
 * 멘트가 비어 있으면 검사하지 않는다 — 아직 안 쓴 것과 어긋난 것은 다르다(발송 게이트가 따로 본다).
 */
export function checkMentConsistency(args: {
  ment: string;
  /** 진도 칸 원문(과목 접두 없이 그대로). */
  progress: string;
  /** 저장될 테스트 표기("25문제 중 21개") — 비면 미입력. */
  dailyTest: string;
  checkTest: string;
}): MentWarning[] {
  const ment = args.ment.trim();
  if (!ment) return [];
  const out: MentWarning[] = [];
  // ① 멘트는 시험인데 진도 칸은 차시 — 진도가 비어 있으면 어긋날 것도 없다.
  //    진도 칸이 이미 시험을 말하고 있으면(라벨 단독이든 접두가 붙었든) 어긋난 게 아니다.
  const prog = args.progress.trim();
  if (MENT_SAYS_EXAM.test(ment) && prog && !isSkipStatus(prog) && !PROGRESS_MENTIONS_EXAM.test(prog)) {
    out.push("exam-progress");
  }
  // ② 멘트엔 점수, 칸은 빈 채.
  if (MENT_HAS_SCORE.test(ment) && !args.dailyTest.trim() && !args.checkTest.trim()) {
    out.push("score-not-recorded");
  }
  return out;
}
