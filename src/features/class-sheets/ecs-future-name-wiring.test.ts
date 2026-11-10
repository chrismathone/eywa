/**
 * **ECS의 미래 반 이름** 배선 규약 — 하나만 어긋나도 **에러 없이** 틀린다.
 *
 * ECS는 반 이름이 나오는 표면이 넷이고 **날짜 축이 둘로 갈린다**:
 *   · 주 단위(랜딩 카드·시트 헤더) → `classNameForWeek`(주 시작 이름 + 앞으로 올 개명 예고)
 *   · 날짜 단위(오늘 카드·자리판)  → `resolveClassNameAsOf`(그 날짜의 이름)
 * 축을 섞으면 전환 주에 하루 앞서 가거나(주 끝 이름) 예고를 놓친다.
 *
 * 🔴 그리고 ECS엔 반 이름이 **표시가 아니라 키**인 곳이 하나 있다 — `classnoteStateOf`.
 *    거기에 미래 이름을 먹이면 그 반 보드를 못 찾아 배지가 조용히 '연동 없음'이 된다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const queries = strip(read("src", "features", "class-sheets", "server", "queries.ts"));
const today = strip(read("src", "features", "class-sheets", "server", "today.ts"));
const seat = strip(read("src", "features", "class-sheets", "server", "seat-day.ts"));

describe("🔴 반 이름이 키인 곳엔 미래 이름을 넣지 않는다", () => {
  it("classnoteStateOf는 DB 이름(cls.class_name)을 그대로 받는다", () => {
    // 이 값은 ClassNote **보드 매칭 키**(classKey)다. 표시용 이름을 먹이면 배지가 조용히 틀린다.
    // (2026-10-13 — 그날 정규 명단이 비면 배지를 달지 않는 조건이 붙었다. 키는 여전히 DB 이름.)
    expect(today).toMatch(/classnoteToday: classnoteOn && roster\.length > 0 \? classnoteStateOf\(cls\.class_name as string\) : "untracked"/);
    // 해석된 표시 이름 변수를 여기 넣지 못하게 못박는다.
    expect(today).not.toMatch(/classnoteStateOf\(\s*renamed/);
  });
});

describe("주 단위 표면 — 랜딩 카드·시트 헤더", () => {
  it("두 곳 모두 classNameForWeek를 쓴다(주 끝 이름으로 앞서 가지 않게)", () => {
    expect((queries.match(/classNameForWeek\(/g) ?? []).length).toBe(2);
  });

  it("주 시작·끝을 함께 넘긴다", () => {
    expect(queries).toMatch(/classNameForWeek\([\s\S]{0,120}weekMonday,\s*weekSunday,/);
  });

  it("🔴 오늘을 함께 넘긴다 — 지나간 주에 예고를 붙이지 않기 위해", () => {
    // 예고는 **예약된 때부터 그날까지 내내** 뜬다(원장 2026-08-29). 그 대가로 지난 주 시트까지
    // 앞으로의 일로 어지럽혀지므로, 두 호출부가 `today`를 넘겨 지나간 주만 조용히 만든다.
    expect((queries.match(/weekSunday,[\s\S]{0,60}?today,/g) ?? []).length).toBe(2);
  });

  it("전환 주 예고를 카드·시트가 함께 실어 보낸다", () => {
    expect(queries).toContain("classNameUpcoming");
    expect(queries).toContain("classNameBefore");
  });
});

describe("날짜 단위 표면 — 오늘 카드·자리판", () => {
  it("그 날짜로 판정한다(주 단위 함수를 쓰지 않는다)", () => {
    expect(today).toMatch(/resolveClassNameAsOf\(nameIndex, classId, date,/);
    expect(seat).toMatch(/resolveClassNameAsOf\(nameIndex, s\.class_id, date,/);
    expect(today).not.toContain("classNameForWeek");
    expect(seat).not.toContain("classNameForWeek");
  });
});

describe("🔴 이미 지나간 개명엔 표식을 남기지 않는다", () => {
  // 원장 2026-08-31: *"반이름 변경된 반에 '개명'이라고 남는데 필요없어 그냥 날짜 지나면 반이름
  // 변경되었으면 됨"*. 그 주 이름이 **이미 새 이름**이라 '개명'·'이전 이름'은 알려 주는 것 없이
  // 목록 44줄을 어지럽힌다. 예고(`classNameUpcoming`)는 남는다 — 그건 **아직 오지 않은** 일이라
  // 이름만 봐서는 알 수 없다(그래서 둘은 지우고 하나는 지키는 게 이 가드의 전부다).
  const surfaces = [
    ["src", "app", "(shell)", "ecs", "_components", "landing-list.tsx"],
    ["src", "app", "(shell)", "ecs", "[classId]", "page.tsx"],
    ["src", "app", "(shell)", "timetable", "_components", "class-cell.tsx"],
  ];

  it("세 표면 어디에도 '개명'·'이전 이름' 표식이 없다", () => {
    for (const f of surfaces) {
      const src = strip(read(...f));
      expect(src, f.join("/")).not.toContain("개명");
      expect(src, f.join("/")).not.toContain("이전 이름");
    }
  });

  it("앞으로 올 변경 예고는 그대로 남는다(주 단위 두 표면)", () => {
    for (const f of surfaces.slice(0, 2)) {
      expect(strip(read(...f)), f.join("/")).toContain("classNameUpcoming");
    }
  });
});

describe("날짜 라벨은 한 곳에서만 만든다", () => {
  it("예약 배지·배너가 monthDay를 쓴다(09/01이 아니라 9/1)", () => {
    // 🔴 `slice(5).replace("-","/")`로 직접 만들면 `09/01`이 되어 툴바 배지(`9/1`)와 같은 화면에서
    //    형식이 갈린다. 앞자리 0 규칙의 정본은 date-kst.ts의 monthDayLabel 한 곳이고,
    //    scheduled-import.ts의 monthDay는 그 이름으로 위임만 한다.
    for (const f of [
      ["src", "app", "(shell)", "ecs", "_components", "landing-list.tsx"],
      ["src", "app", "(shell)", "ecs", "[classId]", "page.tsx"],
      ["src", "app", "(shell)", "classes", "[id]", "page.tsx"],
      ["src", "app", "(shell)", "timetable", "_components", "class-cell.tsx"],
      ["src", "features", "timetable", "server", "scheduled-class-change.ts"],
    ]) {
      const src = strip(read(...f));
      expect(src, f.join("/")).not.toContain('slice(5).replace("-", "/")');
    }
  });

  /**
   * 🔴 위임을 되돌리면 **에러 없이** 형식이 갈린다 — `monthDay`·`shortDate`는 이름만 지역이고 서식은
   *    `date-kst` 한 곳에서 만든다. 자릿수를 다시 조립하면(`Number(…)/…`·`slice(5)`) 그 순간 사본이 된다.
   */
  it("지역 이름(monthDay·shortDate)은 date-kst에 위임만 한다", () => {
    for (const [f, call] of [
      [["src", "features", "timetable", "scheduled-import.ts"], "return monthDayLabel(date);"],
      [
        ["src", "app", "(shell)", "calendar", "_components", "event-row.tsx"],
        "return formatShortKoreanDate(ymd);",
      ],
    ] as const) {
      const src = strip(read(...f));
      const where = f.join("/");
      // ① 정본을 부른다(본문이 한 줄 위임이라는 양성 증거).
      expect(src, where).toContain('from "@/lib/date-kst"');
      expect(src, where).toContain(call);
      // ② 자릿수를 다시 조립하지 않는다. 🔴 `}`가 끼는 템플릿(`${Number(m)}/`)까지 잡아야 한다 —
      //    옛 본문이 정확히 그 모양이라, `\)\s*\/`만 보면 되돌려도 이 가드가 통과한다.
      expect(src, where).not.toMatch(/Number\([^)]*\)\}?\s*\//);
      // 🔴 옛 shortDate는 `slice(5, 7)`이라 `slice(5)`로는 안 걸린다.
      for (const inline of ["slice(5)", "slice(5, 7)", "slice(8, 10)"]) {
        expect(src, `${where} — ${inline}`).not.toContain(inline);
      }
    }
  });
});

describe("성능 — 예약 조회는 기존 묶음에 태운다(B4)", () => {
  it("세 표면 모두 Promise.all 안에서 색인을 받는다", () => {
    for (const src of [queries, today, seat]) {
      expect(src).toMatch(/Promise\.all\(\[[\s\S]{0,1200}getClassNameAsOfIndex\(\),/);
    }
  });

  it("직렬 await로 따로 부르지 않는다", () => {
    for (const src of [queries, today, seat]) {
      expect(src).not.toMatch(/const nameIndex = await getClassNameAsOfIndex\(\)/);
    }
  });
});
