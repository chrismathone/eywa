import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { STATUS_STYLE, cellBoxClass, cellMarkOf } from "./cell-display";
import { ONBOARDING_ITEMS, type OnboardingItemStatus } from "./onboarding-items";

/**
 * 신규생 체크 칸의 **표시** 회귀 가드.
 *
 * 이 파일이 생긴 이유: 화면의 삼항이 `done`·`upcoming`만 그려서 `due`·`overdue`·`pending`·`waived`
 * 칸이 **글자 하나 없는 색 막대**로 서 있었다("검게 지운 자국"). 상단은 `0% 완료`인데 색칠된 칸이
 * 6개라 한 화면이 스스로 모순됐다. 여기서 잠그는 것은 그 재발 조건 셋이다 —
 * ① 글자가 있어야 할 칸이 비지 않는다 ② `waived`는 비운다 ③ `D-0`을 쓰지 않는다.
 */

const ALL: OnboardingItemStatus[] = ["done", "overdue", "due", "upcoming", "pending", "waived"];

describe("칸 안 글자", () => {
  it("완료는 아이콘, 기준일 이전(waived)은 빈 칸", () => {
    expect(cellMarkOf("done", 3)).toEqual({ kind: "check" });
    // 🔴 134칸에 `—`를 반복하면 그 기호가 화면의 본문이 된다 — 이유는 title·aria-label이 말한다.
    expect(cellMarkOf("waived", -40)).toEqual({ kind: "blank" });
  });

  it("지연·오늘·임박·기한 없음 칸은 절대 비어 있지 않다", () => {
    const cases: Array<[OnboardingItemStatus, number | null]> = [
      ["overdue", -1],
      ["overdue", -9],
      ["due", 0],
      ["due", 3],
      ["pending", null],
    ];
    for (const [status, daysLeft] of cases) {
      const mark = cellMarkOf(status, daysLeft);
      expect(mark.kind, `${status}`).toBe("text");
      expect(mark.kind === "text" && mark.text.length > 0, `${status} 칸이 비었다`).toBe(true);
    }
  });

  it("남은 날 0은 `D-0`이 아니라 `오늘`", () => {
    expect(cellMarkOf("due", 0)).toEqual({ kind: "text", text: "오늘" });
    for (const status of ALL) {
      for (let d = -60; d <= 120; d += 1) {
        const mark = cellMarkOf(status, d);
        if (mark.kind !== "text") continue;
        expect(mark.text, `${status} ${d}`).not.toBe("D-0");
      }
    }
  });

  it("지연은 `+9`가 아니라 `D+9` — 첫 수업 열의 경과일(`+9`)과 뜻이 갈리면 안 된다", () => {
    expect(cellMarkOf("overdue", -9)).toEqual({ kind: "text", text: "D+9" });
    expect(cellMarkOf("overdue", -1)).toEqual({ kind: "text", text: "D+1" });
  });

  it("예정은 남은 날을 그대로 적는다", () => {
    expect(cellMarkOf("upcoming", 29)).toEqual({ kind: "text", text: "D-29" });
  });

  it("기한을 모르면 raw 값·빈 칸이 아니라 한글로 적는다", () => {
    expect(cellMarkOf("pending", null)).toEqual({ kind: "text", text: "미정" });
    // 도달 불가 조합(기한이 있어야 나오는 상태 + 기한 미상)에서도 날짜를 지어내지 않는다.
    expect(cellMarkOf("due", null)).toEqual({ kind: "text", text: "미정" });
  });
});

describe("칸 모양", () => {
  it("여섯 상태가 모두 이름과 클래스를 갖는다", () => {
    for (const status of ALL) {
      expect(STATUS_STYLE[status].label.length, status).toBeGreaterThan(0);
      expect(STATUS_STYLE[status].box.length, status).toBeGreaterThan(0);
    }
  });

  it("통짜 채움은 완료뿐 — 나머지는 흰 바탕이다", () => {
    for (const status of ALL) {
      const filled = cellBoxClass(status, false).includes("bg-");
      expect(filled, `${status}가 칸을 통째로 칠한다`).toBe(status === "done");
    }
  });

  it("재촉 색은 지연(danger)·오늘·임박(amber)에만 붙는다", () => {
    expect(cellBoxClass("overdue", false)).toContain("danger");
    expect(cellBoxClass("due", false)).toContain("amber");
    for (const status of ["upcoming", "pending", "waived"] as const) {
      expect(cellBoxClass(status, false)).not.toContain("danger");
      expect(cellBoxClass(status, false)).not.toContain("amber");
    }
  });
});

describe("'필요시' 항목(2개월 콜)", () => {
  it("정의는 하나뿐이다 — 이 열이 늘면 아래 규약도 다시 볼 것", () => {
    expect(ONBOARDING_ITEMS.filter((i) => i.optional).map((i) => i.key)).toEqual(["month2_call"]);
  });

  it("채움 없이 점선 테두리 — 재촉 색을 쓰지 않는다(상단 '오늘·임박' 숫자와 어긋나지 않게)", () => {
    for (const status of ["overdue", "due", "upcoming", "pending"] as const) {
      const box = cellBoxClass(status, true);
      expect(box, status).toContain("border-dashed");
      expect(box.includes("bg-"), `${status} 필요시 칸이 칠해진다`).toBe(false);
      expect(box, status).not.toContain("danger");
      expect(box, status).not.toContain("amber");
    }
  });

  it("완료는 초록 채움을 유지하되 점선으로 필수와 구분된다", () => {
    const box = cellBoxClass("done", true);
    expect(box).toContain("bg-green");
    expect(box).toContain("border-dashed");
    expect(box).not.toBe(cellBoxClass("done", false));
  });

  it("기준일 이전(waived)은 필요시여도 빈 칸 — 점선조차 없다", () => {
    expect(cellBoxClass("waived", true)).toBe(cellBoxClass("waived", false));
    expect(cellBoxClass("waived", true)).not.toContain("border-dashed");
  });
});

describe("화면은 제 색 맵을 만들지 않는다", () => {
  const screen = readFileSync(
    join(resolve(process.cwd()), "src/app/(shell)/newcomers/_components/newcomer-table.tsx"),
    "utf8",
  );

  it("표시 규약을 cell-display에서 가져다 쓴다", () => {
    expect(screen).toContain("@/features/newcomers/cell-display");
    for (const name of ["STATUS_STYLE", "cellBoxClass", "cellMarkOf"]) {
      expect(screen, name).toContain(name);
    }
  });

  it("상태→클래스 맵을 화면 파일에 복사하지 않는다", () => {
    // 사본은 새 상태를 따라오지 않는다 — 실제로 그렇게 갈라져 정보가 "—"로 삼켜진 전례가 있다.
    expect(screen).not.toContain("Record<OnboardingItemStatus");
  });
});
