/**
 * **반 쓰기는 "내 담당 반"만** — 회귀 방지(원장 2026-09-04 *"내 담당반만 하도록 역할 배선 안되어있어?
 * 이건 심각하군. 일단 그건 바로 고쳐야겠네."*).
 *
 * 사고 모양: `classes` 메뉴는 강사가 `scoped`인데 게이트가 **접근 수준만** 봤다. 수준은 "반을 고칠 수
 * 있는 사람인가"만 말하지 "이 반이 내 반인가"는 말하지 않는다 → 반 id만 바꿔 보내면 남의 반도
 * 저장됐다(반 이름·과목·담임·시간표까지). 목록·시간표가 이미 담임으로 좁혀 있어 **화면엔 안 보였을 뿐**
 * — "화면에서만 잠갔다"의 전형([[#77]]).
 *
 * 이 파일이 잠그는 것:
 *  ① 판정 자체(순수 함수)
 *  ② 반을 바꾸는 서버 액션이 **반 id를 게이트에 넘기는지**(인자를 빠뜨리면 구멍이 그대로 돌아온다)
 *  ③ 읽기 초크포인트가 살아 있는지
 *  ④ 화면 버튼이 서버와 **같은 판정**을 쓰는지(갈리면 "보이는데 누르면 거절")
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canWriteClassRecord, CLASS_NOT_MINE_ERROR } from "./class-write-scope";

const read = (...seg: string[]) => readFileSync(join(process.cwd(), "src", ...seg), "utf8");
/** 주석은 규칙을 **설명**하는 자리라 검사에서 뺀다(경고 문구가 스스로 위반으로 걸리지 않게). */
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const ME = "u-teacher";
const OTHER = "u-other";

describe("반 쓰기 스코프 — 순수 판정", () => {
  it("full(관리자 계열)은 학원 전체 반", () => {
    expect(canWriteClassRecord({ level: "full", classTeacherId: OTHER, userId: ME })).toBe(true);
    expect(canWriteClassRecord({ level: "full", classTeacherId: null, userId: ME })).toBe(true);
  });

  it("🔴 scoped(강사)는 **자기 담임 반만**", () => {
    expect(canWriteClassRecord({ level: "scoped", classTeacherId: ME, userId: ME })).toBe(true);
    expect(canWriteClassRecord({ level: "scoped", classTeacherId: OTHER, userId: ME })).toBe(false);
  });

  it("🔴 담임이 비어 있는 반은 아무 강사도 못 고친다 — 빈 값을 '누구나'로 읽지 않는다", () => {
    // 신설 반은 담임이 빈 채로 태어난다(시트에 담임 줄이 없다). 여기서 통과시키면 그 반이 전 강사에게 열린다.
    expect(canWriteClassRecord({ level: "scoped", classTeacherId: null, userId: ME })).toBe(false);
    expect(canWriteClassRecord({ level: "scoped", classTeacherId: "", userId: ME })).toBe(false);
  });

  it("readonly·none은 담임이어도 쓰기 없음 — '다른 강사 뷰'(열람 전용)가 이 자리로 떨어진다", () => {
    expect(canWriteClassRecord({ level: "readonly", classTeacherId: ME, userId: ME })).toBe(false);
    expect(canWriteClassRecord({ level: "none", classTeacherId: ME, userId: ME })).toBe(false);
  });

  it("거절 문구는 raw enum이 아니라 다음에 할 일을 적는다", () => {
    expect(CLASS_NOT_MINE_ERROR).toMatch(/담당 반/);
    expect(CLASS_NOT_MINE_ERROR).not.toMatch(/[a-z_]{4,}/); // scoped·classes 같은 코드 노출 금지
  });
});

