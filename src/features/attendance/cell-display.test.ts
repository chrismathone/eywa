import { describe, expect, it } from "vitest";
import { COUNTABLE_STATUSES } from "./session-units";
import {
  DAY_TONE,
  GHOST_HATCH,
  cellDisplay,
  ghostBreakdown,
  markNumber,
  rollupDay,
  slotBreakdown,
  type SlotMark,
} from "./cell-display";

describe("markNumber", () => {
  it("결석은 언제나 0(시수를 소비하지 않음)", () => {
    expect(markNumber("absent", null)).toBe("0");
    expect(markNumber("absent", 2)).toBe("0");
    expect(markNumber("excused", null)).toBe("0");
  });
  it("출석·지각·조퇴·보강은 시수(미입력=1)", () => {
    expect(markNumber("present", null)).toBe("1");
    expect(markNumber("late", null)).toBe("1");
    expect(markNumber("early_leave", null)).toBe("1");
    expect(markNumber("makeup", null)).toBe("1");
  });
  it("배수는 그대로 표기(1.5·2)", () => {
    expect(markNumber("present", 1.5)).toBe("1.5");
    expect(markNumber("makeup", 2)).toBe("2");
  });
  it("이상값(0·음수·NaN)은 기본 1로", () => {
    expect(markNumber("present", 0)).toBe("1");
    expect(markNumber("present", Number.NaN)).toBe("1");
  });
});

describe("cellDisplay", () => {
  it("상태별 배경색 — 출석 민트·지각 주황·결석 빨강·조퇴 파랑·보강 보라(전용 att-* 팔레트)", () => {
    expect(cellDisplay("present", null).className).toContain("bg-att-present");
    expect(cellDisplay("late", null).className).toContain("bg-att-late");
    expect(cellDisplay("absent", null).className).toContain("bg-att-absent");
    expect(cellDisplay("early_leave", null).className).toContain("bg-att-leave");
    expect(cellDisplay("makeup", null).className).toContain("bg-att-makeup");
  });
  it("출결(1의 배경)은 쨍한 원색, 날짜(요일) 배경은 그보다 옅다 — 둘이 헷갈리면 안 된다", () => {
    // 쨍한 색은 STATUS_TONE만. 날짜 칸은 att-classday(옅은 민트)/att-weekend(회색)로 계열이 다르다.
    const presentBg = cellDisplay("present", null).className;
    const classDayBg = cellDisplay(null, null, { attendDay: true }).className;
    expect(presentBg).not.toContain(DAY_TONE.classDay);
    expect(classDayBg).not.toContain("bg-att-present ");
  });
  it("수업하는 요일은 민트, 주말·휴일은 회색, 수업 없는 평일은 흰색(배경 클래스 없음)", () => {
    expect(cellDisplay(null, null, { attendDay: true }).className).toContain(DAY_TONE.classDay);
    expect(cellDisplay(null, null, { muted: true }).className).toContain(DAY_TONE.weekend);
    expect(cellDisplay(null, null).className).not.toContain("bg-");
  });
  it("기록 없는 칸은 가운뎃점", () => {
    expect(cellDisplay(null, null).text).toBe("·");
  });
  it("공휴일(muted)이라도 기록이 있으면 상태색이 이긴다", () => {
    expect(cellDisplay("absent", null, { muted: true }).className).toContain("bg-att-absent");
  });
});

const s = (slot: string | null, status: SlotMark["status"], units: number | null = null): SlotMark => ({
  slot,
  status,
  units,
});

