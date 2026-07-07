/**
 * 선생님 원스크린 — AI 학부모 멘트 프롬프트(순수 함수).
 * edutrix aiActions(generateDailyNotice/P1·P2)의 환각방지 가드·few-shot을 이식해, eywa generateJSON
 * (Upstage Solar 기본, JSON mode)에 맞춰 `{comment}` 한 단락을 생성한다. 라이브 AI 호출 없음(빌더만).
 * 실 AI 호출은 server/actions.ts의 generateReportComment, 실패 시 report.ts buildSubjectReport로 폴백.
 * CLAUDE.md 원칙: 계산/프롬프트 조립은 순수 함수 + Vitest.
 */
import type { OneScreenStudent } from "./types";

export type ReportCommentInput = {
  studentName: string;
  subject: string;
  progress: string; // 오늘 진도(subject.today)
  dailyTest: string; // "20문제 중 18개 (지난 회차 대비 ▲2)" | ""
  checkTest: string;
  attitude: string; // "" = 미입력
  homework: string; // "" = 미입력/—
};

/** 점수 → 사람이 읽는 문장. 미입력이면 "". 직전 회차 있으면 증감(▲/▼) 부기. */
function testLine(score: number | null, max: number, prev: number | null): string {
  if (score == null) return "";
  let s = `${max}문제 중 ${score}개`;
  if (prev != null) {
    const d = score - prev;
    s += d === 0 ? " (지난 회차와 동일)" : ` (지난 회차 대비 ${d > 0 ? "▲" : "▼"}${Math.abs(d)})`;
  }
  return s;
}

/** onescreen 학생 + 과목 인덱스 → 멘트 입력. 빈 값은 빈 문자열(프롬프트가 침묵하도록). */
export function buildReportCommentInput(st: OneScreenStudent, subjectIndex: number): ReportCommentInput {
  const su = st.subjects[subjectIndex];
  return {
    studentName: st.name,
    subject: su?.name ?? "",
    progress: su?.today ?? "",
    dailyTest: testLine(st.tests.daily.score, st.tests.daily.max, st.tests.daily.prevScore),
    checkTest: testLine(st.tests.check.score, st.tests.check.max, st.tests.check.prevScore),
    attitude: st.attitude ?? "",
    homework: st.homework && st.homework !== "—" ? st.homework : "",
  };
}

/** 입력의 **채워진 사실만** 모은 프롬프트. Upstage JSON mode용으로 "JSON" 명시 + {comment} 출력 계약. */
export function buildReportCommentPrompt(input: ReportCommentInput): string {
  const facts: string[] = [];
  const prog = [input.subject, input.progress].filter(Boolean).join(" ");
  if (prog) facts.push(`오늘 진도: ${prog}`);
  if (input.dailyTest) facts.push(`일일테스트(이전 진도 범위): ${input.dailyTest}`);
  if (input.checkTest) facts.push(`확인테스트(오늘 진도 범위): ${input.checkTest}`);
  if (input.attitude) facts.push(`수업 태도: ${input.attitude}`);
  if (input.homework) facts.push(`과제: ${input.homework}`);
  const factBlock = facts.length ? facts.join("\n") : "(입력된 정보 없음)";

  return [
    "당신은 학원 담임 선생님입니다. 아래 [입력]의 사실만으로 학부모님께 보내는 오늘 수업 알림장을 2~4문장으로 씁니다.",
    "",
    "[반드시]",
    "- [입력]에 있는 사실만 쓰세요. 없는 내용(없는 진도·활동·반응·성취·전망)을 지어내지 마세요.",
    "- 점수 숫자는 [입력] 그대로 정확히 옮기세요. 임의로 바꾸거나 만들지 마세요.",
    "- 수신인은 '학부모님'으로 통칭. 학생 호칭('○○ 학생,')·끝인사·마크다운·불릿·날짜 금지.",
    "- '기대됩니다/잘할 거예요' 같은 전망·격려나 상투적 접속사(또한/특히/그러나) 남발 금지. 담담한 사실 전달.",
    "- 부정적 내용은 완곡하게 쓰되 없는 긍정을 만들지 마세요. [입력]에 없는 항목은 아예 언급하지 마세요.",
    "",
    "[예시]",
    "입력) 오늘 진도: 수학(상) 이차함수 / 확인테스트(오늘 진도 범위): 20문제 중 18개 (지난 회차 대비 ▲3) / 수업 태도: 좋음 / 과제: 완료",
    '출력) {"comment": "오늘은 이차함수 진도를 진행했고, 확인테스트에서 20문제 중 18개를 맞혔습니다. 지난 회차보다 3개 더 맞았으며, 수업 태도도 좋았고 과제도 완료했습니다."}',
    "",
    "[입력]",
    factBlock,
    "",
    '[출력] JSON만 출력: {"comment": "..."} — comment는 한국어 한 단락(줄바꿈 없이). 마크다운 코드블록 금지.',
  ].join("\n");
}