describe("🔴 반을 바꾸는 서버 액션은 게이트에 **반 id를 넘긴다**", () => {
  const actions = read("features", "classes", "server", "actions.ts");
  const code = codeOnly(actions);

  it("인자 없는 requireClassWrite() 호출이 한 곳도 없다", () => {
    // 이 한 줄이 이번 사고의 전부였다 — 인자를 빼면 "누구인가"만 보고 통과한다.
    expect(code).not.toMatch(/requireClassWrite\(\s*\)/);
  });

  it("로컬 사본을 되살리지 않는다 — 게이트는 class-scope.ts 한 벌", () => {
    expect(code).not.toMatch(/(async )?function requireClassWrite\s*\(/);
    expect(actions).toContain('import { requireClassWrite } from "./class-scope"');
  });

  it("네 액션 모두 자기 반 id로 게이트를 탄다", () => {
    for (const call of [
      "requireClassWrite(id)", // updateClass
      "requireClassWrite(classId)", // scheduleHandover·cancelHandover·applyHandover
    ]) {
      expect(code).toContain(call);
    }
    // 인수인계 3종 = 같은 호출을 세 번 쓴다(하나라도 빠지면 그 액션만 뚫린다).
    expect(code.split("requireClassWrite(classId)").length - 1).toBe(3);
  });

  it("위임 게이트도 **같은 순수 함수**를 쓴다 — 손으로 복사한 담임 비교가 남아 있지 않다", () => {
    expect(code).toContain("canWriteClassRecord({");
    expect(code).not.toContain("klass.teacher_id !== user.id");
  });
});

describe("🔴 읽기 초크포인트 — 상세·수정 두 화면이 한 함수로 모인다", () => {
  it("getClassDetail이 열람 스코프를 먼저 본다", () => {
    const q = codeOnly(read("features", "classes", "server", "queries.ts"));
    const at = q.indexOf("export async function getClassDetail");
    expect(at).toBeGreaterThan(-1);
    const head = q.slice(at, at + 400);
    expect(head).toContain("canViewClassDetail(id)");
  });

  it("읽기는 담임보다 **넓다**(부담임·위임) — 영어 시트의 '반 정보' 링크가 안 죽는다", () => {
    const scope = read("features", "classes", "server", "class-scope.ts");
    expect(scope).toContain('.eq("teacher_id", user.id)'); // ① 담임
    expect(scope).toContain('.from("class_schedules")'); // ② 교시 담당
    expect(scope).toContain("getDelegatedClassIdsInRange"); // ③ 임시 위임
  });

  it("🔴 쓰기는 fail-closed · 읽기는 fail-open", () => {
    const scope = codeOnly(read("features", "classes", "server", "class-scope.ts"));
    const write = scope.slice(scope.indexOf("export async function requireClassWrite"));
    const writeBody = write.slice(0, write.indexOf("export async function canWriteLoadedClass"));
    // 조회가 실패하면 통과시키지 않는다(모르는 것을 '내 반'으로 읽으면 곧 사고다).
    expect(writeBody).toMatch(/if \(error\) return \{ user: null/);
    // 읽기는 반대 — **한 갈래라도** 못 물어봤으면 열어 둔다. `&&`로 적으면 담임 조회만 순간 실패해도
    // 진짜 담임이 404를 본다(적대 리뷰 2026-09-04에서 실제로 이렇게 적혀 있었다).
    expect(scope).toContain("return !!own.error || !!slot.error;");
  });

  it("🔴 담임 비교 사본이 앱 전체에 남아 있지 않다 — 판정은 순수 함수 한 벌", () => {
    // 종전엔 같은 비교가 네 곳에 손으로 복사돼 있었다(반 수정·위임·영어 레벨 변경·화면 버튼).
    const lvl = codeOnly(read("features", "timetable", "server", "actions.ts"));
    expect(lvl).toContain("canWriteClassRecord({");
    expect(lvl).not.toContain('=== "scoped" && klass.teacher_id !== user.id');
  });
});

describe("🔴 화면 버튼은 서버와 같은 판정 — '보이는데 누르면 거절'이 안 생긴다", () => {
  const page = read("app", "(shell)", "classes", "[id]", "page.tsx");

  it("반 수정·레벨 변경·인수인계·위임이 전부 canEditClass 하나를 본다", () => {
    expect(page).toContain("const canEditClass = await canWriteLoadedClass(klass.teacherId);");
    expect(page).toContain("const canDelegate = canEditClass;");
    expect(page).toContain("{canEditClass ? (");
    expect(page).toContain("{canEditClass && !klass.pendingTeacherId ? (");
    expect(page).toContain("canAct={canEditClass}");
    // 손으로 다시 적은 담임 비교가 남아 있지 않다(네 번째 사본이 생기는 순간 갈라진다).
    expect(codeOnly(page)).not.toContain('classLevel === "scoped" && klass.teacherId === user.id');
  });

  it("반 수정 폼 페이지도 같은 판정으로 막는다 — 열어 놓고 저장만 거절하지 않는다", () => {
    const edit = read("app", "(shell)", "classes", "[id]", "edit", "page.tsx");
    expect(edit).toContain("if (!(await canWriteLoadedClass(klass.teacherId))) notFound();");
  });

  it("분리등원 요일 편집은 서버(관리자 전용)와 같은 축을 본다", () => {
    // `updateEnrollmentsAttendanceBatch`는 canManageTenant("classes")뿐이다 — canWriteTenant로 열면
    // 강사에게 칸이 열리고 저장만 거절된다(#77의 반대 꼴).
    for (const seg of [
      ["app", "(shell)", "classes", "[id]", "page.tsx"],
      ["app", "(shell)", "students", "[id]", "page.tsx"],
    ]) {
      const src = codeOnly(read(...seg));
      expect(src, seg.join("/")).toContain(
        'const canEditSchedule = await canManageTenant(user.systemRole, "classes");',
      );
    }
  });
});
