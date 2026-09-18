import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLASS_LIST_PREFS,
  parseClassDays,
  parseClassListPrefs,
} from "./list-prefs";
import {
  classKindMeta,
  classStatusMeta,
  KIND_FILTERS,
  matchesClassKind,
  parseClassKind,
  parseClassSort,
  parseClassStatus,
  parseClassView,
} from "./list-filters";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const PAGE = "app/(shell)/classes/page.tsx";

describe("수업목록 보기 설정(users.ui_prefs.classes)", () => {
  it("깨진 값·모르는 키는 기본값으로 접는다", () => {
    expect(parseClassListPrefs(undefined)).toEqual(DEFAULT_CLASS_LIST_PREFS);
    expect(parseClassListPrefs(null)).toEqual(DEFAULT_CLASS_LIST_PREFS);
    expect(parseClassListPrefs([1, 2])).toEqual(DEFAULT_CLASS_LIST_PREFS);
    expect(parseClassListPrefs({ subject: "", teacher: 7, days: "x", sort: "zzz", view: "grid", status: "all" })).toEqual(
      DEFAULT_CLASS_LIST_PREFS,
    );
  });

  it("저장된 값은 그대로 살린다(상태·검색어는 애초에 키가 없다)", () => {
    const p = parseClassListPrefs({ kind: "special", subject: "english", teacher: "t1", days: ["wed", "mon"], sort: "students", view: "cards" });
    expect(p).toEqual({ kind: "special", subject: "english", teacher: "t1", days: ["mon", "wed"], sort: "students", view: "cards" });
    expect("status" in p).toBe(false);
    expect("q" in p).toBe(false);
  });

  it("요일은 URL 문자열·배열 둘 다 받고, 모르는 키·'all'은 버리고, 요일순으로 정규화한다", () => {
    expect(parseClassDays("wed,mon")).toEqual(["mon", "wed"]);
    expect(parseClassDays(["fri", "mon", "xx"])).toEqual(["mon", "fri"]);
    expect(parseClassDays("all")).toEqual([]);
    expect(parseClassDays("")).toEqual([]);
    expect(parseClassDays(undefined)).toEqual([]);
  });

  it("정렬·보기·상태는 허용 목록 밖이면 기본값", () => {
    expect(parseClassSort("teacher")).toBe("teacher");
    expect(parseClassSort("nope")).toBe("name");
    expect(parseClassView("cards")).toBe("cards");
    expect(parseClassView("grid")).toBe("table");
    expect(parseClassStatus("ended")).toBe("ended");
    expect(parseClassStatus("closed")).toBe("operating");
    expect(parseClassStatus(undefined)).toBe("operating");
  });

  it("같음 판정은 **JSON 문자열 비교**다(공용 RememberPrefs) — 파서가 키 순서까지 같은 객체를 만든다", () => {
    // 🔑 저장 여부를 `JSON.stringify(current) === JSON.stringify(saved)`로 정하므로, URL에서 온 값과 DB에서 온 값이
    //    **같은 파서**를 지나 같은 키 순서로 나와야 한다(아니면 값이 같아도 렌더마다 저장한다).
    const fromUrl = parseClassListPrefs({ days: "mon", subject: "math", view: "table", sort: "name", teacher: "all" });
    const fromDb = parseClassListPrefs({ subject: "math", teacher: "all", days: ["mon"], sort: "name", view: "table" });
    expect(JSON.stringify(fromUrl)).toBe(JSON.stringify(fromDb));
    expect(JSON.stringify(parseClassListPrefs({ ...fromDb, days: ["tue"] }))).not.toBe(JSON.stringify(fromDb));
  });

  it("구분(정규/특강) — 옛 저장값(키 없음)·모르는 값은 전체", () => {
    // 이 열이 생기기 전에 저장된 설정엔 kind가 없다 → 전체(= 그때 보던 목록 그대로). 정규로 떨어지면 특강 반이 조용히 사라진다.
    expect(parseClassListPrefs({ subject: "math" }).kind).toBe("all");
    expect(parseClassKind("regular")).toBe("regular");
    expect(parseClassKind("special")).toBe("special");
    expect(parseClassKind("makeup")).toBe("all"); // 시간표의 '보강' 구분은 수업목록 축이 아니다
    expect(parseClassKind(undefined)).toBe("all");
    expect(KIND_FILTERS.map((o) => o.value)).toEqual(["regular", "special"]);
  });

  it("구분 판정은 isSpecialLecture 한 벌 — 토글 ∪ 이름 폴백 · 알약과 필터가 같은 답", () => {
    const toggled = { isSpecial: true, className: "고등M 심화" };
    const named = { isSpecial: false, className: "주말내신특강(고1)" };
    const plain = { isSpecial: false, className: "중등M 정규 A" };
    expect(classKindMeta(toggled)).toEqual({ kind: "special", key: "cls.kind.special", color: "purple" });
    expect(classKindMeta(named).kind).toBe("special");
    expect(classKindMeta(plain)).toEqual({ kind: "regular", key: "cls.kind.regular", color: "neutral" });
    for (const c of [toggled, named, plain]) {
      expect(matchesClassKind("all", c)).toBe(true);
      expect(matchesClassKind(classKindMeta(c).kind, c)).toBe(true);
      expect(matchesClassKind(classKindMeta(c).kind === "special" ? "regular" : "special", c)).toBe(false);
    }
  });

  it("상태 배지 = 운영 초록(positive) · 종강 앰버 · 폐지 중립 — 라벨은 필터 표와 같은 말", () => {
    // 색(의미색 캐논)·한국어 라벨·사전 키를 **한 줄에서** 돌려준다 — 강사뷰가 영어일 때도 색은 같다.
    expect(classStatusMeta({ isActive: true, closedAt: null })).toEqual({
      key: "cls.status.operating",
      color: "green",
    });
    expect(classStatusMeta({ isActive: true, closedAt: "2026-08-31" })).toEqual({
      key: "cls.status.ended",
      color: "amber",
    });
    expect(classStatusMeta({ isActive: false, closedAt: null })).toEqual({
      key: "cls.status.retired",
      color: "neutral",
    });
  });
});

