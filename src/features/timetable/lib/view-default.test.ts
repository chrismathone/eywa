import { describe, expect, it } from "vitest";
import {
  shouldSerializeView,
  subjectDefaultView,
  viewForSubjectSwitch,
} from "./view-default";

const subjects = [
  { key: "math", label: "수학" },
  { key: "english", label: "영어", defaultView: "integrated" },
  { key: "korean", label: "국어", defaultView: "쓰레기값" },
  { key: "science", label: "과학", defaultView: "rooms" },
];

describe("과목별 '처음 보이는 뷰'", () => {
  it("설정한 과목은 그 뷰, 미설정은 기본뷰(설정 없던 시절과 같은 동작)", () => {
    expect(subjectDefaultView(subjects, "english")).toBe("integrated");
    expect(subjectDefaultView(subjects, "math")).toBe("basic");
    expect(subjectDefaultView(subjects, "없는과목")).toBe("basic");
    expect(subjectDefaultView(undefined, "english")).toBe("basic");
  });

  it("저장값을 믿지 않는다 — 모르는 값·교실뷰는 기본뷰로 떨어뜨린다", () => {
    // 교실뷰는 전 과목 지도라 과목의 기본 뷰가 될 수 없다(강의실 목록을 미리 안 받아 빈 지도가 된다).
    expect(subjectDefaultView(subjects, "science")).toBe("basic");
    expect(subjectDefaultView(subjects, "korean")).toBe("basic");
  });
});

describe("URL에 view를 실을지 — 기본 뷰면 생략", () => {
  it("기본 뷰와 같으면 생략, 다르면 명시", () => {
    expect(shouldSerializeView("integrated", "integrated")).toBe(false);
    expect(shouldSerializeView("basic", "basic")).toBe(false);
    expect(shouldSerializeView("basic", "integrated")).toBe(true);
  });

  it("🔴 기본 뷰가 통합뷰인 과목에서도 '기본뷰'를 고를 수 있어야 한다", () => {
    // 예전 규칙("basic이면 생략")이면 여기가 false가 되어 파라미터 없는 URL → 다시 통합뷰로
    // 되돌아온다 = 기본뷰를 영영 못 고른다. 이 한 줄이 그 회귀를 막는다.
    expect(shouldSerializeView("basic", "integrated")).toBe(true);
  });
});

describe("과목 전환 시 실어 나를 뷰", () => {
  it("기본 뷰를 그대로 보고 있었으면 새 과목의 기본 뷰를 따른다", () => {
    // 수학(기본뷰) → 영어: 영어의 기본 뷰(통합뷰)로. 이게 이 설정의 존재 이유다.
    expect(viewForSubjectSwitch("basic", "basic", "integrated")).toBe("integrated");
    // 영어(통합뷰) → 수학: 수학의 기본 뷰(기본뷰)로.
    expect(viewForSubjectSwitch("integrated", "integrated", "basic")).toBe("basic");
  });

  it("일부러 다른 뷰로 바꿔 보던 중이면 그 선택을 실어 나른다", () => {
    // 수학을 통합뷰로 바꿔 보던 중 → 영어로 가도 통합뷰 유지.
    expect(viewForSubjectSwitch("integrated", "basic", "integrated")).toBe("integrated");
    // 영어를 기본뷰로 바꿔 보던 중 → 수학으로 가도 기본뷰 유지.
    expect(viewForSubjectSwitch("basic", "integrated", "basic")).toBe("basic");
    // 강사뷰로 보던 중 → 유지(허용 안 되는 과목이면 페이지가 따로 강등한다).
    expect(viewForSubjectSwitch("teacher", "basic", "integrated")).toBe("teacher");
  });
});
