/**
 * 제목 맞추기 — **실측이 근거다.**
 *
 * 아래 폭 기대값은 이 문서가 실제로 쓰는 글꼴(`Arial, Helvetica, sans-serif` · `font-weight: 800`)로
 * 헤드리스 크롬 `measureText`에서 잰 값이다(2026-09-02). 표가 흔들리면 여기서 잡힌다.
 */
import { describe, expect, it } from "vitest";
import { MP_SHEET_PX, MP_SHEET_SIZE, MP_SHEET_LEADING } from "./month-plan-sheet-style";
import {
  MP_TITLE_NAME_STEPS_PT,
  MP_TITLE_PERIOD_STEPS_PT,
  mpFitTitle,
  mpTitleBoxPx,
  mpTitleWidthEm,
} from "./month-plan-title-fit";

/** 실측(크롬, Arial 800, 1000px 기준) — 표가 어긋나면 여기가 먼저 깨진다. */
const MEASURED_EM: Record<string, number> = {
  "Let's Speak 4b": 8.058,
  "Let's Express 1": 8.405,
  "Ready To Talk 5": 8.692,
  "Pre Let's 1a": 6.517,
  "Middle School English Course 1-5": 18.196,
  "(September 2026)": 9.725,
};

describe("mpTitleWidthEm — 글자 수가 아니라 표시 폭", () => {
  it("실측값과 2% 안에서 맞는다", () => {
    for (const [text, measured] of Object.entries(MEASURED_EM)) {
      const est = mpTitleWidthEm(text);
      expect(Math.abs(est - measured) / measured).toBeLessThan(0.02);
    }
  });

  it("글자 수는 폭이 아니다 — 31자 이름이 15자 이름보다 두 배 넘게 넓다", () => {
    expect(mpTitleWidthEm("Middle School English Course 1-5")).toBeGreaterThan(
      mpTitleWidthEm("Let's Express 1") * 2,
    );
  });

  it("한글·모르는 글자도 폭을 준다(0으로 새어 '들어간다'가 되지 않게)", () => {
    // 사전에 없는 약자는 반 이름이 그대로 제목이 된다(`중등E_초6` 같은 이름도 온다).
    expect(mpTitleWidthEm("가나다")).toBe(3); // 한글은 넉넉히 1em
    expect(mpTitleWidthEm("중등E")).toBeCloseTo(2.722, 3);
    expect(mpTitleWidthEm("★")).toBeGreaterThan(0);
    expect(mpTitleWidthEm("")).toBe(0);
  });
});

describe("mpTitleBoxPx — 제목 칸은 문서 폭에 따라 달라진다", () => {
  it("주 3일 3열(데이터 9열) = 540px", () => {
    // 810(문서) − 162(로고 A·B) − 90(강사·범례) − 18(좌우 여백 + 격자선) = 540. 실측 clientWidth 557 −
    // 좌우 패딩 16 = 541이라 1px 보수적이다(넘치는 쪽이 더 나쁘다).
    expect(mpTitleBoxPx(9)).toBe(540);
  });

  it("열이 늘면 제목 칸도 넓어진다", () => {
    expect(mpTitleBoxPx(12)).toBeGreaterThan(mpTitleBoxPx(9));
  });
});

describe("mpFitTitle — 실제 EiE 반 15개(2026-09-02 실데이터)", () => {
  const box9 = mpTitleBoxPx(9); // 주 3일 3열 = 이 학원 EiE 13/15개

  it("보통 반은 시트 원래 크기(24pt) 그대로", () => {
    for (const name of [
      "Let's Express 1",
      "Let's Speak 4b",
      "Ready To Talk 5",
      "Pre Let's 1a",
      "Junior Plus 1",
      "Kopi Wang 3",
      "Pre Junior 2",
      "Let's Talk 6",
    ]) {
      expect(mpFitTitle(name, "(September 2026)", box9)).toEqual({
        nameSize: "24pt",
        periodSize: "12pt",
        clipped: false,
      });
    }
  });

  it("🔴 가장 긴 이름(MEC1-5)만 한 단계 줄어든다 — 브라우저 실측과 같은 답", () => {
    // 실측: 24pt 두 줄이면 이름 줄이 또 접혀 띠(60px)를 넘고(scrollHeight 74), 20pt면 들어간다(59).
    expect(mpFitTitle("Middle School English Course 1-5", "(September 2026)", box9).nameSize).toBe(
      "20pt",
    );
  });

  it("문서가 넓으면(주 4일 이상) 그 이름도 24pt로 돌아온다", () => {
    expect(mpFitTitle("Middle School English Course 1-5", "(September 2026)", mpTitleBoxPx(12)).nameSize).toBe(
      "24pt",
    );
  });

  it("🔴 하한이 있다 — 거기서도 넘치면 `clipped`로 알린다(소비처가 MP_CLIP으로 마감)", () => {
    const fit = mpFitTitle("Middle School English Course 1-5", "(September 2026)", 60);
    expect(fit.nameSize).toBe(`${MP_TITLE_NAME_STEPS_PT[MP_TITLE_NAME_STEPS_PT.length - 1]}pt`);
    expect(fit.clipped).toBe(true);
  });

  it("월 줄이 없으면(달이 모양이 아님) 그 크기 때문에 clipped가 되지 않는다", () => {
    expect(mpFitTitle("LE1", "", mpTitleBoxPx(9)).clipped).toBe(false);
  });
});

describe("🔴 제목 띠(60px)를 넘지 않는다 — 넘으면 표가 밀려 A4 장수가 늘어난다", () => {
  const PT_TO_PX = 96 / 72;

  it("가장 큰 조합(24pt + 12pt)도 두 줄 합이 띠 안에 들어간다", () => {
    const band = Number(MP_SHEET_PX.title.replace("px", ""));
    const two =
      MP_TITLE_NAME_STEPS_PT[0] * PT_TO_PX * MP_SHEET_LEADING.titleName +
      MP_TITLE_PERIOD_STEPS_PT[0] * PT_TO_PX * MP_SHEET_LEADING.titlePeriod;
    expect(two).toBeLessThanOrEqual(band);
  });

  it("사다리 첫 단계 = 시트 원래 제목 크기(둘이 갈리면 안 된다)", () => {
    expect(`${MP_TITLE_NAME_STEPS_PT[0]}pt`).toBe(MP_SHEET_SIZE.title);
  });

  it("사다리는 내림차순이다(고르는 규칙이 '첫 번째로 들어가는 것'이라 순서가 곧 규칙)", () => {
    for (const steps of [MP_TITLE_NAME_STEPS_PT, MP_TITLE_PERIOD_STEPS_PT]) {
      for (let i = 1; i < steps.length; i += 1) expect(steps[i]!).toBeLessThan(steps[i - 1]!);
    }
  });
});
