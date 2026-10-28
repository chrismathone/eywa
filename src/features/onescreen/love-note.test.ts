import { describe, expect, it } from "vitest";
import {
  buildLoveNotePrompt,
  checkLoveNote,
  extractLoveNote,
  hasLoveNoteFacts,
  maskNames,
  nameTokens,
  pairLoveNoteEdits,
  parseLoveNote,
  sanitizeLoveNoteFacts,
  understandingLevelWord,
} from "./love-note";

describe("사랑의 한마디 초안 — 순수 규칙(원장 2026-10-28)", () => {
  it("보고서 글에서 한마디 본문만 뽑는다(가운데·맨 끝 · 없으면 null)", () => {
    expect(extractLoveNote("■ 진도\n분수\n\n■ 사랑의 한마디\n지아 멋집니다.\n둘째 줄")).toBe("지아 멋집니다.\n둘째 줄");
    expect(extractLoveNote("■ 수업 평가\n표\n\n■ 사랑의 한마디\n응원\n\n■ 단어 학습 현황\n[단어백분위]")).toBe("응원");
    expect(extractLoveNote("■ 사랑의 한마디\n\n■ 진도\nx")).toBeNull();
    expect(extractLoveNote("옛 형식 글")).toBeNull();
    expect(extractLoveNote(null)).toBeNull();
  });

  it("이름 가리기 — 전체 이름과 성 뗀 두 글자, 구분 알파벳은 떼고 본다", () => {
    expect(nameTokens("이다윤A")).toEqual(["이다윤", "다윤"]);
    expect(nameTokens("김")).toEqual([]);
    expect(maskNames("다윤이 오늘 멋졌어요. 이다윤 최고", ["이다윤A"])).toBe("○○이 오늘 멋졌어요. ○○ 최고");
  });

  it("고친 쌍만 — 그대로 보냈거나(공백·문장부호 차이 포함) 비운 것은 뺀다", () => {
    const s = [
      { studentId: "a", reportDate: "2026-10-27", subject: "math", aiNote: "잘했어요." },
      { studentId: "b", reportDate: "2026-10-27", subject: "math", aiNote: "멋져요" },
      { studentId: "c", reportDate: "2026-10-27", subject: "math", aiNote: "좋아요" },
    ];
    const f = [
      { studentId: "a", reportDate: "2026-10-27", subject: "math", note: "잘했어요!" },
      { studentId: "b", reportDate: "2026-10-27", subject: "math", note: "끝까지 해낸 모습이 멋집니다." },
      { studentId: "c", reportDate: "2026-10-27", subject: "math", note: null },
    ];
    expect(pairLoveNoteEdits(s, f)).toEqual([{ ai: "멋져요", sent: "끝까지 해낸 모습이 멋집니다." }]);
  });

  it("사실 다듬기 — 길이 자르기 · 이해도 빈 칸 버림 · 사실 유무", () => {
    const f = sanitizeLoveNoteFacts({ attitude: "  좋음 ", understanding: [{ title: "분수", level: "보통" }, { title: "", level: "x" }], extra: 1 });
    expect(f.attitude).toBe("좋음");
    expect(f.understanding).toEqual([{ title: "분수", level: "보통" }]);
    expect(hasLoveNoteFacts(f)).toBe(true);
    expect(hasLoveNoteFacts(sanitizeLoveNoteFacts(null))).toBe(false);
    expect(understandingLevelWord(10)).toBe("잘 이해함");
    expect(understandingLevelWord(4)).toBe("어려워함");
  });

  it("응답 읽기 — 항목 제목을 같이 보내면 뗀다, 비면 null", () => {
    expect(parseLoveNote({ note: "■ 사랑의 한마디: 지아 멋집니다." })).toBe("지아 멋집니다.");
    expect(parseLoveNote({ note: "  " })).toBeNull();
    expect(parseLoveNote(null)).toBeNull();
  });

  it("생성 뒤 검사 — 사실에 없는 숫자·다른 학생 이름은 거절, 이 학생 이름과 낱말은 통과", () => {
    const facts = { dailyTest: "20문제 중 18개 맞음" };
    const base = { facts, studentName: "김지아", otherNames: ["박하나", "이수진"] };
    expect(checkLoveNote("18개나 맞힌 지아 멋집니다.", base)).toEqual({ ok: true });
    expect(checkLoveNote("90점 받은 지아 멋집니다.", base)).toEqual({ ok: false, reason: "number" });
    expect(checkLoveNote("하나야 오늘도 힘내자.", base)).toEqual({ ok: false, reason: "name" });
    expect(checkLoveNote("하나도 빠짐없이 해낸 지아 멋집니다.", base)).toEqual({ ok: true });
    expect(checkLoveNote("박하나처럼", base)).toEqual({ ok: false, reason: "name" });
  });

  it("프롬프트 — 사실만 근거 · 예시·고친 쌍·최근 한마디가 각 자리에", () => {
    const text = buildLoveNotePrompt({
      studentName: "김지아",
      facts: { attitude: "좋음" },
      examples: ["○○ 멋집니다."],
      recentToStudent: ["지아 성실해요."],
      editPairs: [{ ai: "잘했어요.", sent: "끝까지 해냈어요." }],
    });
    expect(text).toContain("수업 태도: 좋음");
    expect(text).toContain("'김지아'(선생님이 이름만 부르면 '지아')");
    expect(text).toContain("- ○○ 멋집니다.");
    expect(text).toContain("보냄: 끝까지 해냈어요.");
    expect(text).toContain("- 지아 성실해요.");
    expect(text).toContain('{"note"');
  });
});
