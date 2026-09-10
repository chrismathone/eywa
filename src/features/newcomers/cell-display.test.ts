import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { STATUS_STYLE, cellBoxClass, cellHoverClass, cellMarkOf } from "./cell-display";
import { ONBOARDING_ITEMS, progressOf, type OnboardingItemStatus } from "./onboarding-items";

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

  it("통짜 채움(초록)은 완료뿐", () => {
    for (const status of ALL) {
      const filled = cellBoxClass(status, false).includes("bg-green");
      expect(filled, `${status}가 칸을 통째로 칠한다`).toBe(status === "done");
    }
  });

  it("재촉 색은 지연(danger)·오늘·임박(amber)에만 붙는다", () => {
    expect(cellBoxClass("overdue", false)).toContain("text-danger");
    expect(cellBoxClass("due", false)).toContain("amber");
    for (const status of ["upcoming", "pending", "waived"] as const) {
      expect(cellBoxClass(status, false)).not.toContain("text-danger");
      expect(cellBoxClass(status, false)).not.toContain("border-danger");
      expect(cellBoxClass(status, false)).not.toContain("amber");
    }
  });

  it("마우스 오버는 배경 있는 칸만 밝기로 — 틴트를 회색으로 덮지 않는다", () => {
    for (const status of ALL) {
      const hover = cellHoverClass(status, false);
      const hasBg = cellBoxClass(status, false).includes("bg-");
      expect(hover, status).toBe(hasBg ? "hover:brightness-95" : "hover:bg-muted");
    }
  });
});

/**
 * 원장 2026-09-10: *"신규생 관리에서 지난 기간에 되지 않았던 항목들 전부 연붉은색 계열로 셀 색칠해줘"*.
 * `waived`를 완전히 비웠더니 표의 왼쪽 절반이 흰 공백이 됐고, 그 칸들이 곧 "그때 안 한 것"인데
 * 화면이 아무 말도 안 했다. 🔴 칠하는 것은 **표시**일 뿐 세는 것이 아니다(아래 마지막 검사).
 */
describe("지난 기간에 안 된 칸 = 연붉은 틴트", () => {
  const TINT = "bg-danger-soft";

  it("지연·기준일 이전만 칠한다 — 아직 기한이 안 왔거나 이미 한 칸은 안 칠한다", () => {
    for (const status of ALL) {
      const tinted = cellBoxClass(status, false).includes(TINT);
      const past = status === "overdue" || status === "waived";
      expect(tinted, `${status}`).toBe(past);
    }
  });

  it("기준일 이전 칸은 틴트만 — 글자도 테두리 색도 없다", () => {
    expect(cellMarkOf("waived", -40)).toEqual({ kind: "blank" });
    const box = cellBoxClass("waived", false);
    expect(box).toContain(TINT);
    expect(box).toContain("border-transparent");
    expect(box).not.toContain("font-bold");
  });

  it("지연과 클래스가 다르다 — '오늘 손 쓸 수 있는 것'과 '이미 지나간 것'이 뭉개지면 안 된다", () => {
    const overdue = cellBoxClass("overdue", false);
    const waived = cellBoxClass("waived", false);
    expect(overdue).not.toBe(waived);
    // 지연만 또렷하다: 빨강 굵은 글자 + 1px 빨강 테두리.
    expect(overdue).toContain("text-danger");
    expect(overdue).toContain("border-danger");
    expect(overdue).toContain("font-bold");
  });

  it("🔴 칠해도 집계는 그대로 — 기준일 이전은 분모에도 지연에도 안 들어간다", () => {
    // 전부 기준일(2026-09-09) 이전에 기한이 지난 학생. 화면은 전부 연붉게 칠하지만…
    const progress = progressOf(
      { enrolledOn: "2026-06-01", firstClassOn: "2026-06-05" },
      {},
      "2026-09-10",
      ONBOARDING_ITEMS,
      "2026-09-09",
    );
    // …세는 쪽은 한 건도 안 센다(원장 *"지나간 미완료 건에 대해서는 됐고"*).
    expect(progress).toEqual({ dueTotal: 0, doneCount: 0, overdue: 0, dueSoon: 0, rate: 100 });
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

  it("기준일 이전(waived)은 필요시여도 빈 칸 — 틴트도 점선도 없다", () => {
    const box = cellBoxClass("waived", true);
    expect(box).not.toContain("border-dashed");
    // 🔴 필수가 아니라 "안 됐다"가 성립하지 않는다 — 필수 칸과 달리 연붉은 틴트를 안 받는다.
    expect(box).not.toContain("bg-danger-soft");
    expect(box).not.toBe(cellBoxClass("waived", false));
  });

  it("필요시 항목은 어떤 상태에서도 연붉은 틴트를 안 받는다", () => {
    for (const status of ALL) {
      expect(cellBoxClass(status, true), status).not.toContain("bg-danger-soft");
    }
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
