import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHEET_LANG,
  SHEET_DICT,
  SHEET_LANGS,
  SHEET_LANG_LABEL,
  defaultSheetLangFor,
  parseSheetLang,
  resolveSheetLang,
  sheetDateLabelEn,
  sheetDowLabel,
  sheetT,
  sheetWeekLabel,
  sheetWeekLabelEn,
} from "./i18n";

describe("사전 — 값이 비거나 키가 새지 않는다", () => {
  it("모든 키가 ko·en 둘 다 비어 있지 않다", () => {
    const empty = Object.entries(SHEET_DICT).filter(([, v]) => !v.ko.trim() && !v.en.trim());
    expect(empty.map(([k]) => k)).toEqual([]);
  });

  it("한국어 문구는 한 곳도 비지 않는다 — 폴백의 바닥이라 비면 빈 화면이 된다", () => {
    const missing = Object.entries(SHEET_DICT).filter(([, v]) => v.ko.trim() === "");
    expect(missing.map(([k]) => k)).toEqual([]);
  });

  it("영어 문구에 한글이 섞여 있지 않다(붙여넣기 사고 방지)", () => {
    const bad = Object.entries(SHEET_DICT).filter(([, v]) => /[가-힣]/.test(v.en));
    expect(bad.map(([k]) => k)).toEqual([]);
  });

  it("키를 화면에 내지 않는다 — 모든 키가 실제 문구를 돌려준다", () => {
    for (const key of Object.keys(SHEET_DICT) as (keyof typeof SHEET_DICT)[]) {
      for (const lang of SHEET_LANGS) {
        const out = sheetT(lang, key);
        expect(out).not.toBe(key);
      }
    }
  });

  it("🔴 사전에 없는 문구를 화면에 남겨 두지 않는다 — 쓰이지 않는 키(orphan) 금지", () => {
    // 학원설정 규약과 같은 결: "소비처 없는 값은 만들지도 않는다". 지금 사전은 강사 미니셸 크롬
    // ('내 메뉴')·ECS 상단 바·네비·랜딩 프레임에 더해 **시트 본문**(계획 표 `plan.*` · 로스터 `roster.*` ·
    // 퇴원 한 줄 `withdrawn.*`)까지 담는다(원장 2026-09-03 *"하드코딩된것들 전부"* · *"모든 곳을 en 전환"*).
    // 여기에 출결 모드(`quick.*`)·표시 상태(`seat.*`)가 더해졌다(원장 2026-09-04
    // *"강사가 접근 가능한 모든 메뉴를 전환"*). 아직 범위 밖 = 원스크린(수업 마감).
    // ⚠️ 출결 **상태 라벨**은 사전이 아니라 `SEAT_MARK_LABEL_EN`(한글 맵 옆)이 단일 소스라 접두가 없다.
    // 접두사가 늘면 그 구역을 실제로 배선했는지 사람이 한 번 더 보게 하는 가드다.
    const prefixes = new Set(Object.keys(SHEET_DICT).map((k) => k.split(".")[0]));
    expect([...prefixes].sort()).toEqual(
      [
        // 출결 알약(오늘 카드) — 라벨은 `attendanceLabelOf`, 문구만 여기.
        "att",
        "banner",
        "bulk",
        // 셀 충돌(CAS) — 주간 계획 행·오늘 계획이 **같은 UI 두 벌**이라 문구는 한 벌만 둔다.
        "cell",
        "chrome",
        // 수업목록(/classes) — 머리·툴바 필터·표·카드.
        "cls",
        // 접기/펼치기처럼 **여러 구역이 함께 쓰는** 낱말(구역 접두를 붙이면 같은 말이 여러 벌 생긴다).
        "common",
        "face",
        // 교재 깔기(0266a·0268a) — 월간 시트에서 교시를 골라 차수를 깐다. 원어민 강사도 여는 화면이라
        // 문구가 전부 사전에 있어야 한다(`name-wiring.test.ts`가 그 파일의 한글 리터럴 0을 잠근다).
        "fill",
        "filter",
        "landing",
        "lang",
        // 오늘 카드 학생 기록 팝오버(태도·특이사항 + JJ 칸).
        "mark",
        // 내 정보(/me) — 계정·수업보고서 이름.
        "me",
        "menu",
        // 월간 뷰(달력·진도표) — 계획(MP) 보기는 축이 날짜라 `mp.*`로 따로 둔다.
        "month",
        "mp",
        "nav",
        // 원스크린(/onescreen) — 강사 홈. 상단 바·격자·출결 알약·발송 현황.
        "os",
        "plan",
        "popup",
        "presence",
        // 출결 모드(/attendance/quick) — 강사가 복도에서 여는 화면.
        "quick",
        // 이력서 종이 서식(/me) — 🔴 화면만 언어를 타고 **인쇄물은 언제나 한국어**다.
        "res",
        "roster",

        // 예정된 변경 배너 — 반 상세·학생 상세가 같은 조각을 쓴다.

        "sched",
        // 드롭다운(FieldSelect) 공통 — 저장값은 그대로 두고 표시만 언어를 따른다.
        "select",
        "slot",
        "strip",
        // 학생목록(/students) — 머리·툴바 필터·표.
        "stu",
        // makeedu 동기화 배지(목록 화면 상단, 공용) — 사실 문장(issue)은 번역하지 않는다.
        "sync",
        "today",
        "toolbar",
        "withdrawn",
      ].sort(),
    );
  });
});

