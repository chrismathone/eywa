/**
 * **화면 언어 축**과 **담임 판정 축**이 절대 섞이지 않는 것을 잠그는 회귀 테스트 (2026-09-03).
 *
 * ## 왜 이 가드가 있나 — 실존 인물 한 명이 두 축을 정확히 갈라 놓는다
 * 원장 2026-09-03: *"샘 킴 (sam)도 원어민에 등록"* → 후속 확인 *"sam은 좀 특이케이스인데,
 * **한국계 미국인이라 담임을 맡게되는 케이스**네."*
 *
 * 샘 킴 = **김태건**(`english_name = "Sam"`, `job_title = "파트강사"`, `system_role = teacher`).
 *  · **화면**은 영어로 봐야 한다(원어민).
 *  · **담임은 맡는다** — 실측 활성 담임 반 **4개**(PJ2 · LT6 · LS4b · RTT5, 전부 english) + 교시 담당 27개.
 *
 * CLAUDE.md 확정 결정은 *"영어 반 담임 = 한국인 강사 중 최다 · **원어민은 담임을 맡지 않는다**"*이고
 * 그 판정의 단일 소스는 [`isKoreanTeacherName`](@/features/timetable/lib/teacher-label)이다.
 *
 * 🔴🔴 그래서 화면 언어를 **"원어민 여부"라는 하나의 플래그**로 만들어 담임 판정이 읽게 하면,
 *    김태건이 원어민으로 판정되어 **그의 담임 반 4개가 담임 자동채움에서 조용히 빠진다**
 *    (`buildClassUpdates`가 '모호'로 떨어뜨리거나 다른 강사로 뒤집는다 — **에러가 안 난다**).
 *    원장이 원한 것은 **그 사람이 보는 화면의 글자**이지 담임 자격이 아니다.
 *
 * → 그래서 컬럼 이름도 `is_native_speaker`가 아니라 **`teacher_view_lang`**이고(이름이 곧 울타리),
 *   이 파일이 그 울타리를 **구조로** 잠근다. 사람의 기억이 아니라 테스트가 지킨다.
 *
 * ⚠️ 한글 이름으로 등록된 **진짜 원어민**(담임을 안 맡는)이 들어오면 그때는 담임 축에도 명시 지정이
 *    필요하다 — 지금은 어긋나는 활성 직원이 0명이라 만들지 않았다(소비처 없는 설정은 안 만든다).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readMigration } from "@/lib/db/migrations-corpus.mjs";
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

/**
 * 주석은 규칙을 **설명**하는 자리라 검사에서 뺀다(경고 주석 자체가 위반으로 걸리면 안 된다).
 * ⚠️ SQL은 `--`로 주석을 단다 — 이걸 빼먹으면 "왜 `is_native_speaker`가 아닌가"를 적어 둔 0248a의
 *    설명문이 그대로 위반으로 잡힌다(이 가드를 처음 돌렸을 때 실제로 그랬다).
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/^[ \t]*--.*$/gm, "");
}

/** 화면 언어 축을 가리키는 표식들 — 담임 쪽 코드에 하나라도 나타나면 축이 섞인 것이다. */
const LANG_AXIS_TOKENS = [
  "teacher_view_lang",
  "teacherViewLang",
  "resolveSheetLang",
  "defaultSheetLangFor",
  "teacher-view/i18n",
  "teacher-view/lang",
  "teacher-view/view-prefs",
  "SheetLang",
];

/**
 * 담임 판정 축 — 판정 자체(`teacher-label.ts`)와 그것을 소비해 **담임을 정하는** 경로.
 * 여기에 화면 언어가 새어 들어오면 김태건의 담임 반 4개가 사라진다.
 */
const HOMEROOM_AXIS_FILES = [
  join("src", "features", "timetable", "lib", "teacher-label.ts"),
  join("src", "features", "timetable", "import", "structure", "class-updates.ts"),
];

