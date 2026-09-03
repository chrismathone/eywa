/**
 * 강사뷰 en 전환의 **배선 회귀 가드** (2026-09-03).
 *
 * 사전으로 옮긴 문구는 화면 파일에서 사라지므로, "한국어가 되살아났다"를 눈으로는 못 잡는다.
 * 여기서 ① 옮긴 자리에 한국어 리터럴이 다시 안 생겼는지 ② 수가 든 문구가 조각으로 이어지지 않았는지
 * ③ 실측으로 고친 레이아웃이 되돌아가지 않았는지를 구조로 잠근다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SHEET_DICT, sheetTf } from "./i18n";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
/** 주석은 규칙을 **설명**하는 자리라 검사에서 뺀다(경고 주석이 위반으로 걸리면 안 된다). */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("옮긴 화면에 한국어 리터럴이 되살아나지 않는다", () => {
  const CASES: [string, string[], string[]][] = [
    [
      join("src", "features", "notifications", "components", "notify-permission-banner.tsx"),
      ["컴퓨터 알림을 켜주세요", "켜기", "나중에"],
      ["banner.notify.title", "banner.notify.enable", "banner.notify.later"],
    ],
    [
      join("src", "features", "attendance", "live", "components", "strip-slot.tsx"),
      ["전원 출석", "데스크에 확인 요청", "미입력"],
      ["strip.fillAll", "strip.askDesk", "strip.slotMeta"],
    ],
    [
      join("src", "features", "attendance", "live", "components", "today-strip.tsx"),
      ["오늘 출석 미입력", "오늘 출결 자세히"],
      ["strip.title", "strip.detailLink"],
    ],
    [
      join("src", "features", "presence", "editing-badge.tsx"),
      ["수정중 ·", "누군가"],
      ["presence.editing", "presence.someone"],
    ],
    [
      join("src", "features", "class-sheets", "components", "day-bulk.tsx"),
      ["일괄 출석{", "일괄 태도{", "태도를 선택하세요"],
      ["bulk.attendance", "bulk.attitude", "bulk.attitudeChoose"],
    ],
  ];

  it.each(CASES)("%s", (file, forbidden, required) => {
    let src = strip(read(file));
    // ⚠️ `editing-badge.tsx`엔 **관리자 전용** `EditingBanner`가 같이 산다(상담 폼·이력서 폼에서만
    //    쓰인다). 원장 지시가 "관리자뷰는 수정할 필요 없고"라 그쪽은 한국어가 맞으므로 검사에서 뺀다.
    //    🔴 강사도 보는 표면이 그 함수에 생기면 그때 이 슬라이스를 걷고 함께 옮길 것.
    if (file.endsWith("editing-badge.tsx")) src = src.slice(0, src.indexOf("export function EditingBanner"));
    for (const bad of forbidden) expect(src).not.toContain(bad);
    for (const key of required) expect(src).toContain(`"${key}"`);
  });
});

describe("🔴 수가 든 문구는 조각으로 잇지 않는다 — 문장 전체가 사전에 있다", () => {
  it("보간 자리를 가진 키는 한국어·영어 **양쪽 모두** 그 자리를 갖는다", () => {
    const holes = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join(",");
    const bad: string[] = [];
    for (const [k, v] of Object.entries(SHEET_DICT)) {
      if (!/\{[a-zA-Z]+\}/.test(v.ko) && !/\{[a-zA-Z]+\}/.test(v.en)) continue;
      // 한쪽에만 자리가 있으면 그 언어에서 수가 통째로 사라진다(조용한 사실 손실).
      if (holes(v.ko) !== holes(v.en)) bad.push(`${k}: ko[${holes(v.ko)}] en[${holes(v.en)}]`);
    }
    expect(bad).toEqual([]);
  });

  it("🔴 한국어 결과가 옛 문자열과 글자까지 같다(원장 규약: ko 화면 불변)", () => {
    expect(sheetTf("ko", "strip.count", { slots: 10, students: 59 })).toBe("10개 교시 · 59명");
    expect(sheetTf("ko", "strip.slotMeta", { time: "14:20", n: 4 })).toBe("14:20 · 미입력 4명");
    expect(sheetTf("ko", "strip.moreNames", { n: 3 })).toBe(" 외 3명");
    expect(sheetTf("ko", "presence.more", { n: 2 })).toBe(" 외 2명");
    expect(sheetTf("ko", "presence.title", { names: "김태건" })).toBe(
      "김태건님이 지금 이 항목을 수정 중입니다",
    );
    expect(sheetTf("ko", "bulk.attitudeApply", { value: "보통", n: 7 })).toBe('"보통" 적용 7칸');
  });

  it("영어는 수 뒤에 한국어 단위(명·칸·개)를 달지 않는다 — 어순이 무너진 흔적", () => {
    const bad = Object.entries(SHEET_DICT).filter(([, v]) => /\{[a-zA-Z]+\}\s*(명|칸|개|줄|건)/.test(v.en));
    expect(bad.map(([k]) => k)).toEqual([]);
  });
});

/**
 * 🐛 '수정중' 배지 겹침(원장 제보 2026-09-03) — **실측으로 고쳤다**.
 *
 * 크롬 실측(오늘 면): 이 줄이 **131.8px**까지 좁아지면 링크(123px, `shrink-0`)와 배지(89px,
 * `whitespace-nowrap` + 기본 `min-width:auto`라 축소 불가) 때문에 **반 이름이 0px로 사라지고 배지가
 * 96.7px 밖으로 삐져나와** 옆 내용 위에 겹쳐 그려졌다. `flex-wrap`을 주면 +96.7px → **−42.5px**(안쪽),
 * 반 이름 0 → **27.9px**로 회복된다(넓은 카드 533px는 한 줄 그대로).
 *
 * 🔴 그래서 배지에 `shrink-0`을 더하는 건 고침이 아니다 — 애초에 안 줄어들고 있었다.
 */
describe("🐛 오늘 면 카드 머리 줄은 넘칠 때 줄바꿈한다(배지 겹침 회귀 방지)", () => {
  const src = read("src", "features", "class-sheets", "components", "sheet-client.tsx");

  it("TodayCardHead 루트에 flex-wrap이 있다", () => {
    const head = src.slice(src.indexOf("function TodayCardHead"));
    const root = head.slice(head.indexOf("<div className="), head.indexOf(">", head.indexOf("<div className=")));
    expect(root).toContain("flex-wrap");
  });

  it("정상 카드와 빈 카드가 **같은 조각**을 쓴다(두 벌이면 한쪽만 고쳐진다)", () => {
    expect(src.match(/<TodayCardHead/g)?.length).toBe(2);
  });
});
