import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { studentDisplayName, studentNameParts } from "./student-name";

describe("학생 이름 표기 — en에서 영어 이름이 주 이름", () => {
  it("en + 영어 이름 있음 → 주=영어 · 보조=한글(지금의 반대)", () => {
    expect(studentNameParts("김두나", "Ruby", "en")).toEqual({ primary: "Ruby", secondary: "김두나" });
  });

  it("🔴 ko는 지금과 글자까지 같다 — 주=한글 · 보조=영어", () => {
    expect(studentNameParts("김두나", "Ruby", "ko")).toEqual({ primary: "김두나", secondary: "Ruby" });
  });

  it("🔴 영어 이름이 없으면 en에서도 한글 이름 그대로 — 빈 칸 금지", () => {
    expect(studentNameParts("김두나", null, "en")).toEqual({ primary: "김두나", secondary: null });
    expect(studentNameParts("김두나", "   ", "en")).toEqual({ primary: "김두나", secondary: null });
  });

  it("같은 글자면 보조를 달지 않는다(같은 이름 두 번 금지)", () => {
    expect(studentNameParts("Ruby", "Ruby", "en")).toEqual({ primary: "Ruby", secondary: null });
    expect(studentNameParts("Ruby", "Ruby", "ko")).toEqual({ primary: "Ruby", secondary: null });
  });

  it("공백은 다듬는다(저장값에 섞여 있어도 화면은 깔끔하게)", () => {
    expect(studentNameParts("  김두나 ", " Ruby ", "en").primary).toBe("Ruby");
  });

  it("한 줄 자리는 주 이름만", () => {
    expect(studentDisplayName("김두나", "Ruby", "en")).toBe("Ruby");
    expect(studentDisplayName("김두나", "Ruby", "ko")).toBe("김두나");
    expect(studentDisplayName("김두나", null, "en")).toBe("김두나");
  });

  it("이름이 아예 없어도 무엇이든 보여 준다(데이터 오류에서도 빈 칸 금지)", () => {
    expect(studentNameParts(null, "Ruby", "en").primary).toBe("Ruby");
    expect(studentNameParts(null, "Ruby", "ko").primary).toBe("Ruby");
  });
});

/**
 * 🔴🔴 **학부모에게 나가는 경로는 한글 이름 고정**(원장 2026-09-03) — 학부모는 영어 이름을 모른다.
 * 화면 표기 규칙이 그쪽으로 새면 알림장·인쇄물·엑셀에 낯선 이름이 찍힌다.
 * 그래서 "그 경로가 이 모듈을 import하지 않는다"를 **구조로** 잠근다(사람의 기억이 아니라 테스트가).
 */
describe("🔴 학부모 표면·내보내기는 이 규칙을 쓰지 않는다", () => {
  const ROOT = join(process.cwd(), "src");
  const FORBIDDEN_DIRS = [
    // 학부모에게 실제로 나가는 것들
    join(ROOT, "features", "report-admin"), // ClassNote 발송·공지
    join(ROOT, "features", "onescreen"), // 수업보고서 본문·멘트
    join(ROOT, "features", "exports"), // 엑셀 내보내기
    join(ROOT, "features", "messaging"), // 알림톡·문자
    join(ROOT, "app", "(print)"), // 인쇄물
  ];

  const walk = (dir: string): string[] => {
    let out: string[] = [];
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return out; // 없는 디렉터리는 건너뛴다(구조가 바뀌어도 가드가 죽지 않게)
    }
    for (const e of entries) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) out = out.concat(walk(p));
      else if (/\.(ts|tsx)$/.test(p)) out.push(p);
    }
    return out;
  };

  it.each(FORBIDDEN_DIRS)("%s 는 teacher-view/student-name 을 import하지 않는다", (dir) => {
    const offenders = walk(dir).filter((f) =>
      /teacher-view\/student-name/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("🔴 이 규칙이 검색·정렬·저장 축으로 새지 않는다 — 순수 함수라 DB를 모른다", () => {
    const src = readFileSync(join(ROOT, "features", "teacher-view", "student-name.ts"), "utf8");
    // 조회·저장을 하면 표시 전용이라는 계약이 깨진다.
    expect(src).not.toMatch(/supabase|createClient|from\(|\.select\(|\.update\(/);
  });
});
