import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { teacherNameFor, teacherNamesFor } from "./teacher-name";

/** 실측(2026-09-03 injaewon) — 영어 반 담임 8명은 전원 english_name을 갖고 있다. */
const MAP = {
  김태건: "Sam",
  정은지: "Charlie",
  송지혜: "Song",
  전양원: "Elsa",
  추민아: "Jane",
  육소희: "Anna",
  이현이: "Hannah",
  이다교: "Daniella",
} as const;

describe("강사 이름 — en이면 영어 이름, 없으면 한국어 그대로", () => {
  it("en + 영어 이름 있음 → 영어 이름", () => {
    expect(teacherNameFor("김태건", MAP, "en")).toBe("Sam");
    expect(teacherNameFor("정은지", MAP, "en")).toBe("Charlie");
  });

  it("🔴 ko는 글자까지 그대로 — 한국어 화면은 안 바뀐다", () => {
    expect(teacherNameFor("김태건", MAP, "ko")).toBe("김태건");
  });

  it("🔴 영어 이름이 없으면 en에서도 한국어 이름 그대로 — 빈 칸도, 지어낸 이름도 금지", () => {
    expect(teacherNameFor("남정화", MAP, "en")).toBe("남정화");
    expect(teacherNameFor("이수진", MAP, "en")).toBe("이수진");
  });

  it("🔴 사람이 아닌 라벨(자리·강의실)은 손대지 않는다", () => {
    for (const l of ["LAB", "JJ", "본원604", "305"]) {
      expect(teacherNameFor(l, MAP, "en")).toBe(l);
    }
  });

  it("라벨이 이미 영어 별명이면 그대로 둔다(부원장→Yoojin 별칭·Song 등)", () => {
    expect(teacherNameFor("Song", MAP, "en")).toBe("Song");
    expect(teacherNameFor("Yoojin", MAP, "en")).toBe("Yoojin");
  });

  it("공백을 다듬고, 빈 값은 null(호출부가 '이름 없음'을 스스로 처리한다)", () => {
    expect(teacherNameFor("  김태건  ", MAP, "en")).toBe("Sam");
    expect(teacherNameFor("   ", MAP, "en")).toBeNull();
    expect(teacherNameFor(null, MAP, "en")).toBeNull();
    expect(teacherNameFor(undefined, MAP, "ko")).toBeNull();
  });

  it("표가 없으면(조회 실패) 한국어 이름 그대로 — 화면이 비지 않는다", () => {
    expect(teacherNameFor("김태건", null, "en")).toBe("김태건");
    expect(teacherNameFor("김태건", {}, "en")).toBe("김태건");
  });

  it("여러 이름은 같은 규칙을 각각 태우고 빈 값은 버린다", () => {
    expect(teacherNamesFor(["김태건", null, "남정화", "  "], MAP, "en")).toEqual(["Sam", "남정화"]);
  });
});

/**
 * 🔴🔴 **학부모·사무실 표면은 한국어 이름 고정** — 학부모는 강사의 영어 이름을 모른다.
 * (학생 이름 규약 [`student-name.test.ts`](./student-name.test.ts)와 같은 방식의 구조 가드.)
 */
describe("🔴 학부모·사무실 표면은 이 규칙을 쓰지 않는다", () => {
  const ROOT = join(process.cwd(), "src");
  const FORBIDDEN_DIRS = [
    join(ROOT, "features", "report-admin"),
    join(ROOT, "features", "onescreen"),
    join(ROOT, "features", "exports"),
    join(ROOT, "features", "messaging"),
    join(ROOT, "app", "(print)"),
  ];

  const walk = (dir: string): string[] => {
    let out: string[] = [];
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return out;
    }
    for (const e of entries) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) out = out.concat(walk(p));
      else if (/\.(ts|tsx)$/.test(p)) out.push(p);
    }
    return out;
  };

  it.each(FORBIDDEN_DIRS)("%s 는 teacher-view/teacher-name 을 import하지 않는다", (dir) => {
    const offenders = walk(dir).filter((f) => /teacher-view\/teacher-name/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
