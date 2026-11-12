import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assignedPanelState, detailPanelsFor, showBriefCard } from "./detail-panels";
import { BOARD_STAGES, stageOfCard } from "./board-stages";

const DETAIL_DIR = "src/app/(shell)/enrollment/[id]";
const read = (f: string) => readFileSync(`${DETAIL_DIR}/${f}`, "utf8");

const card = (outcome: string, assignedClassCount = 0) => ({ outcome, assignedClassCount });

describe("detailPanelsFor — 브리프는 '상담 전'에만 제 자리에 선다", () => {
  it("상담 전(대기·예약)에서는 준비 브리프 그대로", () => {
    for (const outcome of ["pending", "scheduled"]) {
      expect(detailPanelsFor(card(outcome))).toEqual({ pastBrief: false, showAssigned: false });
    }
  });

  it("상담 완료·미등록은 '지난 브리프'이고 배정 카드는 안 선다", () => {
    for (const outcome of ["consulted", "ai_done", "declined", "no_show"]) {
      expect(detailPanelsFor(card(outcome))).toEqual({ pastBrief: true, showAssigned: false });
    }
  });

  it("등록 완료는 '지난 브리프' + 배정 카드", () => {
    expect(detailPanelsFor(card("enrolled"))).toEqual({ pastBrief: true, showAssigned: true });
  });

  it("🔴 반이 붙으면 outcome을 이긴다 — 대기 상태여도 브리프는 내려가고 배정 카드가 선다", () => {
    expect(detailPanelsFor(card("pending", 1))).toEqual({ pastBrief: true, showAssigned: true });
    expect(detailPanelsFor(card("declined", 2))).toEqual({ pastBrief: true, showAssigned: true });
  });

  it("모르는 outcome은 '상담 전'으로 떨어진다(stageOfCard와 같은 폴백)", () => {
    expect(stageOfCard(card("???"))).toBe("before");
    expect(detailPanelsFor(card("???"))).toEqual({ pastBrief: false, showAssigned: false });
  });

  it("판정 재료는 board-stages 하나 — 모든 칸이 정확히 한 쌍의 답을 낸다", () => {
    for (const stage of BOARD_STAGES) {
      for (const outcome of stage.outcomes) {
        const panels = detailPanelsFor(card(outcome));
        expect(panels.pastBrief).toBe(stage.key !== "before");
        expect(panels.showAssigned).toBe(stage.key === "enrolled");
      }
    }
  });
});

describe("showBriefCard — 상세와 수정 화면이 같은 판정으로 브리프 자리를 그린다", () => {
  it("만들어 둔 브리프는 어느 칸에서든 남는다", () => {
    for (const past of [false, true]) {
      for (const status of [null, "failed", "generating"] as const) {
        expect(showBriefCard({ hasBrief: true, status, past })).toBe(true);
      }
    }
  });

  it("상담 전에는 브리프가 없어도 안내 카드(만들기)를 그린다", () => {
    for (const status of [null, "failed", "generating"] as const) {
      expect(showBriefCard({ hasBrief: false, status, past: false })).toBe(true);
    }
  });

  it("🔴 지난 건은 만드는 중일 때만 — 실패만 남은 카드·소개문은 안 그린다", () => {
    expect(showBriefCard({ hasBrief: false, status: "generating", past: true })).toBe(true);
    expect(showBriefCard({ hasBrief: false, status: "failed", past: true })).toBe(false);
    expect(showBriefCard({ hasBrief: false, status: null, past: true })).toBe(false);
  });
});

describe("assignedPanelState — 조회 실패와 '배정 없음'은 다른 사실", () => {
  it("🔴 실패는 학생·건수와 무관하게 error(‘배정 없음’으로 위장 금지)", () => {
    expect(assignedPanelState({ ok: false, hasStudent: true, count: 0 })).toBe("error");
    expect(assignedPanelState({ ok: false, hasStudent: false, count: 0 })).toBe("error");
    // 실패했는데 count가 남아 있어도(호출부 실수) 목록을 그리지 않는다.
    expect(assignedPanelState({ ok: false, hasStudent: true, count: 3 })).toBe("error");
  });

  it("학생 연결 전이면 '아직 학생이 없다'", () => {
    expect(assignedPanelState({ ok: true, hasStudent: false, count: 0 })).toBe("no-student");
  });

  it("학생은 있는데 진행 중인 수강이 0건이면 '배정 없음'", () => {
    expect(assignedPanelState({ ok: true, hasStudent: true, count: 0 })).toBe("empty");
  });

  it("배정이 있으면 목록", () => {
    expect(assignedPanelState({ ok: true, hasStudent: true, count: 1 })).toBe("list");
  });
});

