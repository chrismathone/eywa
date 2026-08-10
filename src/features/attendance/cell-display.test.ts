import { describe, expect, it } from "vitest";
import {
  DAY_TONE,
  cellDisplay,
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