describe("rollupDay — 하루 여러 교시를 한 칸으로", () => {
  it("기록이 없으면 null", () => {
    expect(rollupDay([])).toBeNull();
  });
  it("한 건이면 그 건 그대로(count 1) — 종전 동작과 동일", () => {
    expect(rollupDay([s(null, "present")])).toMatchObject({ status: "present", units: 1, count: 1, mixed: false });
  });
  it("🔴 시수는 **합** — 하루 2교시 출석이면 2(급여·회차가 세는 값과 같아야 한다)", () => {
    expect(rollupDay([s("12:30", "present"), s("14:10", "present")])?.units).toBe(2);
    // 배수도 그대로 더한다(1.5 + 1 = 2.5).
    expect(rollupDay([s("12:30", "present", 1.5), s("14:10", "present")])?.units).toBe(2.5);
  });
  it("🔴 출석+결석이 섞이면 대표는 **소비 쪽**(출석) — 대표가 결석이면 행 시수 합이 급여보다 적어진다", () => {
    const r = rollupDay([s("12:30", "present"), s("14:10", "absent")]);
    expect(r?.status).toBe("present");
    expect(r?.mixed).toBe(true); // 빠진 교시는 줄무늬·툴팁이 드러낸다
  });
  it("소비 상태끼리는 눈에 띄는 쪽(지각)이 대표", () => {
    expect(rollupDay([s("12:30", "present"), s("14:10", "late")])?.status).toBe("late");
  });
  it("들은 교시가 하나도 없을 때만 대표가 결석", () => {
    expect(rollupDay([s("12:30", "absent"), s("14:10", "absent")])?.status).toBe("absent");
  });
  it("🔴 시수 0 ⟺ 대표 상태가 결석 계열 — 합계 폴백(`u ?? 1`)이 오작동할 수 없는 근거다", () => {
    // grid/totals.ts는 시수 키가 없으면 1로 본다. 그래서 "세는 상태인데 시수 0"인 칸이 생기면
    // 합계가 조용히 1로 되살아난다(2026-08-18 적대리뷰가 잡은 회귀). consumedUnits가 세는 상태에
    // 대해 항상 ≥1을 돌려주므로 그런 칸은 만들어질 수 없다 — 그 성질을 여기서 잠근다.
    const statuses = ["present", "late", "early_leave", "makeup", "absent", "excused"] as const;
    for (const st of statuses) {
      const r = rollupDay([s("12:30", st), s("14:10", st)])!;
      expect(r.units === 0, `${st}의 시수 0 여부`).toBe(!COUNTABLE_STATUSES.has(r.status));
    }
    // 이상값(0·NaN)을 넣어도 세는 상태면 0이 되지 않는다.
    expect(rollupDay([s("12:30", "present", 0)])!.units).toBe(1);
  });
  it("🔴 결석 교시가 있어도 들은 교시의 시수는 남는다(0이 아니다)", () => {
    expect(rollupDay([s("12:30", "present"), s("14:10", "absent")])?.units).toBe(1);
    // 전부 결석일 때만 0.
    expect(rollupDay([s("12:30", "absent"), s("14:10", "absent")])?.units).toBe(0);
  });
  it("결석·사유결석은 같은 색이라 '섞임'이 아니다(줄무늬로 나눌 게 없다)", () => {
    expect(rollupDay([s("12:30", "absent"), s("14:10", "excused")])?.mixed).toBe(false);
  });
  it("교시 순서는 시각 오름차순, 교시 없는 옛 기록은 맨 앞", () => {
    const r = rollupDay([s("14:10", "absent"), s(null, "present"), s("12:30", "late")]);
    expect(r?.slots.map((x) => x.slot)).toEqual([null, "12:30", "14:10"]);
  });
});

describe("cellDisplay — 교시 롤업 칸", () => {
  const two = rollupDay([s("12:30", "present"), s("14:10", "present")])!;
  const mixed = rollupDay([s("12:30", "present"), s("14:10", "absent")])!;

  it("2교시 출석은 '2'(합계) + 단색", () => {
    const d = cellDisplay("present", null, { day: two });
    expect(d.text).toBe("2");
    expect(d.className).toContain("bg-att-present");
    expect(d.style).toBeUndefined();
  });
  it("🔴 섞인 날은 교시 순서대로 줄무늬 — 두 상태가 한 칸에 다 보인다", () => {
    const d = cellDisplay(mixed.status, null, { day: mixed });
    expect(d.text).toBe("1"); // 들은 1시수만 센다(결석 교시는 0)
    expect(d.style?.background).toBe(
      "linear-gradient(90deg, var(--att-present) 0% 50%, var(--att-absent) 50% 100%)",
    );
  });
  it("교시가 하나면 롤업을 넘겨도 종전과 같다", () => {
    const one = rollupDay([s("12:30", "absent")])!;
    expect(cellDisplay("absent", null, { day: one })).toEqual(cellDisplay("absent", null));
  });
});

describe("cellDisplay — 이 표가 세지 않는 교시(빗금)", () => {
  // 강사 전체 보기에서 남의 교시·자리(JJ)만 있는 날. 값은 없지만 **기록은 있다**.
  it("🔴 빈칸이 아니라 빗금 — 그냥 비워 두면 사람이 그 위에 다시 찍어 남의 기록을 덮는다(#103)", () => {
    const d = cellDisplay(null, null, { attendDay: true, ghost: true });
    expect(d.style?.backgroundImage).toBe(GHOST_HATCH);
    expect(d.className).toContain(DAY_TONE.classDay); // 요일 배경색은 그대로 살아 있다
  });
  it("🔴 값이 있으면 빗금을 안 그린다 — 칸의 주인은 값이다", () => {
    expect(cellDisplay("present", null, { ghost: true }).style).toBeUndefined();
  });
  it("빗금은 backgroundImage — 배경'색'(주말 회색)을 덮지 않는다", () => {
    const d = cellDisplay(null, null, { muted: true, ghost: true });
    expect(d.style?.background).toBeUndefined();
    expect(d.className).toContain(DAY_TONE.weekend);
  });
  it("ghost가 없으면 종전 그대로(스타일 없음)", () => {
    expect(cellDisplay(null, null, { attendDay: true }).style).toBeUndefined();
  });
  it("툴팁은 무엇이 빠졌는지 한글로 펼친다 — raw 코드 금지", () => {
    expect(ghostBreakdown([s("16:20:00", "present"), s("18:20:00", "present")])).toBe(
      "이 선생님 몫으로 세지 않는 기록 · 16:20 출석 1 · 18:20 출석 1",
    );
  });
});

describe("slotBreakdown — 툴팁", () => {
  it("교시 시각 + 상태 + 시수", () => {
    expect(slotBreakdown([s("12:30:00", "present"), s("14:10:00", "absent")])).toBe(
      "12:30 출석 1 · 14:10 결석 0",
    );
  });
  it("교시 없는 옛 기록은 시각 없이", () => {
    expect(slotBreakdown([s(null, "late", 1.5)])).toBe("지각 1.5");
  });
});