/**
 * 배선 가드 — 화면이 판정을 **다시 짓지 못하게** 구조로 잠근다.
 * 옛 코드는 상세 페이지에서 `outcome === "pending" || outcome === "scheduled"`로 브리프 자리를
 * 정했고, 그래서 칸반이 4칸으로 바뀔 때 이 화면만 조용히 옛 규칙에 남아 있었다.
 */
describe("배선 — 상세 화면은 board-stages 단일 소스만 본다", () => {
  it("page.tsx가 detailPanelsFor로 자리를 정한다", () => {
    const page = read("page.tsx");
    expect(page).toContain("detailPanelsFor");
    expect(page).toMatch(/pastBrief/);
    expect(page).toMatch(/showAssigned/);
  });

  it("상세와 수정 화면이 같은 판정(showBriefCard)으로 브리프를 그린다", () => {
    expect(read("page.tsx")).toContain("showBriefCard(");
    const edit = read("edit/page.tsx");
    expect(edit).toContain("detailPanelsFor(");
    expect(edit).toContain("showBriefCard(");
    expect(edit).toMatch(/<PrepBriefSection\s+pinned/);
  });

  it("🔴 수정 화면의 브리프는 상담 폼 밖(폼 앞)에 있다 — 폼 안 폼·초안 자동저장 오염 방지", () => {
    const edit = read("edit/page.tsx");
    expect(edit.indexOf("<PrepBriefSection")).toBeGreaterThan(-1);
    expect(edit.indexOf("<PrepBriefSection")).toBeLessThan(edit.indexOf("<ConsultationFullForm"));
  });

  it("🔴 브리프 단추가 있는 두 화면은 같은 maxDuration — 생성 액션이 중간에 죽지 않게", () => {
    for (const f of ["page.tsx", "edit/page.tsx"]) {
      expect(read(f), f).toMatch(/export const maxDuration = 300;/);
    }
  });

  it('🔴 상세 화면 파일에 `outcome === "…"` 직접 비교가 없다', () => {
    for (const f of ["page.tsx", "edit/page.tsx", "prep-brief-section.tsx", "prep-brief-body.tsx", "assigned-classes-section.tsx"]) {
      expect(read(f), f).not.toMatch(/outcome\s*===\s*["']/);
    }
  });

  it("🔴 '다시 작성'(브리프 재생성)은 past가 아닐 때만 — AI 호출은 명시 버튼일 때만이라는 규약", () => {
    const sec = read("prep-brief-section.tsx");
    // 재생성 버튼을 켜는 식은 한 곳(showRegenerate)이고 거기에 `!past`가 들어 있어야 한다.
    // 생성 중엔 숨기되 멈춘 작업(240초 · s2_0068)이면 다시 연다 — `!past`는 언제나.
    expect(sec).toMatch(/const showRegenerate\s*=\s*canWrite\s*&&\s*!past\s*&&\s*\(!generating\s*\|\|\s*stalled\)/);
    // 그리고 버튼은 **오직 그 값**으로만 렌더된다(canWrite 단독 조건이 남아 있으면 past에서 되살아난다).
    const guards = sec.match(/\{[^{}]*\?\s*<PrepBriefButton/g) ?? [];
    expect(guards.length).toBeGreaterThan(0);
    for (const g of guards) expect(g).toContain("showRegenerate");
  });

  it("인쇄는 past에서도 남는다 — 이미 만든 스냅샷을 여는 것이라 새 AI 호출이 없다", () => {
    const sec = read("prep-brief-section.tsx");
    const printBlock = sec.slice(sec.indexOf("<PrintWindowButton"), sec.indexOf("</PrintWindowButton>"));
    expect(printBlock).not.toMatch(/\bpast\b/);
  });

  it("🔴 배정 카드는 조회 실패와 '배정 없음'을 다른 문장으로 적는다", () => {
    const sec = read("assigned-classes-section.tsx");
    expect(sec).toContain("assignedPanelState");
    expect(sec).toContain("불러오지 못했습니다");
    expect(sec).toMatch(/배정되지 않았습니다|배정된 반이 없습니다/);
  });
});
