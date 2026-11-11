import { createHash } from "node:crypto";
import { CONSULT_RUBRIC_ID } from "./rubric";
import type { ConsultationRatingInput } from "./types";

/** 녹음 전사문은 길어질 수 있다(실측 최대 약 4,700자) — 상한만 둔다. */
export const TRANSCRIPT_MAX = 8_000;

const AUDIENCE: Record<string, string> = { parent: "학부모", student: "학생", both: "학부모+학생" };

/** 모델이 평가하는 본문 — 녹음 전사가 있으면 전사문, 아니면 화면에 보이는 기록 글. */
export const bodyOf = (c: Pick<ConsultationRatingInput, "summary" | "transcript">): string =>
  (c.transcript ? c.transcript.slice(0, TRANSCRIPT_MAX) : c.summary).trim();

/** 평가 카드 — 학생·상담자 이름 칸은 없다(과목·상대·학년·자료 종류만). */
export function consultationCard(c: ConsultationRatingInput): string {
  const head = `과목: ${c.subject ?? "미표기"} · 상대: ${c.audience ? AUDIENCE[c.audience] : "미표기"} · 학년: ${c.grade ?? "미표기"} · 자료 종류: ${c.transcript ? "녹음 전사" : "수기 기록"}`;
  const follow = c.followUpAction?.trim() ? `\n후속 조치 칸: ${c.followUpAction.trim()}` : "";
  const ref = c.copyStudents > 1 ? `\n\n[참고 — 상담자에게는 보이지 않는 정보]\n같은 글이 서로 다른 학생 ${c.copyStudents}명에게 그대로 입력되어 있다.` : "";
  return `${head}\n본문:\n${bodyOf(c)}${follow}${ref}`;
}

/** 입력 지문 — 기준 판 + 그 상담 자신의 칸(+ 같은 글 수). 상담을 고치면 달라져 다시 줄을 선다. */
export function consultationInputHash(c: ConsultationRatingInput): string {
  const own = [c.id, bodyOf(c), c.subject, c.audience, c.grade, c.followUpAction?.trim() || null, c.copyStudents > 1 ? c.copyStudents : 1, c.transcript ? "rec" : "memo"];
  return createHash("sha256").update(`${CONSULT_RUBRIC_ID}\n${JSON.stringify(own)}`).digest("hex").slice(0, 32);
}