describe("🔴 담임 판정은 화면 언어를 읽지 않는다 (샘 킴 = 한국계 미국인, 화면은 영어·담임은 맡는다)", () => {
  it.each(HOMEROOM_AXIS_FILES)("%s 에 화면 언어 축이 새어 들어오지 않는다", (f) => {
    const src = stripComments(read(f));
    const leaked = LANG_AXIS_TOKENS.filter((t) => src.includes(t));
    expect(leaked).toEqual([]);
  });

  it("🔴 `isKoreanTeacherName`은 이름만 본다 — 컬럼·설정·플래그를 읽지 않는다", () => {
    const src = read(join("src", "features", "timetable", "lib", "teacher-label.ts"));
    const fn = src.slice(src.indexOf("export function isKoreanTeacherName"));
    const body = fn.slice(0, fn.indexOf("\n}") + 2);
    // 판정은 `HANGUL.test(displayName)` 한 줄이어야 한다 — DB 조회·설정 읽기가 들어오면 축이 섞인다.
    expect(body).toContain("HANGUL.test");
    expect(body).not.toMatch(/supabase|from\(|settings|ui_prefs|native/i);
  });

  it("🔴 담임 자동채움은 여전히 `isKoreanTeacherName`을 단일 소스로 쓴다", () => {
    // 이 줄이 사라지면 "원어민은 담임을 맡지 않는다" 규칙 자체가 없어진 것이다(별개 사고).
    const src = stripComments(read(HOMEROOM_AXIS_FILES[1]));
    expect(src).toContain("isKoreanTeacherName");
  });
});

describe("🔴 화면 언어는 담임 판정을 읽지 않는다 (반대 방향)", () => {
  const LANG_FILES = [
    join("src", "features", "teacher-view", "i18n.ts"),
    join("src", "features", "teacher-view", "server", "lang.ts"),
    join("src", "features", "teacher-view", "view-prefs.ts"),
  ];

  it.each(LANG_FILES)("%s 가 담임·반 배정 판정을 끌어오지 않는다", (f) => {
    const src = stripComments(read(f));
    // 담임 축 **판정·데이터** 표식만 본다 — 이게 들어오면 "화면이 영어면 담임이 아니다" 같은 역방향
    // 오염이 시작된다.
    // ⚠️ `담임`·`homeroom`이라는 **낱말 자체는 금지어가 아니다** — 사전에 `"chrome.homeroom" = "담임"`
    //    이라는 정당한 **화면 라벨**이 있다(반 표기 옆에 담임 이름을 적는 자리). 낱말을 막으면 그 라벨을
    //    못 만든다. 막아야 하는 것은 낱말이 아니라 **판정을 끌어오는 배선**이다.
    for (const token of ["buildClassUpdates", "classes.teacher_id", "teacher_id", "class_schedules"]) {
      expect(src).not.toContain(token);
    }
  });

  it("이름 휴리스틱은 **기본값으로만** 쓰인다 — `isKoreanTeacherName`을 부르는 곳은 그 한 함수뿐", () => {
    const src = stripComments(read(join("src", "features", "teacher-view", "i18n.ts")));
    // `defaultSheetLangFor` 안에서만 쓰인다(다른 곳에서 부르면 판정이 흩어진다).
    expect(src.match(/isKoreanTeacherName/g)?.length).toBe(2); // import 1 + 호출 1
  });
});

describe("🔴 화면 언어 축은 '원어민 여부' 플래그가 아니다 — 이름으로 못박는다", () => {
  it("컬럼·필드 이름에 native/원어민을 쓰지 않는다(그 이름이면 다음 사람이 담임에 끌어다 쓴다)", () => {
    const files = [
      "0248a_teacher_view_lang.sql", // 시즌1 합본 구역
      join("src", "features", "teacher-view", "view-prefs.ts"),
      join("src", "features", "staff", "server", "queries.ts"),
    ];
    for (const f of files) {
      const src = stripComments(f.endsWith(".sql") ? readMigration(f) : read(f));
      // 식별자로서의 native — 주석은 위에서 제거했으므로 남아 있으면 진짜 코드다.
      expect(src).not.toMatch(/is_native|isNative|nativeSpeaker|native_speaker/);
    }
  });

  it("0248a는 세 값(null/ko/en)만 허용한다 — boolean으로 좁히면 '지정 없음'이 사라진다", () => {
    const sql = readMigration("0248a_teacher_view_lang.sql");
    expect(sql).toContain("teacher_view_lang");
    expect(sql).toMatch(/in \('ko', 'en'\)/);
    expect(sql).toContain("is null or");
  });
});