describe("언어 판정 — 이름이 기본값을 정하고, 고른 값이 언제나 이긴다", () => {
  it("한글 이름 = 한국어 / 로마자 이름 = 영어", () => {
    expect(defaultSheetLangFor("이수진")).toBe("ko");
    expect(defaultSheetLangFor("KRISTINE DRIVER")).toBe("en");
    expect(defaultSheetLangFor("Florence Park")).toBe("en");
  });

  it("이름이 없으면 영어로 떨어진다 — 한글이 '있으면' 한국인이라는 단일 소스 규약 그대로", () => {
    expect(defaultSheetLangFor(null)).toBe("en");
    expect(defaultSheetLangFor("")).toBe("en");
  });

  it("고른 값이 있으면 이름과 무관하게 그것 — 휴리스틱이 틀렸을 때 본인이 되돌릴 수 있어야 한다", () => {
    expect(resolveSheetLang("en", null, "이수진")).toBe("en");
    expect(resolveSheetLang("ko", null, "KRISTINE DRIVER")).toBe("ko");
  });

  it("저장값이 깨졌으면 다음 순서로 — 화면이 비지 않는다", () => {
    expect(resolveSheetLang(undefined, null, "이수진")).toBe("ko");
    expect(resolveSheetLang("klingon", null, "이수진")).toBe("ko");
    expect(resolveSheetLang(42, null, "Florence Park")).toBe("en");
  });

  it("🔴 관리자 지정(0248a)이 이름 휴리스틱을 이긴다 — 샘 킴(=김태건)처럼 이름이 한글인 원어민", () => {
    // 원장 2026-09-03 *"샘 킴 (sam)도 원어민에 등록"*.
    expect(resolveSheetLang(null, "en", "김태건")).toBe("en");
    // 반대 방향도 — 로마자 이름인데 한국어로 지정할 수도 있다.
    expect(resolveSheetLang(null, "ko", "Florence Park")).toBe("ko");
  });

  it("🔴 본인 선택이 관리자 지정보다 **위**다 — 지정은 더 나은 기본값이지 잠금이 아니다", () => {
    expect(resolveSheetLang("ko", "en", "김태건")).toBe("ko");
    expect(resolveSheetLang("en", "ko", "이수진")).toBe("en");
  });

  it("관리자 지정이 없거나 깨졌으면 이름으로 — 지정 없음(null)과 '한국어로 지정'은 다른 사실이다", () => {
    expect(resolveSheetLang(null, null, "김태건")).toBe("ko");
    expect(resolveSheetLang(null, "klingon", "Florence Park")).toBe("en");
  });

  it("parseSheetLang은 모르는 값에 null — 기본값은 호출부가 정한다", () => {
    expect(parseSheetLang("ko")).toBe("ko");
    expect(parseSheetLang("en")).toBe("en");
    expect(parseSheetLang("jp")).toBeNull();
    expect(parseSheetLang(null)).toBeNull();
  });

  it("기본 언어는 한국어 — MCS 등 provider 밖 공용 조각이 이 값으로 떨어진다", () => {
    expect(DEFAULT_SHEET_LANG).toBe("ko");
  });

  it("언어 이름은 번역하지 않는다(자기 언어를 자기 글자로 찾을 수 있어야 한다)", () => {
    expect(SHEET_LANG_LABEL.ko).toBe("한국어");
    expect(SHEET_LANG_LABEL.en).toBe("English");
  });
});

