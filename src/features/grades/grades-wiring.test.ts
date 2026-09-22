import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 구조 가드 — 성적 입력표(원장 2026-09-22)가 **한 경로·한 게이트·한 서식**으로 남게 못 박는다.
 *
 * 지키는 것 다섯:
 *  · 성적 칸을 **쓰는 곳은 `server/write.ts` 하나**(격자·학생 상세 폼·엑셀이 같은 함수를 지난다).
 *  · 쓰기 게이트는 `gradeWriteError()` 하나 — 화면에서만 잠그면 주소·POST로 우회된다([[#77]]).
 *  · 0283a 미적용에도 화면이 살고 **저장만 잠긴다**([[#95]]).
 *  · 주소 → 축 해석은 순수 함수 하나(화면·엑셀 라우트가 같은 시트를 가리킨다).
 *  · 엑셀은 **내려받는 서식 = 올리는 서식** 한 배열(재고 선례).
 * 그리고 옛 '시험 등록'이 되살아나지 않는지(원장 결정: 없애고 격자 하나로).
 */
const ROOT = resolve(process.cwd());
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

describe("성적 저장 단일 경로", () => {
  it("🔴 student_grades에 쓰는 곳은 write.ts 하나(삭제 휴지통 한 줄만 예외)", () => {
    const writers: string[] = [];
    for (const f of walk("src")) {
      const src = read(f);
      if (!src.includes('from("student_grades")')) continue;
      // 쓰기 동사가 붙은 파일만 — 조회(select)는 여러 화면이 한다.
      if (/from\("student_grades"\)[\s\S]{0,200}?\.(insert|upsert|update)\(/.test(src)) writers.push(f);
    }
    expect(writers).toEqual(["src/features/grades/server/write.ts"]);
  });

  it("성적 행 삭제는 두 곳뿐 — 칸 비우기(write.ts)와 학생 상세 휴지통(행 id)", () => {
    const deleters = walk("src").filter((f) =>
      /from\("student_grades"\)[\s\S]{0,120}?\.delete\(/.test(read(f)),
    );
    expect(new Set(deleters)).toEqual(
      new Set(["src/features/grades/server/write.ts", "src/features/students/server/actions.ts"]),
    );
  });

  it("격자 저장은 메모를 싣지 않는다 — 실으면 학생 상세 메모가 한 번에 지워진다", () => {
    const grid = read("src/features/grades/server/actions.ts");
    expect(grid).not.toMatch(/notes/);
    // 대신 공용 경로가 '준 행에만' 메모를 싣는다.
    expect(read("src/features/grades/server/write.ts")).toMatch(/notes\?: string \| null/);
  });
});

describe("쓰기 게이트", () => {
  it("🔴 성적을 쓰는 서버 액션은 전부 gradeWriteError()를 지난다", () => {
    for (const f of [
      "src/features/grades/server/actions.ts",
      "src/features/grades/server/excel-actions.ts",
    ]) {
      expect(read(f)).toContain("gradeWriteError");
    }
    // 학생 상세 폼은 students 권한 축을 쓴다(강사 업무 흐름) — 그 게이트가 살아 있는지만 본다.
    expect(read("src/features/students/server/actions.ts")).toMatch(/canWriteTenant\(user\.systemRole, "students"\)/);
  });

  it("엑셀 반영은 명단으로 대조한다 — 파일로 남의 반 성적을 밀어 넣지 못하게", () => {
    const src = read("src/features/grades/server/excel-actions.ts");
    expect(src).toContain("getGradeSheet");
    expect(src).toMatch(/명단에 없는 학생/);
  });
});

describe("마이그레이션(0283a)보다 앱이 먼저 배포돼도 산다", () => {
  it("조회는 fail-soft 플래그로, 저장은 잠근다", () => {
    expect(read("src/features/grades/server/queries.ts")).toContain("gradesSchemaReady");
    for (const f of [
      "src/features/grades/server/actions.ts",
      "src/features/students/server/actions.ts",
    ]) {
      expect(read(f)).toContain("gradesSchemaReady");
    }
  });

  it("마이그레이션 파일이 있고 부분 유니크(WHERE)를 쓰지 않는다([[#113]])", () => {
    const sql = read("supabase/migrations/0283a_student_grades_term.sql");
    expect(sql).toContain("create unique index if not exists ux_grades_term_slot");
    expect(sql).not.toMatch(/create unique index[\s\S]{0,200}?where/i);
  });
});

describe("축 해석·서식 단일 소스", () => {
  it("화면과 엑셀 라우트가 같은 해석 함수를 쓴다", () => {
    for (const f of ["src/app/(shell)/exams/page.tsx", "src/app/api/exams/excel/route.ts"]) {
      expect(read(f)).toContain("resolveGradeSelection");
    }
  });

  it("엑셀 빌더·파서가 같은 열 배열을 읽는다", () => {
    for (const f of [
      "src/features/grades/server/excel-build.ts",
      "src/features/grades/server/excel-actions.ts",
    ]) {
      expect(read(f)).toContain("SCORE_SHEET_COLUMNS");
    }
  });

  it("🔴 과목 라벨을 화면에 하드코딩하지 않는다(학원설정 단일 소스)", () => {
    const page = read("src/app/(shell)/exams/page.tsx");
    expect(page).toContain("buildSubjectMaps");
    expect(page).not.toMatch(/"(수학|영어|과학|국어)"/);
  });
});

describe("옛 '시험 등록'은 되살아나지 않는다(원장 2026-09-22)", () => {
  it("시험 상세 라우트·등록 폼이 없다", () => {
    expect(existsSync(join(ROOT, "src/app/(shell)/exams/[id]"))).toBe(false);
    expect(existsSync(join(ROOT, "src/app/(shell)/exams/_components/exam-form-dialog.tsx"))).toBe(false);
    expect(existsSync(join(ROOT, "src/features/exams/server/actions.ts"))).toBe(false);
  });

  it("인재원 JJ 보기는 그대로 산다(데이터가 다른 화면 — 함께 걷어내지 말 것)", () => {
    const page = read("src/app/(shell)/exams/page.tsx");
    expect(page).toContain("JjStudyView");
    expect(page).toContain("JjExamView");
  });
});
