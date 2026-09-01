import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  groupMathCardsByTeacher,
  splitLandingByTrack,
  NO_HOMEROOM_LABEL,
} from "./landing-tracks";
import { isSpecialLecture } from "@/features/classes/special-lecture";

const C = (className: string, isSpecial: boolean, teacherName: string | null = "이수진") => ({
  className,
  isSpecial,
  teacherName,
});

describe("splitLandingByTrack — 정규 / 특강 좌우 2단", () => {
  it("정규가 왼쪽, 특강이 오른쪽", () => {
    const panels = splitLandingByTrack([C("중등M 중1 MS2R", false), C("내신중등특강(오전)", true)]);
    expect(panels).not.toBeNull();
    expect(panels!.map((p) => p.key)).toEqual(["regular", "special"]);
    expect(panels!.map((p) => p.label)).toEqual(["정규", "특강"]);
    expect(panels![0].cards.map((c) => c.className)).toEqual(["중등M 중1 MS2R"]);
    expect(panels![1].cards.map((c) => c.className)).toEqual(["내신중등특강(오전)"]);
  });

  it("🔴 특강이 없으면 나누지 않는다 — 원장 \"특강 없으면 정규만\"", () => {
    expect(splitLandingByTrack([C("중등M 중1 MS2R", false), C("초등M 초5 MS1A", false)])).toBeNull();
  });

  it("정규가 없어도 나누지 않는다 — 빈 '정규' 단을 보여 줄 이유가 없다", () => {
    expect(splitLandingByTrack([C("내신중등특강(오전)", true)])).toBeNull();
  });

  it("카드가 없으면 null", () => {
    expect(splitLandingByTrack([])).toBeNull();
  });

  it("🔴 모든 카드가 정확히 한 단에 한 번씩 — 분단의 최소 조건", () => {
    const cards = [
      C("중등M 중1 MS2R", false),
      C("[특강] 고등개별", true),
      C("고등M 개별 TP4E", false),
      C("중등내신특강(목)", true),
      C("초등M 초5 MS1A", false),
    ];
    const panels = splitLandingByTrack(cards)!;
    const flat = panels.flatMap((p) => p.cards);
    expect(flat).toHaveLength(cards.length);
    expect(new Set(flat.map((c) => c.className)).size).toBe(cards.length);
  });

  it("판정은 시간표와 같은 단일 소스를 통과한 값이다 — 여기서 이름을 다시 읽지 않는다", () => {
    // 실측 2026-09-01: 활성 수학 반 72개 중 특강 7개, 전부 컬럼·이름이 함께 참이었다.
    const rows = [
      { class_name: "내신중등특강(9/5)", is_special: true },
      { class_name: "고등M 개별 TP4E", is_special: false },
    ];
    const cards = rows.map((r) => ({
      className: r.class_name,
      teacherName: "이수진",
      isSpecial: isSpecialLecture({ isSpecial: r.is_special, className: r.class_name }),
    }));
    const panels = splitLandingByTrack(cards)!;
    expect(panels[1].cards.map((c) => c.className)).toEqual(["내신중등특강(9/5)"]);
  });
});

describe("groupMathCardsByTeacher — 담임 묶기", () => {
  it("한글 이름순으로 세운다", () => {
    const groups = groupMathCardsByTeacher([
      C("a", false, "이수진"),
      C("b", false, "강민"),
      C("c", false, "이수진"),
    ]);
    expect(groups.map((g) => g.teacherName)).toEqual(["강민", "이수진"]);
    expect(groups[1].cards).toHaveLength(2);
  });

  it("담임이 없으면 '담임 미지정' — 이름을 지어내지 않는다", () => {
    const groups = groupMathCardsByTeacher([C("a", false, null)]);
    expect(groups[0].teacherName).toBe(NO_HOMEROOM_LABEL);
  });

  it("⚠️ 한 담임이 두 단에 걸치면 단마다 묶음이 하나씩", () => {
    const cards = [C("정규1", false), C("특강1", true)];
    const panels = splitLandingByTrack(cards)!;
    expect(panels.map((p) => groupMathCardsByTeacher(p.cards).length)).toEqual([1, 1]);
  });
});

describe("배선 — 랜딩 화면이 이 규칙을 실제로 탄다", () => {
  const page = readFileSync("src/app/(shell)/mcs/page.tsx", "utf8");

  it("랜딩이 splitLandingByTrack을 부른다", () => {
    expect(page).toContain("splitLandingByTrack");
    expect(page).toMatch(/const panels = splitLandingByTrack\(data\.cards\)/);
  });

  it("🔴 한쪽이 비면(=null) 단일 흐름으로 떨어진다 — 원장 \"특강 없으면 정규만\"", () => {
    // `panels ? (…분단…) : (…단일…)` — null 분기가 있어야 빈 반쪽이 안 생긴다.
    expect(page).toMatch(/\)\s*:\s*panels\s*\?\s*\(/);
    expect(page).toMatch(/<TeacherGroups[\s\S]*?columnsClass=\{FULL_COLUMNS\}/);
  });

  it("두 흐름이 같은 기계(TeacherGroups)로 그려진다 — 두 벌이면 갈린다", () => {
    expect(page.match(/<TeacherGroups/g)?.length).toBe(2);
  });

  it("판정은 서버가 단일 소스로 실어 준다 — 화면이 반 이름을 다시 읽지 않는다", () => {
    // 반 이름을 화면에서 다시 읽는 순간 시간표와 갈린다 — 판정은 서버(landing.ts) 한 곳뿐이다.
    expect(page).not.toMatch(/includes\(\s*"특강"\s*\)/);
    expect(page).not.toContain("isSpecialLecture");
    const landing = readFileSync("src/features/math-sheets/server/landing.ts", "utf8");
    expect(landing).toContain("isSpecialLecture(");
  });

  it("⚠️ 좁은 폭(~768px)에선 두 단이 위아래로 쌓인다 — 반 이름이 잘리지 않게", () => {
    expect(page).toMatch(/grid-cols-1 gap-y-5 md:grid-cols-2/);
    // 한 단 안 격자에 sm:/md: 다열을 다시 넣지 말 것(단 폭이 반이라 이름이 통째로 잘린다).
    const panelCols = page.match(/const PANEL_COLUMNS = "([^"]+)"/)?.[1] ?? "";
    expect(panelCols).not.toMatch(/(sm|md|lg):grid-cols-/);
  });
});
