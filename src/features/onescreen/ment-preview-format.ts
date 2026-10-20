import type { MentResponse } from "./ment-assembly";

/**
 * AI 멘트 탭 미리보기 결과 글 — 학부모가 받을 멘트 · 학습 추세(또는 운영에서 그 칸이 어떻게 되는지) · 무엇으로 조립했는지.
 * 순수(테스트 대상). 원문 코드·영문은 내보내지 않는다 — 검사 사유는 trend-comment.ts의 한글 이름 그대로.
 */
export type MentPreviewParts = {
  /** 학부모께 드리는 말·영상 접수 문장까지 붙인 최종 멘트(비면 ""). */
  comment: string;
  /** 추세를 맡겼을 때의 응답 — 맡기지 않았으면 null. */
  trend: MentResponse | null;
  /** 추세를 맡기지 않은 까닭. */
  trendSkipped: "quiet" | "sample" | null;
  modelLabel: string | null;
  mode: "A" | "B";
  hasSpecialNote: boolean;
  hasClassNotice: boolean;
  /** 말투 지침이 붙은 선생님 이름 — 없으면 null. */
  styleTeacher: string | null;
};

export function trendPreviewLine(trend: MentResponse | null, skipped: MentPreviewParts["trendSkipped"]): string {
  if (!trend) {
    return skipped === "quiet"
      ? "(이 회차엔 쓰지 않습니다 — 지난 알림장 이후 달라진 점이 없거나 말할 흐름이 없습니다. 자동작성 추세 칸은 비워집니다)"
      : "(추세 표본이 부족해 이 회차엔 만들지 않습니다)";
  }
  if (trend.dropped) {
    const why = [...trend.violations, ...(trend.badSpans.length ? ["사실일 수 없는 표기"] : [])].join(" · ");
    return `(운영에선 싣지 않습니다 — 생성 뒤 검사: ${why})\n모델이 쓴 글: ${trend.rawTrend ?? ""}`;
  }
  if (trend.trend) return trend.trend;
  if (trend.quietByModel) return "(모델이 비워 보냈습니다 — 본문과 같은 말뿐이거나 특이사항과 어긋납니다. 자동작성 추세 칸은 비워집니다)";
  return "(응답에 학습 추세가 없습니다 — 운영에선 지난 추세 칸을 그대로 둡니다)";
}

export function formatMentPreview(p: MentPreviewParts): string {
  const basis = [
    "운영 자동작성과 같은 조립",
    p.modelLabel,
    p.mode === "B" ? "2문단(B)" : "단일 멘트(A)",
    p.hasSpecialNote ? "특이사항 있음" : "특이사항 없음",
    p.hasClassNotice ? "반 전체 안내 있음" : null,
    p.styleTeacher ? `${p.styleTeacher} 선생님 말투` : "선생님 말투 없음",
  ].filter(Boolean);
  return [
    "[학부모 멘트]",
    p.comment || "(빈 응답 — 운영에선 이 학생 자동작성이 실패하고 기본 문장으로 채워집니다)",
    "",
    "[학습 추세]",
    trendPreviewLine(p.trend, p.trendSkipped),
    "",
    basis.join(" · "),
    "반 공통 서술(화면에서만 쓰는 임시 칸)은 미리보기에 들어가지 않습니다.",
  ].join("\n");
}