describe("날짜 표기", () => {
  it("요일 알약은 영어에서 세 글자 — 한 글자면 화/수·토/일이 구분되지 않는다", () => {
    expect(sheetDowLabel("wed", "ko")).toBe("수");
    expect(sheetDowLabel("wed", "en")).toBe("Wed");
    expect(sheetDowLabel("sun", "en")).toBe("Sun");
    expect(sheetDowLabel("sat", "en")).not.toBe(sheetDowLabel("sun", "en"));
  });

  it("모르는 요일 키는 그대로 — 지어내지 않는다", () => {
    expect(sheetDowLabel("xyz", "en")).toBe("xyz");
  });

  it("영어 날짜는 KST에서 하루 밀리지 않는다(UTC 파싱 함정)", () => {
    // 2026-09-03은 목요일.
    expect(sheetDateLabelEn("2026-09-03")).toBe("Thu, Sep 3, 2026");
    // 2026-01-01은 목요일 — 연·월 경계에서도 안 밀린다.
    expect(sheetDateLabelEn("2026-01-01")).toBe("Thu, Jan 1, 2026");
  });

  it("깨진 날짜는 원문 그대로 — 빈 칸을 만들지 않는다", () => {
    expect(sheetDateLabelEn("")).toBe("");
    expect(sheetDateLabelEn("nope")).toBe("nope");
  });

  it("영어 주 라벨은 같은 달이면 월을 한 번만 적는다", () => {
    // 2026-09-07(월) ~ 2026-09-13(일)
    expect(sheetWeekLabelEn("2026-09-07")).toBe("Sep 7 – 13, 2026");
  });

  it("달을 넘기는 주는 양쪽 월을 적는다", () => {
    // 2026-08-31(월) ~ 2026-09-06(일)
    expect(sheetWeekLabelEn("2026-08-31")).toBe("Aug 31 – Sep 6, 2026");
  });

  it("한국어는 서버가 준 라벨을 그대로 쓴다 — 같은 주가 화면마다 다르게 적히지 않게", () => {
    expect(sheetWeekLabel("2026-09-07", "9월 2주차 (7일~13일)", "ko")).toBe("9월 2주차 (7일~13일)");
    expect(sheetWeekLabel("2026-09-07", "9월 2주차 (7일~13일)", "en")).toBe("Sep 7 – 13, 2026");
  });
});

describe("'내 메뉴' — 라벨이 사전과 어긋나지 않는다", () => {
  const menu = readFileSync(
    join(process.cwd(), "src", "components", "teacher-menu.tsx"),
    "utf8",
  );

  it("🔴 메뉴 파일에 한국어 라벨을 다시 적지 않는다(사전이 단일 소스)", () => {
    // `labelKey: "menu.item.*"`만 있어야 한다 — `label: "출석부"`가 되살아나면 영어 전환에서
    // 그 줄만 한글로 남고, 아무도 에러를 못 본다.
    expect(menu).not.toMatch(/label: "/);
    expect(menu).toContain("labelKey:");
  });

  it("메뉴가 쓰는 키가 사전에 전부 있다", () => {
    const used = [...menu.matchAll(/labelKey: "([^"]+)"/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(10);
    for (const k of used) expect(Object.keys(SHEET_DICT)).toContain(k);
  });

  it("🔴 스위치는 '내 메뉴' 한 곳뿐 — 다른 화면 툴바에 다시 달지 않는다(원장 2026-09-03 지정 자리)", () => {
    expect(menu).toContain("<TeacherLangSwitch />");
    // 🔴 메뉴 **항목**으로 감싸지 않는다 — 항목 안에 버튼 둘을 넣으면 클릭·키보드를 서로 뺏고
    //    스크린리더에 중첩 인터랙티브로 읽힌다. 팝업의 평범한 자식이어야 한다.
    expect(menu).not.toMatch(/<DropdownMenuItem[^>]*>\s*<TeacherLangSwitch/);
  });
});
