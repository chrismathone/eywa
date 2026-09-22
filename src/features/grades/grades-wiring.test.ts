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
    // 문구가 아니라 **대조한다는 사실**을 잠근다(매칭 규칙이 바뀌어도 이 가드는 살아 있어야 한다).
    expect(src).toMatch(/명단/);
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

  it("🔴 표식(0284a) 준비 여부는 점수 저장과 **따로** 본다 — 묶으면 점수 저장까지 멈춘다", () => {
    const write = read("src/features/grades/server/write.ts");
    expect(write).toContain("gradeMarksReady");
    expect(write).toContain("gradesSchemaReady");
    // 조회는 컬럼이 없을 때 그 열을 빼고 읽는다(넣으면 PostgREST 400으로 화면이 죽는다).
    const q = read("src/features/grades/server/queries.ts");
    expect(q).toContain("marksReady");
    expect(q).toMatch(/marksReady[\s\S]{0,200}ask1_at/);
    const sql = read("supabase/migrations/0284a_student_grades_marks.sql");
    for (const col of ["ask1_at", "ask2_at", "received_at", "ask1_by", "ask2_by", "received_by"]) {
      expect(sql).toContain(col);
    }
  });
});

describe("성적표 받기 표식(원장 2026-09-22)", () => {
  it("🔴 표식이 켜진 칸은 점수를 비워도 행을 지우지 않는다 — 독촉 기록이 날아가지 않게", () => {
    const write = read("src/features/grades/server/write.ts");
    // 남길 칸 판정이 '점수 또는 표식'이어야 한다(점수만 보면 독촉만 해 둔 칸이 사라진다).
    expect(write).toMatch(/r\.score != null \|\|[\s\S]{0,120}marks/);
  });

  it("🔴 선택 열(메모·표식)은 **같은 모양끼리 묶어** 쓴다 — upsert가 배열 전체에 열을 만든다", () => {
    expect(read("src/features/grades/server/write.ts")).toContain("shapeOf");
  });

  it("🔴 토글된 표식만 쓴다 — 켜져 있던 것을 다시 쓰면 '누가 눌렀나'가 저장한 사람으로 덮인다", () => {
    const src = read("src/features/grades/server/actions.ts");
    expect(src).toMatch(/if \(was === want\) continue;/);
  });

  it("격자는 체크 3칸을 세우고 백분율·석차 열은 없앴다(원장 지시 열 구성)", () => {
    const grid = read("src/app/(shell)/exams/_components/score-grid.tsx");
    expect(grid).toContain("GRADE_MARK_KEYS");
    expect(grid).not.toContain("백분율");
    expect(grid).not.toContain("반 석차");
    // 머리줄과 본문 정렬이 열마다 같아야 한다 — colgroup으로 폭도 고정.
    expect(grid).toContain("<colgroup>");
  });
});

describe("강사는 자기 반이 먼저", () => {
  it("명단·반 목록이 담당 반을 위로 올린다(원장 2026-09-22)", () => {
    const q = read("src/features/grades/server/queries.ts");
    expect(q).toContain("myClassIds");
    expect(q).toMatch(/mine\(a\) - mine\(b\)/);
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
