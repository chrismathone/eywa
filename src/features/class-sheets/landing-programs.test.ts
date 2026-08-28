import { describe, expect, it } from "vitest";
import { splitLandingByProgram } from "./landing-programs";

const c = (className: string, englishTrack: string | null) => ({ className, englishTrack });

describe("splitLandingByProgram", () => {
  it("섞여 있으면 두 단으로 가른다 — **EiE가 왼쪽**(필터 칩·폼 선택지와 같은 순서)", () => {
    const panels = splitLandingByProgram([c("JP2", "eie"), c("중등E_중1 TOP", "injaewon")]);
    expect(panels).not.toBeNull();
    expect(panels!.map((p) => p.key)).toEqual(["eie", "injaewon"]);
    // 라벨은 단일 소스에서 온다(raw 코드 'eie' 노출 금지).
    expect(panels!.map((p) => p.label)).toEqual(["EiE", "인재원 영어"]);
  });

  it("🔴 미분류(null)는 **인재원 쪽**에 든다 — 양쪽을 정확히 일치로 거르면 두 단 모두에서 사라진다", () => {
    const panels = splitLandingByProgram([c("JP2", "eie"), c("이름없는반", null)]);
    expect(panels![1]!.cards.map((x) => x.className)).toEqual(["이름없는반"]);
    expect(panels![0]!.cards.map((x) => x.className)).toEqual(["JP2"]);
  });

  it("모든 카드는 **정확히 한 단에 한 번씩** 들어간다(잃어버린 반·두 번 뜨는 반 0)", () => {
    const cards = [
      c("JP2", "eie"),
      c("중등E_중1 TOP", "injaewon"),
      c("미분류", null),
      c("LS5", "eie"),
      c("이상한값", "eie2"),
    ];
    const panels = splitLandingByProgram(cards)!;
    const flat = [...panels[0]!.cards, ...panels[1]!.cards].map((x) => x.className);
    expect(flat.slice().sort()).toEqual(cards.map((x) => x.className).slice().sort());
    expect(new Set(flat).size).toBe(cards.length);
  });

  it("단 안의 순서는 **서버가 준 그대로**(반 이름순)", () => {
    const panels = splitLandingByProgram([
      c("PJ1", "eie"),
      c("중등E_중1 TOP", "injaewon"),
      c("RTT4", "eie"),
      c("중등E_초6 SKY", "injaewon"),
    ])!;
    expect(panels[0]!.cards.map((x) => x.className)).toEqual(["PJ1", "RTT4"]);
    expect(panels[1]!.cards.map((x) => x.className)).toEqual(["중등E_중1 TOP", "중등E_초6 SKY"]);
  });

  it("한쪽이 비면 null = 나누지 않는다(반쪽을 비워 두면 화면 절반이 낭비)", () => {
    expect(splitLandingByProgram([c("JP2", "eie"), c("LS5", "eie")])).toBeNull();
    expect(splitLandingByProgram([c("중등E_중1 TOP", "injaewon"), c("미분류", null)])).toBeNull();
    expect(splitLandingByProgram([])).toBeNull();
  });

  it("DB 행 모양(snake_case `english_track`)도 그대로 읽는다", () => {
    const panels = splitLandingByProgram([
      { className: "JP2", english_track: "eie" },
      { className: "중등E_중1 TOP", english_track: "injaewon" },
    ])!;
    expect(panels[0]!.cards.map((x) => x.className)).toEqual(["JP2"]);
  });
});
