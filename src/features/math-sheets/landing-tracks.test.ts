import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MathClassCard } from "./server/landing";

const mocks = vi.hoisted(() => ({ landing: vi.fn() }));
vi.mock("./server/landing", () => ({ getMathSheetLanding: mocks.landing }));
vi.mock("@/lib/auth/require-access", () => ({ requireAccess: async () => ({ systemRole: "master" }) }));
vi.mock("@/features/math-progress-map/server/access", () => ({ canPreviewProgressMap: async () => false }));
vi.mock("@/components/embed-link", () => ({ EmbedLink: (props: Record<string, unknown>) => createElement("a", props) }));
vi.mock("@/components/period-nav", () => ({ PeriodNav: () => createElement("div", null, "월 선택") }));
import Page from "@/app/(shell)/mcs/page";
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

describe("랜딩에서 반과 작성률 표시", () => {
  const card = (name: string, special: boolean, shown = 10): MathClassCard => ({
    classId: name, className: name, isSpecial: special, teacherName: "김선생", dayCount: 8,
    elapsedDays: 3, studentCount: 5, extraCount: 0, extraTitle: null, written: shown, shown, pct: shown ? 100 : 0,
  });
  async function render(cards: MathClassCard[]) {
    mocks.landing.mockResolvedValue({ ok: true, data: { cards, month: "2026-09", monthLabel: "2026년 9월", emptyReason: null } });
    return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  }
  it("한 종류만 있으면 빈 반쪽 제목을 표시하지 않는다", async () => {
    const html = await render([card("정규반", false)]);
    expect(html).toContain("정규반");
    expect(html).not.toContain(">특강<");
    expect(html).toContain("/mcs/정규반/month?month=2026-09");
  });
  it("두 종류가 있으면 모든 반이 한 번씩 나타난다", async () => {
    const html = await render([card("정규반", false), card("특강반", true)]);
    expect(html.match(/href="\/mcs\//g)).toHaveLength(2);
    expect(html).toContain(">정규<");
    expect(html).toContain(">특강<");
  });
  it("작성 대상이 없는 반은 100% 대신 출결 기록 없음을 표시한다", async () => {
    const html = await render([card("빈반", true, 0)]);
    expect(html).toContain("출결 기록 없음");
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain("100%");
  });
  it("분류는 시간표와 같은 서버 판정만 사용한다", () => {
    const landing = readFileSync("src/features/math-sheets/server/landing.ts", "utf8");
    expect(landing).toContain("isSpecialLecture(");
  });
});
