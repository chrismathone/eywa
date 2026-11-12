import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { readMigration } from "@/lib/db/migrations-corpus.mjs";
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

/**
 * 소스 전체를 **한 번만** 읽는다 — 검사마다 다시 훑으면 파일 수천 개라 기본 제한(5초)을 넘겨
 * 내용과 무관하게 빨개진다(실제로 났다). 아래 두 검사는 이 목록을 공유하고 넉넉한 제한을 둔다.
 */
let cached: { file: string; src: string }[] | null = null;
const allSources = () => (cached ??= walk("src").map((file) => ({ file, src: read(file) })));
const SCAN_TIMEOUT = 60_000;

describe("성적 저장 단일 경로", () => {
  it(
    "🔴 student_grades에 쓰는 곳은 write.ts 하나(삭제 휴지통 한 줄만 예외)",
    () => {
      const writers = allSources()
        // 쓰기 동사가 붙은 파일만 — 조회(select)는 여러 화면이 한다.
        .filter(({ src }) => /from\("student_grades"\)[\s\S]{0,200}?\.(insert|upsert|update)\(/.test(src))
        .map(({ file }) => file);
      expect(writers).toEqual(["src/features/grades/server/write.ts"]);
    },
    SCAN_TIMEOUT,
  );

  it(
    "성적 행 삭제는 두 곳뿐 — 칸 비우기(write.ts)와 학생 상세 휴지통(행 id)",
    () => {
      const deleters = allSources()
        .filter(({ src }) => /from\("student_grades"\)[\s\S]{0,120}?\.delete\(/.test(src))
        .map(({ file }) => file);
      expect(new Set(deleters)).toEqual(
        new Set(["src/features/grades/server/write.ts", "src/features/students/server/actions.ts"]),
      );
    },
    SCAN_TIMEOUT,
  );

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
    const sql = readMigration("0283a_student_grades_term.sql");
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
    const sql = readMigration("0284a_student_grades_marks.sql");
    for (const col of ["ask1_at", "ask2_at", "received_at", "ask1_by", "ask2_by", "received_by"]) {
      expect(sql).toContain(col);
    }
  });
});

