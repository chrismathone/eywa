import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 구조 가드 — 보이지 않는 '보강' 반(0241a)의 **성질 넷**이 조용히 깨지지 않게.
 * 규약과 배경은 [`features/classes/makeup-pool.ts`](../classes/makeup-pool.ts) 헤더에 있다.
 */
const read = (...p: string[]) => readFileSync(join(process.cwd(), "src", ...p), "utf8");
const server = read("features", "attendance", "server", "makeup-pool.ts");
const page = read("app", "(shell)", "attendance", "page.tsx");

describe("보이지 않는 '보강' 반", () => {
  it("🔴 만들 때 `is_active=false` — 이게 '어디에도 안 보이게'의 주 장치다", () => {
    expect(server).toContain("is_active: false");
    expect(server).toContain("is_makeup_pool: true");
  });

  it("🔴 교시·수강을 만들지 않는다 — 있으면 '미입력 반' 신호와 명단·청구가 흔들린다", () => {
    expect(server).not.toContain('from("class_schedules")');
    expect(server).not.toContain('from("enrollments")');
  });

  it("🔴 자동 입력은 **빈 칸만** 채운다(사람이 고친 값을 안 덮는다)", () => {
    /**
     * ⚠️ 가드는 **코드 모양이 아니라 성질**을 잡는다 — 들여쓰기·줄바꿈까지 문자열로 잡으면 포맷 한 번에
     *    빨개진다(2026-09-02에 실제로 그렇게 main이 잠깐 빨갰다). 여기서 확인하는 것은 두 가지다:
     *    ① insert 전에 **먼저 읽는다**  ② 그 조회가 있으면 **일찍 돌아간다**.
     */
    // ⚠️ 반 생성(ensureMakeupPoolClass)에도 insert가 있어서 **출결 함수 안으로 좁혀** 본다.
    const fn = server.slice(server.indexOf("export async function ensureMakeupAttendanceForReport"));
    const readAt = fn.indexOf('.from("attendance_records")');
    const insertAt = fn.indexOf(".insert({");
    expect(readAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(readAt); // 조회가 먼저다(빈 칸 판정 없이 쓰지 않는다)
    expect(fn.slice(readAt, insertAt)).toMatch(/exists[\s\S]{0,120}return \{ ok: true/);
    expect(server).toContain('status: "makeup"');
    /**
     * ③ 그리고 **그 강사가 그날 그 학생을 이미 찍었으면** 안 만든다(2026-09-02 갱신) — 같은 수업을
     *    두 번 세지 않기 위해서다. 🔴 축은 **상태가 아니라 강사**다: 손으로 찍을 땐 `present`가 더
     *    흔하고(김승언), 반대로 "어느 반이든 makeup이면 skip"은 **다른 강사의 진짜 두 번째 수업**을
     *    잘못 막는다(이채아 = 김윤하 정규 + 김은정 보강). 규칙과 실측 근거는 그 함수 주석.
     *    조회는 반으로 좁히지 않고(그 강사의 어느 반이든), insert **앞**에 있다.
     */
    const between = fn.slice(readAt, insertAt);
    expect(between).toContain("teacher_id");
    expect(between).not.toContain('.eq("status"'); // 상태로 가르면 손으로 찍은 present를 놓친다
    const scanAt = between.indexOf("teacher_id");
    expect(between.slice(between.lastIndexOf('.from("attendance_records")', scanAt), scanAt)).not.toContain(
      '.eq("class_id"',
    );
  });

  it("🔴 출석부는 이 반을 **일부러** 불러온다(활성 목록엔 절대 안 들어오므로)", () => {
    expect(page).toContain("findMakeupPoolClass(user.tenantId, effectiveTeacher)");
    // 명단·칸·시수는 평소 쓰는 매트릭스가 그대로 만든다(특별 코드 금지).
    expect(page).toContain("getMonthlyAttendanceMatrix(month, makeupPoolClassId,");
    /**
     * 🔴 스코프 통과 인자를 **반드시** 함께 넘긴다 — 이 반은 활성 목록에 없어서, 안 넘기면 강사 화면에서
     *    classId가 조용히 null이 되고 묶음이 통째로 빈다(에러도 안 난다).
     */
    // 인자 위치가 아니라 **그 값이 그 호출에 실렸는지**만 본다(포맷·인자 추가에 안 부서지게).
    const call = page.slice(page.indexOf("getMonthlyAttendanceMatrix(month, makeupPoolClassId,"));
    expect(call.slice(0, call.indexOf(")") + 1)).toContain("makeupPoolClassId)");
  });

  it("⚠️ 0241a 미적용이어도 안 죽는다 — 컬럼 없으면 null/빈 배열로 조용히 넘어간다", () => {
    expect(server).toContain("isMissingColumn");
    expect(server).toContain("return []; //");
  });

  it("🔴 사무실 수업목록에서 뺄 때 **컬럼을 쿼리에 안 넣는다**(미적용 시 400으로 화면이 죽는다)", () => {
    const q = read("features", "classes", "server", "queries.ts");
    expect(q).toContain("listMakeupPoolClassIds()");
    expect(q).not.toContain('.eq("is_makeup_pool"');
  });

  it("⚠️ 판정은 컬럼이지 이름이 아니다 — 화면·서버 어디서도 반 이름으로 거르지 않는다", () => {
    for (const src of [server, page]) {
      expect(src).not.toMatch(/class_name.*보강|보강.*class_name/);
    }
  });

  it("🔴 라이브 훅은 **저장자가 아니라 보고서 소유자**에게 귀속한다(사무실 대리 저장 예방, 2026-09-02)", () => {
    const os = read("features", "onescreen", "server", "actions.ts");
    // 저장된 행의 소유 컬럼을 되받아 규칙(resolveMakeupOwner → pickMakeupOwner)에 넘긴다.
    expect(os).toContain('.select("id, share_token, teacher_name, created_by")');
    expect(os).toContain("resolveMakeupOwner(");
    const hook = os.slice(os.indexOf("await ensureMakeupAttendanceForReport({"));
    const call = hook.slice(0, hook.indexOf("});"));
    expect(call).not.toContain("teacherId: user.id"); // 저장자 귀속으로 되돌리지 말 것
    expect(call).toContain("teacherId: owner.id");
    // 소유자를 못 풀면 훅을 건너뛴다(잘못된 반을 만드는 것보다 안 만드는 게 낫다).
    expect(os).toMatch(/if \(owner\) \{\s*await ensureMakeupAttendanceForReport/);
    // 서버 해석은 created_by가 비었을 때만 이름을 보고, 활성·학생 제외로 좁힌다(resolveReportAuthorName 규약).
    expect(server).toContain('.eq("status", "active")');
    expect(server).toContain('.neq("system_role", "student")');
  });
});
