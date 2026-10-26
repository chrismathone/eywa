import { describe, expect, it } from "vitest";
import { cleanSpeakerLabel, cleanSpeakerLabels } from "./speaker-label";

describe("cleanSpeakerLabel — 화자 이름표는 짧은 이름·직함만", () => {
  it("짧고 설명 없는 이름표는 그대로(옛 저장본 꼴)", () => {
    for (const s of ["대표", "허은진(수학과, 추정)", "이승엽 대리(추정)", "노원장", "박부장(개발팀장)", "영어 교수부장", "회의 기록자", "A"])
      expect(cleanSpeakerLabel(s)).toBe(s);
  });
  it("' (추정)' 띄어쓰기는 옛 저장본 꼴로", () => {
    expect(cleanSpeakerLabel("허은진 (추정)")).toBe("허은진(추정)");
    expect(cleanSpeakerLabel("이승엽 대리  (추정)")).toBe("이승엽 대리(추정)");
  });
  it("괄호 설명·꼬리 설명은 떼고 이름·직함을 남긴다", () => {
    expect(cleanSpeakerLabel("대표 (A와 C가 '대표님'으로 호칭)")).toBe("대표");
    expect(cleanSpeakerLabel("설현 원장(추정) — 학원 재무·세무 관련 질문, 개인사업자 전환 제안")).toBe("설현 원장(추정)");
    expect(cleanSpeakerLabel("교수부장 (이름 미상, 발언 내용으로 확인)")).toBe("교수부장");
    expect(cleanSpeakerLabel("허은진 부원장 (수학과 부원장)")).toBe("허은진 부원장");
    expect(cleanSpeakerLabel("직원(역할 미상)")).toBe("직원");
    expect(cleanSpeakerLabel("교수부장(또는 원장급 관리자)/이름 미상")).toBe("교수부장");
    expect(cleanSpeakerLabel("인재원 담당자(이름 미상) / 대구 침산인재원 JJ실 관리 담당")).toBe("인재원 담당자");
  });
  it("이름·직함이 남지 않는 설명문·'모름' 표시는 버린다(화면은 '화자 A')", () => {
    expect(cleanSpeakerLabel("수학과 담당자로 보이나 이름은 전사에서 확인되지 않음 (참석자 허은진·이승엽 중 누구인지 특정 불가)")).toBe("");
    expect(cleanSpeakerLabel("시스템 기능 구현·설명 담당자로 보이며 A가 '대리님'으로 호칭 (이름은 확인되지 않음)")).toBe("");
    expect(cleanSpeakerLabel("화자 A (질문자/참석자, 구체적 이름·역할 미상)")).toBe("");
    expect(cleanSpeakerLabel("미상/미상 (발언 내용 없음 — 특정 불가)")).toBe("");
    expect(cleanSpeakerLabel("미상")).toBe("");
    expect(cleanSpeakerLabel("없음")).toBe("");
    expect(cleanSpeakerLabel("…")).toBe(""); // 프롬프트 예시의 자리표시를 그대로 옮긴 것
    expect(cleanSpeakerLabel("...")).toBe("");
    expect(cleanSpeakerLabel("역할/이름")).toBe("");
    expect(cleanSpeakerLabel("  ")).toBe("");
  });
  it("맵 — 빈 이름표는 빼고, 두 번 돌려도 같다", () => {
    const once = cleanSpeakerLabels({ A: "미상", B: "대표 (호칭으로 확인)", C: "이승엽 대리(추정)" });
    expect(once).toEqual({ B: "대표", C: "이승엽 대리(추정)" });
    expect(cleanSpeakerLabels(once)).toEqual(once);
  });
});