describe("수업목록 배선", () => {
  const page = read(PAGE);

  it("필터는 열 머리(HeaderFilter + 요일 HeaderDayFilter)이고 옛 필터바는 없다", () => {
    expect(page).toContain("<HeaderFilter");
    expect(page).toContain("<HeaderDayFilter");
    expect(existsSync(join(ROOT, "app/(shell)/classes/_components/class-filter-bar.tsx"))).toBe(false);
    expect(existsSync(join(ROOT, "app/(shell)/classes/_components/filter-shared.ts"))).toBe(false);
  });

  it("보기 설정은 DB(loadClassListPrefs + RememberPrefs) — 수업목록 어디에도 localStorage 없음", () => {
    expect(page).toContain("loadClassListPrefs()");
    expect(page).toContain("<RememberPrefs");
    expect(page).toContain("save={saveClassListPrefs}");
    const dir = join(ROOT, "app/(shell)/classes/_components");
    for (const f of readdirSync(dir)) {
      if (!/\.tsx?$/.test(f)) continue;
      // 주석의 낱말이 아니라 **호출**(localStorage.·localStorage[)만 잡는다.
      expect(readFileSync(join(dir, f), "utf8"), f).not.toMatch(/localStorage\s*[.[]/);
    }
    expect(page).not.toMatch(/localStorage\s*[.[]/);
  });

  it("'전체'는 URL에 명시된다(explicitAll) — 저장값을 이기려면 값이어야 한다", () => {
    expect((page.match(/explicitAll/g) ?? []).length).toBeGreaterThanOrEqual(5); // 구분·과목·정렬·담임·보기
    expect(read("app/(shell)/classes/_components/header-day-filter.tsx")).toContain('"all"');
  });

  it("공용 헬퍼는 지시어 없는 모듈, 저장은 use server 모듈(#81)", () => {
    for (const p of ["features/classes/list-prefs.ts", "features/classes/list-filters.ts"]) {
      const src = read(p);
      // 주석에 그 낱말이 적혀 있으니 '포함'이 아니라 **지시어 위치**(파일 머리·import 줄)로 본다.
      expect(src.trimStart().startsWith('"use client"'), p).toBe(false);
      expect(src, p).not.toMatch(/^import "server-only"/m);
    }
    expect(read("features/classes/server/list-prefs.ts").trimStart().startsWith('"use server"')).toBe(true);
    expect(read("components/remember-prefs.tsx").trimStart().startsWith('"use client"')).toBe(true);
  });

  it("수업목록 창은 최소 크기가 등록돼 있다(8열 표가 그 폭에서 선다)", () => {
    expect(read("components/workspace/window-geometry.ts")).toMatch(/classes: \{ w: 1100, h: 700 \}/);
  });

  it("상시 버튼은 Primary('새 반') + 텍스트('강의실 자동배정') 둘 — 결과 0개여도 표 머리가 남는다", () => {
    expect(page).toContain("<NewClassTrigger");
    expect(page).toContain("<ClassroomAssignButton");
    // 빈 상태는 표 본문(tbody) 안 — 표를 통째로 치우는 분기가 없다.
    expect(page).toMatch(/<tbody[\s\S]*\{empty \?/);
  });

  it("구분 열은 과목 앞 · 알약과 목록 조회가 같은 판정(classKindMeta/matchesClassKind)을 쓴다", () => {
    // 원장 2026-09-18 *"[특강] [정규] [전체]를 구분할 수 있게 열 하나 더 … 과목 앞에"*.
    const thead = page.slice(page.indexOf("<thead"), page.indexOf("</thead>"));
    expect(thead.indexOf("{head.kind}")).toBeGreaterThan(-1);
    expect(thead.indexOf("{head.kind}")).toBeLessThan(thead.indexOf("{head.subject}"));
    expect(page).toContain("classKindMeta(c)");
    expect(page).toMatch(/getClassesPage\(\{ kind,/);
    const queries = read("features/classes/server/queries.ts");
    expect(queries).toContain("matchesClassKind(kind,");
    // 화면이 반 이름을 다시 읽지 않는다(시간표·MCS와 같은 규약) — '특강' 문자열 매칭은 special-lecture.ts 한 곳.
    expect(page).not.toMatch(/includes\("특강"\)/);
  });

  it("열 제목과 본문 값이 같은 축(가운데)에 선다 — 본문 칸도 text-center", () => {
    // 원장 2026-09-18 *"행제목과 밑에 내용이 어긋난거 같은데 정렬해주고"* — 제목만 가운데면 넓은 칸에서 제목과 값이 갈린다.
    const tbody = page.slice(page.indexOf("<tbody"), page.indexOf("</tbody>"));
    expect(tbody).toContain("[&>td]:text-center");
    expect(tbody).not.toMatch(/text-right/);
  });

  it("'운영' 배지는 classStatusMeta 단일 소스(화면 로컬 맵·primary 알약 없음)", () => {
    expect(page).toContain("classStatusMeta(c)");
    expect(page).not.toMatch(/Pill color="primary" soft=\{false\}/);
  });
});
