// 학부모 메시지 초안 생성 — 순수 함수. 실발송 없음(초안 + 클립보드 복사용).
// 부원장 makeMessages / parentSafeFocus / makePlan / toneLabels 포팅.
// 내부 위험 분석 라벨("상담·메모 내 강한 이탈 신호" 등)은 학부모 노출 문구로 절대 내보내지 않는다.

import { includesAny, type RiskLevel } from "./risk";

export type MessageTone = "soft" | "firm" | "result" | "reassure";

export const TONE_LABELS: Record<MessageTone, string> = {
  soft: "부드럽게",
  firm: "단호하게",
  result: "성과 중심",
  reassure: "안심 중심",
};

export type MessageInput = {
  name: string;
  level: RiskLevel;
  scoreDrop: number;
  lastScore: number | null;
  homeworkRate: number | null;
  /** 학생별 위험 사유(내부 라벨) — 학부모용으로 번역해서만 사용 */
  reasons: string[];
  /** 학생 메모 + 최근 상담 요약(자유텍스트) — 칭찬/신호 추출용 */
  memo: string;
  academyName: string;
  directorName: string;
};

function shortName(name: string): string {
  const n = (name ?? "").trim();
  return n.length >= 3 ? n.slice(1) : n;
}

/** 내부 위험 라벨 → 학부모 안전 문구. 노출 부적합하면 null. */
function translateReason(reason: string): string | null {
  if (reason.startsWith("성적")) return "직전 평가에서 아쉬웠던 단원을 확인해 보완하고 있습니다";
  if (reason.startsWith("숙제 기록")) return null;
  if (reason.startsWith("숙제율")) return "과제 제출 리듬이 흔들려 분량과 제출 시간을 조정하고 있습니다";
  if (reason.startsWith("결석") || reason.startsWith("지각") || reason.startsWith("출결"))
    return "출결 리듬을 챙기면서 빠진 수업은 보강으로 채우고 있습니다";
  if (reason.startsWith("상담 공백") || reason === "상담 이력 없음")
    return "이번 주 안에 학습 상담 일정을 제안드리려 합니다";
  return null;
}

function parentSafeFocus(reasons: string[]): string[] {
  const out: string[] = [];
  for (const reason of reasons) {
    const t = translateReason(reason);
    if (t && !out.includes(t)) out.push(t);
  }
  return out.length
    ? out
    : ["현재 학습 리듬을 유지하면서 오답 정리와 수업 참여를 꾸준히 챙기고 있습니다"];
}

function makePlan(input: MessageInput): string[] {
  const homeworkIssue = input.homeworkRate != null && input.homeworkRate < 75;
  return [
    input.scoreDrop >= 8
      ? "하락 폭이 컸던 문항 유형을 다시 확인하겠습니다"
      : input.scoreDrop >= 4
        ? "지난 평가에서 아쉬웠던 단원을 이번 주 수업에서 한 번 더 다지겠습니다"
        : "현재 흐름을 유지하면서 다음 단원 예습을 이어가겠습니다",
    homeworkIssue
      ? "숙제는 한 번에 몰리지 않도록 분량과 제출 시간을 나눠 관리하겠습니다"
      : "오답 정리와 수업 참여도를 계속 점검하겠습니다",
  ];
}

/** 학부모 문자 초안 생성. tone별로 도입/마무리 변형. */
export function buildParentMessage(input: MessageInput, tone: MessageTone = "soft"): string {
  const academy = input.academyName || "저희 학원";
  const director = input.directorName || "원장";
  const callName = `${shortName(input.name)} 학생`;
  const stable = input.level === "ok";
  const plan = makePlan(input);
  const focus = parentSafeFocus(input.reasons);
  const homeworkText = input.homeworkRate == null ? "기록 정리 중" : `${Math.round(input.homeworkRate)}%`;
  const scoreText = input.lastScore == null ? "기록 정리 중" : `${Math.round(input.lastScore)}점`;

  // 메모(학생 메모 + 상담 요약 결합)를 학부모에게 원문 인용할 땐 보수적으로 —
  // 짧고(중간 잘림 방지) · 괄호 주석((학부모) 등 내부 표기) 없고 · 부정 키워드 없을 때만.
  // 그 외엔 인용하지 않고 일반 문구로 폴백(내부 메모 원문 유출 방지).
  const praiseSource = (input.memo ?? "").trim();
  const cleanPraise =
    stable &&
    praiseSource.length > 0 &&
    praiseSource.length <= 25 &&
    !praiseSource.includes("(") &&
    !includesAny(praiseSource, ["하락", "부족", "누락", "불만", "환불", "퇴원", "미제출", "결석", "공백"]);
  const praise = cleanPraise ? `특히 "${praiseSource}" 부분이 눈에 띕니다.` : "";

  const head = `[${academy}] 안녕하세요, ${callName} 학부모님. ${academy} ${director}입니다.`;
  const tail = `궁금하신 점은 이 번호로 편하게 회신 주세요. 감사합니다.\n\n${academy} ${director} 드림`;
  const numbersLine = `최근 평가 ${scoreText}${input.scoreDrop ? ` (직전 대비 -${input.scoreDrop}점)` : ""}, 과제 수행 ${homeworkText} 기준으로 관리하고 있습니다.`;

  let body: string;
  if (stable) {
    body = `${callName}은 최근 학습 흐름이 안정적입니다. ${praise || "수업 참여와 과제 모두 꾸준하게 이어가고 있습니다."}`;
    if (tone === "result") body = `${numbersLine}\n\n${body}`;
    if (tone === "reassure") body += "\n\n지금 흐름이라면 안심하셔도 좋습니다.";
  } else if (input.level === "warn") {
    body = `최근 학습에서 함께 챙기면 좋을 부분이 보여 미리 말씀드립니다.\n\n- ${focus.join("\n- ")}`;
    if (tone === "result") body = `${numbersLine}\n\n${body}`;
    if (tone === "reassure") body = `크게 걱정하실 단계는 아니고, 충분히 회복 가능한 구간입니다.\n\n${body}`;
  } else {
    body = `${callName}이 최근 수업에서 조금 흔들리는 모습이 보여서, 학원에서 먼저 챙겨드리고 싶어 연락드렸습니다.\n\n- ${focus.join("\n- ")}\n\n이번 주 중 편하신 시간 한 가지만 회신 주시면 제가 직접 전화드리겠습니다. (예: 수 7시 / 목 8시)`;
    if (tone === "result") body = `${numbersLine}\n\n${body}`;
    if (tone === "reassure") body = `충분히 회복 가능한 구간이라 너무 걱정하지 않으셔도 됩니다.\n\n${body}`;
  }
  if (tone === "firm" && !stable) {
    body += "\n\n다음 평가 전에 보완하는 것이 중요해서, 이번 주 안에 상담 일정을 확정해 주시기를 부탁드립니다.";
  }

  return [head, "", body, "", "이번 주 관리 계획", `- ${plan.join("\n- ")}`, "", tail].join("\n");
}