describe("성적표 받기 표식(원장 2026-09-22)", () => {
  it("🔴 표식이 켜진 칸은 점수를 비워도 행을 지우지 않는다 — 독촉 기록이 날아가지 않게", () => {
    // 판정은 순수 모듈 하나 — write.ts는 그걸 부르기만 한다(두 곳에서 세면 한쪽만 고쳐진다).
    expect(read("src/features/grades/server/write.ts")).toContain("gradeCellKeeps");
    const keep = read("src/features/grades/keep.ts");
    expect(keep).toMatch(/r\.score != null/);
    expect(keep).toMatch(/otherMarks/);
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
    expect(grid).toContain("gradeMarkKeysFor");
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
    for (const f of ["src/app/(shell)/exams/input/page.tsx", "src/app/api/exams/excel/route.ts"]) {
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
    const page = read("src/app/(shell)/exams/input/page.tsx");
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
    const page = read("src/app/(shell)/exams/input/page.tsx");
    expect(page).toContain("JjStudyView");
    expect(page).toContain("JjExamView");
  });
});

describe("시험없음 · 해당 없음(원장 2026-09-22)", () => {
  it("🔴 두 축은 다르다 — 제도상 해당 없음은 저장하지 않고 학년에서 도출한다", () => {
    const q = read("src/features/grades/server/queries.ts");
    expect(q).toContain("examAppliesTo");
    // 안 치는 시험은 **아무것도 쓰지 않는다**(주소·POST로 밀어 넣어도 행이 생기면 안 된다).
    expect(read("src/features/grades/server/actions.ts")).toContain("if (!row.applies) continue;");
  });

  it("사람이 누른 '시험없음'은 같은 저장 경로가 든다(사유 포함)", () => {
    const write = read("src/features/grades/server/write.ts");
    expect(write).toContain("no_exam");
    expect(write).toContain("no_exam_reason");
    // 켜진 칸은 점수가 없어도 행을 남긴다(사유가 기록이다).
    expect(read("src/features/grades/keep.ts")).toMatch(/r\.noExam === true/);
    const sql = readMigration("0285a_student_grades_no_exam.sql");
    expect(sql).toContain("no_exam boolean");
    // 수학의 새 칸(내신·월말평가)이 제약에 들어갔는가 — 빠지면 저장이 23514로 거절된다.
    expect(sql).toContain("'school'");
    expect(sql).toContain("'monthly'");
  });
});

describe("정렬은 계정에 남지만 주소는 안 바꾼다", () => {
  it("🔴 주소를 바꾸면 격자가 다시 마운트되어 적다 만 점수가 날아간다", () => {
    const grid = read("src/app/(shell)/exams/_components/score-grid.tsx");
    expect(grid).toContain("saveSort");
    expect(grid).not.toContain("useRouter");
    expect(grid).not.toContain("router.push");
    // 계정 저장은 ui_prefs의 형제 키를 보존한다(통째로 덮으면 남의 화면 설정이 날아간다) — grades.sort 키만 DB가 고친다.
    const prefs = read("src/features/grades/server/list-prefs.ts");
    expect(prefs).toMatch(/writeUiPrefsNs\([\s\S]*"grades", \{ set: \{ sort \} \}/);
    expect(prefs).not.toMatch(/\.update\(\{ ui_prefs/);
  });
});

describe("목록 규약(원장 2026-09-22 오후)", () => {
  it("🔴 안 치는 시험은 **줄을 안 세운다** — 회색으로 칠해 두면 적을 줄을 눈으로 골라내야 한다", () => {
    const q = read("src/features/grades/server/queries.ts");
    // 🔴 학기까지 넘겨야 한다 — 학년만 보면 중1이 **1학기에도** 통째로 사라진다(원장 2026-09-23).
    expect(q).toMatch(/if \(!examAppliesTo\(sel\.slot, student\.grade, sel\.term\)\) continue;/);
    // 화면에도 그 갈래가 남아 있으면 안 된다(서버가 이미 뺐다).
    expect(read("src/app/(shell)/exams/_components/score-grid.tsx")).not.toContain("해당 없음");
  });

  it("🔴 묶음은 폐기했다 — 되살리면 정렬이 묶음 안에서만 걸려 '학년순'이 화면에서 안 보인다", () => {
    // 원장 2026-09-22 저녁: *"묶음 자체를 없애고 학년을 디폴트로"* (같은 날 오후 결정을 써 보고 뒤집었다).
    expect(read("src/features/grades/types.ts")).not.toContain("GradeGroupBy");
    const grid = read("src/app/(shell)/exams/_components/score-grid.tsx");
    expect(grid).not.toContain("selGroup");
    // 툴바에 그 드롭다운이 다시 서지 않는지(주석의 "한 묶음" 같은 낱말에 걸리지 않게 축 이름으로).
    expect(read("src/app/(shell)/exams/input/page.tsx")).not.toMatch(/axisLabel="묶음"/);
  });

  it("🔴 한 학생은 한 줄 — 지금 다니는 반 줄을 남긴다(반이동 학생이 옛 반으로 남지 않게)", () => {
    const q = read("src/features/grades/server/queries.ts");
    expect(q).toMatch(/!curOn && rOn/);
  });

  it("🔴 표식 축은 **학원 퇴원** 하나 — 반이 끝난 것은 표식이 아니다(원장 2026-09-22)", () => {
    const q = read("src/features/grades/server/queries.ts");
    expect(q).toMatch(/withdrawn: student\.status === "withdrawn"/);
    // 퇴원이어도 적어 둔 것이 있으면 남긴다(기록을 화면에서 지우지 않는다).
    expect(q).toMatch(/!r\.withdrawn \|\| hasAnything\(r\)/);
    const grid = read("src/app/(shell)/exams/_components/score-grid.tsx");
    expect(grid).not.toContain("종료");
    expect(grid).toContain("퇴원");
  });

  it("🔴 성적관리 툴바엔 형광 표기를 쓰지 않는다(원장: 드롭다운마다 크기가 널뛰면 난장판)", () => {
    const page = read("src/app/(shell)/exams/input/page.tsx");
    expect(page).not.toMatch(/^\s+marker$/m);
    expect(page).not.toContain("MARKER_TRIGGER");
  });
});

describe("주소 축 배선", () => {
  it("🔴 화면이 주소의 축을 하나도 빠뜨리지 않는다 — 빠지면 링크만 바뀌고 화면은 안 바뀐다", () => {
    // 2026-09-22 실제 제보: `group`을 안 넘겨서 '학년별'을 눌러도 늘 '반별'로 돌아왔다.
    const sel = read("src/features/grades/selection.ts");
    const from = sel.indexOf("export type RawGradeParams");
    const block = sel.slice(from, sel.indexOf("};", from));
    const keys = [...block.matchAll(/^ {2}(\w+)\?: unknown;/gm)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(5);
    const page = read("src/app/(shell)/exams/input/page.tsx");
    for (const k of keys) expect(page, `page.tsx가 ${k}를 안 읽는다`).toContain(`${k}: sp.${k}`);
  });

  it("툴바 컨트롤은 같은 상자 — 반만 다른 부품이라 치수를 맞춰 준다", () => {
    const page = read("src/app/(shell)/exams/input/page.tsx");
    expect(page).toMatch(/triggerClassName=\{TOOLBAR_SELECT\}/);
  });
});

describe("표가 창 안에서 스크롤한다(원장 2026-09-23)", () => {
  it("🔴 높이는 flex로 **받는다** — `max-h`를 박으면 안쪽 스크롤러가 높이를 못 받아 스크롤 자체가 없다", () => {
    const grid = read("src/app/(shell)/exams/_components/score-grid.tsx");
    // DragScrollArea의 진짜 스크롤러는 안쪽 `h-full`이라, 바깥이 **확정 높이**를 가져야 한다.
    expect(grid).toMatch(/<DragScrollArea scrollY className="[^"]*min-h-\[14rem\] flex-1/);
    expect(grid).not.toContain("max-h-[calc(100dvh");
    // 🔴 같은 축(min-height) 유틸을 겹치지 않는다 — 승자를 CSS 순서가 정한다([[#116]]).
    expect(grid).not.toMatch(/min-h-\[14rem\] min-h-0|min-h-0 min-h-\[/);
    // 폼이 기둥(세로 flex)이어야 표가 남는 높이를 가져간다.
    expect(grid).toMatch(/<form[\s\S]{0,160}?className="flex min-h-0 w-full flex-1 flex-col/);
    // 페이지 루트도 같은 기둥이어야 폼의 flex-1이 잴 높이가 생긴다(등록상담 목록뷰 선례).
    // 🔴 폭으로 가르지 않는다 — 좁은 창만 문서 흐름으로 두면 그 폭에선 `sticky thead`가 붙을
    //    스크롤러가 없어 머리줄 고정이 죽는다(적대적 리뷰 2026-09-23).
    expect(read("src/app/(shell)/exams/input/page.tsx")).toContain('gridView ? "flex h-full min-h-0 flex-col space-y-5"');
  });

  it("🔴 성적을 안 적은 줄은 배경으로 알린다(원장이 두 번 요구 — 09-22 지시·09-23 재지시)", () => {
    const grid = read("src/app/(shell)/exams/_components/score-grid.tsx");
    expect(grid).toMatch(/missing\s*\n?\s*\?\s*"bg-amber-soft/);
    // '시험없음'으로 눌러 둔 줄은 미기입이 아니다.
    expect(grid).toMatch(/const missing = !isNoExam &&/);
  });
});

describe("월말평가 표식 열(원장 2026-09-23)", () => {
  it("🔴 화면은 슬롯에 맞는 열만 세운다 — 상수를 그대로 돌리면 월말평가에도 3칸이 선다", () => {
    const grid = read("src/app/(shell)/exams/_components/score-grid.tsx");
    expect(grid).toContain("gradeMarkKeysFor");
    // 머리줄·본문 둘 다 슬롯 기준 배열을 돈다(한쪽만 고치면 열 수가 어긋나 표가 밀린다).
    expect(grid).toMatch(/\{markKeys\.map\(\(k\) => \(/);
    expect(grid).toMatch(/\{markKeys\.map\(\(k\) => \{/);
    // 폭도 열 수를 따라간다(고정 7칸이면 남은 한 칸이 40%를 독식한다).
    expect(grid).toContain("colWidths(markKeys.length)");
    // 요약 줄의 '성적확인'도 그 열이 있을 때만.
    expect(grid).toMatch(/markKeys\.includes\("received"\)/);
  });

  it("🔴 감춘 표식의 DB 값을 지우지 않는다 — 안 온 키는 '안 건드림'이다", () => {
    const act = read("src/features/grades/server/actions.ts");
    // ① 화면이 안 보낸 키를 '끔'으로 읽지 않는다.
    expect(act).toContain("if (want === undefined) continue;");
    // ② 파서가 빠진 키를 false로 채우지 않는다(채우면 ①이 무의미해진다).
    expect(act).toMatch(/if \(m\[k\] !== undefined\) picked\[k\] = !!m\[k\];/);
    // ③ 삭제 판정에 '안 건드리는 표식'을 넘긴다.
    expect(act).toContain("otherMarks: hasUntouchedMark(row.marks, marks)");
    // ④ 화면은 세운 열만 싣는다.
    expect(read("src/app/(shell)/exams/_components/score-grid.tsx")).toContain(
      "Object.fromEntries(markKeys.map((k) => [k, !!marks[id]?.[k]]))",
    );
  });
});

describe("월 축 0288a · 확인 뷰(원장 2026-09-23)", () => {
  it("마이그레이션이 있고 유니크 축에 월이 들어간다(부분 유니크 금지 [[#113]])", () => {
    const sql = readMigration("0288a_student_grades_month.sql");
    expect(sql).toContain("exam_month smallint not null default 0");
    expect(sql).toContain("ux_grades_term_slot_month");
    expect(sql).toContain("drop index if exists ux_grades_term_slot");
    expect(sql).not.toMatch(/create unique index[\s\S]{0,200}?where/i);
  });

  it("🔴 저장·삭제·조회가 **같은 월**을 본다 — 하나라도 빠지면 지난달을 덮거나 함께 지운다", () => {
    const write = read("src/features/grades/server/write.ts");
    expect(write).toContain("exam_slot,exam_month");
    // 지울 때도 월을 좁힌다(안 좁히면 10월을 비우는 한 번에 9월·11월이 사라진다).
    expect(write).toMatch(/if \(monthReady\) q = q\.eq\("exam_month", month\);/);
    const q = read("src/features/grades/server/queries.ts");
    expect(q).toMatch(/if \(monthReady\) q = q\.eq\("exam_month", sel\.month\);/);
  });

  it("🔴 0288a 미적용에도 산다 — 컬럼을 select·filter에 조건 없이 넣지 않는다([[#95]])", () => {
    const write = read("src/features/grades/server/write.ts");
    expect(write).toContain("gradeMonthReady");
    // 준비 안 됐으면 옛 유니크 축으로 저장한다(없는 인덱스를 가리키면 전건 42P10).
    expect(write).toContain("const conflict = monthReady");
    expect(write).toContain("...(monthReady ? { exam_month: month } : {})");
    expect(read("src/features/grades/server/overview-queries.ts")).toMatch(/monthReady \? ", exam_month" : ""/);
  });

  it("🔴 확인 뷰는 **읽기 전용**이다 — 입력·저장 경로가 한 줄도 없어야 한다", () => {
    const page = read("src/app/(shell)/exams/view/page.tsx");
    const table = read("src/app/(shell)/exams/view/_components/overview-table.tsx");
    for (const src of [page, table]) {
      expect(src).not.toContain("<input");
      expect(src).not.toContain("<form");
      expect(src).not.toContain("writeGradeCells");
      expect(src).not.toContain("saveGradeScores");
    }
    // 메뉴 게이트는 그대로 지난다(읽기도 권한이 필요하다).
    expect(page).toContain('requireAccess("exams")');
    expect(page).toContain("getGradeOverview");
  });

  it("🔴 0288a 전에는 월말평가 **저장을 막는다** — 경고만 띄우면 10월이 9월을 덮는다", () => {
    const write = read("src/features/grades/server/write.ts");
    // 게이트는 서버가 정본(엑셀·학생 상세 폼도 이 함수를 지난다).
    expect(write).toMatch(/if \(!monthReady && slotUsesMonth\(axis\.slot\)\)/);
    // 화면은 같은 판정으로 이유를 말한다.
    expect(read("src/app/(shell)/exams/input/page.tsx")).toMatch(/!sheet\.monthReady && slotUsesMonth\(sel\.slot\)/);
  });

  it("🔴 옛 월말평가 행을 시험일의 달로 백필한다 — 안 하면 적용 직후 지난 점수가 안 보인다", () => {
    const sql = readMigration("0288a_student_grades_month.sql");
    expect(sql).toMatch(/update student_grades[\s\S]{0,200}extract\(month from taken_on\)/);
    // 스키마 캐시 갱신이 없으면 새 컬럼을 한동안 "없다"고 답한다.
    expect(sql).toContain("notify pgrst, 'reload schema'");
  });

  it("확인 뷰 조회는 절단되지 않는다 — 유일 키 정렬 + 페이지네이션", () => {
    const q = read("src/features/grades/server/overview-queries.ts");
    expect(q).not.toContain('.order("student_id")');
    expect(q).toContain("fetchAllPagedInChunks<Cell>");
    // 값이 없는 칸(표식만 눌러 둔 행)은 열을 세우지 않는다.
    expect(q).toMatch(/if \(cell\.score != null \|\| cell\.noExam\) present\.push/);
  });

  it("🔴 확인 뷰도 **담당 반만** 본다 — 한쪽만 과목 기준이면 격자에서 감춘 반이 여기서 열린다", () => {
    const q = read("src/features/grades/server/overview-queries.ts");
    expect(q).toContain("gradeTeacherClassIds");
    expect(q).toMatch(/scope \? \(classRows \?\? \[\]\)\.filter\(\(c\) => myClassIds\.has\(c\.id\)\)/);
  });

  it("🔴🔴 42P10 되돌림은 **월말평가에 쓰지 않는다** — 옛 축으로 쓰면 10월이 9월을 덮는다", () => {
    const write = read("src/features/grades/server/write.ts");
    expect(write).toContain("if (!isMissingIndex || slotUsesMonth(axis.slot))");
  });

  it("🔴 준비 플래그는 '컬럼 없음'만 미준비로 읽는다 — 일시 실패를 미준비로 읽으면 표식이 지워진다", () => {
    const write = read("src/features/grades/server/write.ts");
    expect(write).toContain("async function columnExists");
    expect(write).toMatch(/code === "42703" \|\| code === "PGRST204"/);
  });

  it("월말평가 저장이 막힌 사유는 화면까지 닿는다(엑셀은 미리보기 전에 말한다)", () => {
    expect(read("src/features/grades/server/actions.ts")).toContain("=== GRADE_MONTH_NOT_READY");
    const excel = read("src/features/grades/server/excel-actions.ts");
    expect(excel).toMatch(/slotUsesMonth\(axis\.slot\) && !\(await gradeMonthReady\(\)\)/);
  });

  it("🔴 두 화면의 학년 순서가 같다 — 사다리는 공용 모듈 하나", () => {
    for (const f of [
      "src/app/(shell)/exams/_components/score-grid.tsx",
      "src/features/grades/server/overview-queries.ts",
    ]) {
      expect(read(f)).toMatch(/from "(@\/features\/grades|\.\.)\/grade-rank"/);
    }
    // 화면 파일에 자기 사다리를 다시 적지 말 것.
    expect(read("src/app/(shell)/exams/_components/score-grid.tsx")).not.toContain("GRADE_LEVEL");
  });

  it("확인 뷰도 '안 치는 시험'을 미기입과 다르게 그린다(줄을 뺄 수 없는 화면이라 칸으로)", () => {
    expect(read("src/features/grades/server/overview-queries.ts")).toContain("examAppliesTo");
    expect(read("src/app/(shell)/exams/view/_components/overview-table.tsx")).toContain("skipKeys");
  });

  it("두 화면을 오가는 길이 양쪽에 있다(같은 부품)", () => {
    for (const f of ["src/app/(shell)/exams/input/page.tsx", "src/app/(shell)/exams/view/page.tsx"]) {
      expect(read(f)).toContain("GradeViewSwitch");
    }
  });
});
