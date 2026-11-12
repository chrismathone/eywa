/**
 * 상담 준비 브리프 — 학원 설정에 등록된 운영 안내(원장 2026-11-12 *"운영 사실 설정은 코덱스와 협의해서 추천대로"*).
 *
 * 학부모가 '학원에 바라는 것'으로 고르는 보고 주기·과제 관리·보강·레벨테스트 등은 브리프 사실에 없었다. 이제 원장(또는
 * 위임자)이 학원 설정 → 상담 양식에 주제별로 적은 **원문**을 브리프 화면·인쇄에 그대로 싣는다.
 *
 * 🔴 Codex 합의(2026-11-12) · 적대 리뷰:
 *   - 설정 글이 있다고 AI 문장 검증을 풀지 않는다 — 조건을 빼먹은 약속('사전 신청 시 월 1회 보강' → '월 1회 보강')을
 *     낱말 검사로는 막지 못한다. 그래서 이 글은 **검증 근거(숫자·시각·인원 whitelist)에도 넣지 않는다**(prep-brief.ts `validationFacts`).
 *     예외는 하나 — 그 주제가 설정된 지점에서 원문을 분명히 가리키는 넘김('할인 조건은 안내 문구 그대로 읽어 드리겠습니다' · prep-brief-promise.ts).
 *   - 기본값은 모두 빈칸이다(운영 사실을 지어 기본값으로 두지 않는다 · 발송 이력으로 앞으로의 주기를 보장할 수 없다).
 *   - 지점 전 과목 공통 안내만 적는다(과목별 차이는 따로 설계).
 * 클라이언트·서버가 같이 읽는 순수 모듈이다(server-only·zod 없음).
 */
import type { PrepFacts } from "@/features/enrollment/prep-brief";

/** `words` = 문장이 이 주제를 말하는지 가르는 낱말(원문 가리키기 넘김은 설정된 주제일 때만 인정 · prep-brief-promise.ts). */
export const BRIEF_FACT_TOPICS = [
  { key: "reportCycle", label: "보고·학부모 상담 주기", words: "보고|리포트|성적표|학부모 상담|상담 주기|수업보고서|기록" },
  { key: "homework", label: "과제·오답 관리", words: "과제|숙제|오답" },
  { key: "makeup", label: "보강", words: "보강" },
  { key: "placement", label: "레벨테스트·반 배정·첫 수업", words: "레벨테스트|반 배정|첫 수업|수업 시작" },
  { key: "trial", label: "체험 수업", words: "체험" },
  { key: "discount", label: "할인", words: "할인" },
] as const;

export type BriefFactKey = (typeof BRIEF_FACT_TOPICS)[number]["key"];
export type BriefFacts = Record<BriefFactKey, string>;

/** 한 칸 글자 수 상한(설정 스키마와 입력 칸이 같은 값 · 앞뒤 공백을 지운 길이). */
export const BRIEF_FACT_MAX = 200;

export const EMPTY_BRIEF_FACTS: BriefFacts = { reportCycle: "", homework: "", makeup: "", placement: "", trial: "", discount: "" };

/** 저장값이 손상돼 문자열이 아니어도(직접 DB 수정 등) 화면·생성이 죽지 않게. */
export const briefFactText = (v: unknown): string => (typeof v === "string" ? v : "");

/** 브리프 사실 스냅샷에 싣는 줄 — 빈칸 빼고 주제 순서대로. 원장이 넣은 줄바꿈은 지키고(화면·인쇄 원문) 빈 줄만 걷는다. */
export type BriefFactLine = { label: string; text: string };

export function briefFactLines(facts: Partial<Record<BriefFactKey, unknown>> | null | undefined): BriefFactLine[] {
  if (!facts) return [];
  return BRIEF_FACT_TOPICS.flatMap((t) => {
    const text = briefFactText(facts[t.key])
      .split(/\r?\n/)
      .map((l) => l.replace(/[ \t]+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
    return text ? [{ label: t.label, text }] : [];
  });
}

/**
 * 학부모에게 하는 말 · 운영 안내 규칙(프롬프트 한 줄). 운영 안내가 없으면 2026-11-11 판과 **글자 하나 다르지 않다**.
 * 있으면 그 주제는 상담사가 화면의 원문을 읽어 안내하고, AI는 원문을 바꾸거나 줄여 약속하지 않는다.
 */
export function operationsRule(f: PrepFacts): string {
  const head =
    "- 학부모에게 하는 말(opening·response·answer·proposal·closing)은 상담 자리에서 하는 말입니다 — '상담에서 확인'·'확인해 안내드리겠습니다'처럼 뒤로 미루지 마세요. 사실에 있는 반·시간·교재·금액은 그대로 안내하세요. ";
  const tail = " 상담사에게 설명을 넘기는 말은 브리프 전체에 한 번까지, 미루는 말은 실제로 더 알아봐야 하는 것만 두 문장 이하로.";
  const ops = f.policy.operations ?? [];
  if (ops.length === 0) {
    return (
      head +
      "학부모가 바란 학원 운영(보고 주기·과제·오답 관리·보강·체험 수업·레벨테스트 시점·시작일·할인·셔틀 탑승)은 [사실]에 없습니다 — 접수서에 그 바람이 있다는 것과 이 학생에게 왜 중요한지만 말하고, 학원의 방식·주기·횟수를 지어내거나 '해 드리겠습니다·보내 드리겠습니다'로 약속하지 마세요(방식은 상담사가 직접 설명합니다)." +
      tail
    );
  }
  const set = new Set(ops.map((o) => o.label));
  const rest = [...BRIEF_FACT_TOPICS.map((t) => t.label).filter((l) => !set.has(l)), "셔틀 탑승"];
  return (
    head +
    `학부모가 바란 학원 운영 가운데 [학원 설정에 등록된 운영 안내]에 있는 주제(${ops.map((o) => `「${o.label}」`).join(" ")})는 상담사가 화면에 따로 실린 원문을 그대로 읽어 안내합니다 — 학부모에게 하는 말에서는 그 바람과 이 학생에게 왜 중요한지만 말하고, 원문의 주기·횟수·시간·조건·금액·숫자는 학부모에게 하는 말에 옮기지 마세요(원문이 화면에 따로 실리니 '해 드리겠습니다·보내 드리겠습니다'로 다시 말하지 않습니다). 그 안내에 없는 주제(${rest.map((l) => `「${l}」`).join(" ")})는 [사실]에 없으니 방식·주기·횟수를 지어내지 마세요(방식은 상담사가 직접 설명합니다).` +
    tail
  );
}
