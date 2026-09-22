/**
 * **테스트 학생은 운영 집계·알림에 들어가지 않는다.**
 *
 * 2026-09-01 원장 지시로 ClassNote 발송 시험용 학생 '학원이'(`students.is_test`)를 **모든 선생님이
 * 자기 화면에서 테스트할 수 있도록** 반 15개(수학 9·영어 6)에 배정했다. 그 순간부터 '미작성 보고서'
 * 신호가 요일에 따라 **매일 2~5명을 더 세게 된다** — 진짜 미작성(수학 30여 명) 안에 가짜가 섞이는 것이라
 * 숫자도 명단도 거짓이 된다.
 *
 * 2026-09-13 원장: *"테스트 계정 알림 전부 off."* — 집계뿐 아니라 **알림**도 같은 축으로 뺀다.
 * 🔴 `notifyUsers` 한 곳에서는 막을 수 없다: 그 함수는 수신자·본문만 받고 학생 id를 모르며, 본문이
 *    묶음이라(`구한결 외 10명 …`) 항목째 버리면 **실학생 10명의 알림이 함께 사라진다**. 그래서 거르는
 *    자리는 언제나 **경로별 후보 선정 단계**이고, 판정 재료는 공용 헬퍼 한 벌이다.
 *
 * 2026-09-14 원장: *"학원이 반 및 학원이 (테스트 학생)이 오늘 출결에 올라와있는데 예외로 빼."* — **데스크 표면**도
 *    같은 축으로 뺀다: 오늘 출결(좌석표·확인 필요·어제 출결)과 처리현황(운영실 'N반'·브리핑 '오늘 출석 미기록').
 *
 * ⚠️ 빼는 곳은 **집계·알림 + 데스크 오늘 출결·처리현황**이다. 선생님 **자기 화면**(원스크린·ECS·월별 출석부·
 *    강사 스트립·출결 모드)과 학생목록에는 그대로 보여야 테스트가 된다 — 거기까지 빼면 배정한 의미가 없어진다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const HELPER = strip(read("src", "features", "students", "server", "test-students.ts"));
const signals = strip(read("src", "features", "dashboard", "server", "action-signals.ts"));

describe("공용 헬퍼 — 판정 재료가 한 벌이다", () => {
  it("is_test 학생 id를 전건 페이징으로 받는다(B2 — 무페이징 select 금지)", () => {
    expect(HELPER).toContain('.eq("is_test", true)');
    expect(HELPER).toMatch(/fetchAllPaged<\{ id: string \}>\(/);
    // OFFSET 페이지 안정화 — unique tie-break 정렬(batch.ts 계약).
    expect(HELPER).toMatch(/\.order\("id"\)/);
  });

  it("admin(RLS 우회) 경로에서는 테넌트로 좁힌다 — 유일한 격리선이다", () => {
    expect(HELPER).toMatch(/if \(tenantId\)[\s\S]{0,120}?\.eq\("tenant_id", tenantId\)/);
  });

  it("fail-open — 조회 실패가 알림·집계를 죽이지 않는다", () => {
    // throw하면 테스트 학생 명단 한 번 못 읽었다고 그날 신호·알림이 통째로 사라진다.
    expect(HELPER).toMatch(/\.catch\(/);
    expect(HELPER).toMatch(/return new Set/);
  });
});

describe("미작성 보고서 신호는 테스트 학생을 세지 않는다", () => {
  it("공용 헬퍼로 id를 받아 대상에서 뺀다", () => {
    expect(signals).toContain("getTestStudentIds(supabase, db?.tenantId)");
    expect(signals).toMatch(/\.filter\(\(row\) => !testStudentIds\.has\(row\.student_id\)\)/);
  });

  it("수강 조회와 함께 병렬로 돈다(B4 — 직렬 워터폴 금지)", () => {
    expect(signals).toMatch(/const \[enrollmentRows, testStudentIds\] = await Promise\.all\(/);
  });
});

/**
 * 원장 2026-09-13이 지목한 **실제로 울린 4경로**. 화면에서만 빼면 알림이 계속 재촉하므로(#77의 변종)
 * 각 경로가 후보 선정 단계에서 공용 헬퍼를 지나는지를 소스로 잠근다.
 */
describe("알림 4경로가 모두 테스트 학생을 뺀다", () => {
  const cases: [string, string[]][] = [
    ["미발송 재촉 + 미수 경보", ["src", "features", "notifications", "server", "events.ts"]],
    ["미출결 → 출결 교차", ["src", "features", "attendance", "live", "server", "cross-notify.ts"]],
    ["출석 입력 완료", ["src", "features", "attendance", "server", "complete-notify.ts"]],
  ];
  for (const [label, path] of cases) {
    it(`${label}은 getTestStudentIds를 지난다`, () => {
      expect(strip(read(...path))).toContain("getTestStudentIds(");
    });
  }

  it("🔴 교차 출결은 **dedup 앞에서** 뺀다 — 뒤에서 빼면 dedup만 소모돼 진짜 알림이 영영 막힌다", () => {
    const src = strip(read("src", "features", "attendance", "live", "server", "cross-notify.ts"));
    expect(src.indexOf("getTestStudentIds(")).toBeGreaterThan(-1);
    expect(src.indexOf("getTestStudentIds(")).toBeLessThan(src.indexOf("notification_events"));
  });

  it("🔴 출석 완료도 **완료 판정 앞에서** 뺀다 — 뒤로 밀면 그 반은 영원히 '미완료'다", () => {
    const src = strip(read("src", "features", "attendance", "server", "complete-notify.ts"));
    expect(src.indexOf("testStudentIds.has(")).toBeLessThan(src.indexOf("isClassAttendanceComplete("));
    expect(src.indexOf("isClassAttendanceComplete(")).toBeLessThan(src.indexOf("notification_events"));
  });

  it("🔴 미수 경보는 RPC가 아니라 **결과를 JS에서** 거른다(화면 숫자를 함께 바꾸지 않는다)", () => {
    // dashboard_top_outstanding*는 운영실 카드·브리핑·retention이 함께 읽는다 — RPC를 고치면 별개의 결정이 된다.
    const src = strip(read("src", "features", "notifications", "server", "events.ts"));
    expect(src).toMatch(/\.filter\(\(row\) => !testStudentIds\.has\(row\.student_id\)\)/);
    expect(src).toContain("dashboard_top_outstanding_admin");
  });

  it("🔴 미발송 재촉은 공용 게이트(unsent-sendable)가 아니라 호출부에서 뺀다", () => {
    // 그 게이트는 **발송 큐 카드와 공유**라, 거기 넣으면 원장이 "빼지 않기로 한" 카드 수까지 바뀐다.
    expect(strip(read("src", "features", "report-admin", "unsent-sendable.ts"))).not.toContain("is_test");
    expect(strip(read("src", "features", "notifications", "server", "events.ts"))).toContain("sendableRows");
  });
});

describe("이미 같은 축을 쓰던 곳들이 그대로다", () => {
  const cases: [string, string[]][] = [
    ["작성률(report-admin)", ["src", "features", "report-admin", "server", "queries.ts"]],
    ["오늘의 수학(연동)", ["src", "features", "integrations", "todays-math", "service.ts"]],
    ["발송 실패 알림", ["src", "features", "notifications", "server", "failed-notify-sweep.ts"]],
    ["보드 명단", ["src", "features", "report-admin", "server", "board-roster-queries.ts"]],
  ];
  for (const [label, path] of cases) {
    it(`${label}은 여전히 is_test를 본다`, () => {
      expect(strip(read(...path))).toContain("is_test");
    });
  }
});

/**
 * 원장 2026-09-14: *"학원이 반 및 학원이 (테스트 학생)이 오늘 출결에 올라와있는데 예외로 빼."*
 * 데스크 오늘 출결(좌석표·확인 필요·어제 출결)과 강사 스트립 '데스크 확인 요청'은 한 적재(`loadLiveSlots`)를,
 * 처리현황(운영실 'N반'·브리핑 '오늘 출석 미기록')은 `getDailyProcessingStatus`를, 브리핑 '어제 출석 미기록'은
 * `unrecordedClassesSignal`을 지난다 — 모두 같은 헬퍼로 명단에서 뺀다.
 * 🔴 이름으로 반을 거르지 않는다(반 이름을 바꾸면 조용히 끊긴다) — 명단이 비면 반은 저절로 빠진다.
 */
/** 한 파일 안에서 **그 함수 몸통만** 자른다 — 같은 파일에 같은 판정 함수 호출이 여럿이라 순서 비교가 섞이지 않게. */
const bodyOf = (src: string, start: string, end?: string) => {
  const from = src.indexOf(start);
  expect(from).toBeGreaterThan(-1);
  const to = end ? src.indexOf(end, from + start.length) : -1;
  return src.slice(from, to === -1 ? undefined : to);
};

describe("데스크 오늘 출결·처리현황은 테스트 학생을 명단에서 뺀다", () => {
  const LOAD = strip(read("src", "features", "attendance", "live", "server", "load.ts"));
  const BOARD = strip(read("src", "features", "attendance", "live", "server", "queries.ts"));
  const PROCESSING = strip(read("src", "features", "attendance", "server", "queries.ts"));

  it("보드 적재는 옵션이 켜졌을 때만 공용 헬퍼를 부르고, 수강·출결 조회와 함께 돈다(B4)", () => {
    expect(LOAD).toContain(
      "opts.excludeTestStudents ? getTestStudentIds(supabase) : Promise.resolve(new Set<string>())",
    );
    // ⚠️ 뒤에 재료가 더 붙어도 된다(2026-09-18 *LAB 배정 `labSplit`) — 지키려는 것은 **같은 묶음에서 병렬로 돈다**는 것뿐이다.
    expect(LOAD).toMatch(/const \[classRows, enrollRows, recordRows, reservedRaw, testStudentIds[^\]]*\] = await Promise\.all\(/);
  });

  it("명단에 넣기 전에 빼고, 보강 예약도 같은 집합을 지난다(예약 한 줄이 반을 되살리지 않게)", () => {
    const skip = LOAD.indexOf("if (testStudentIds.has(e.student_id)) continue;");
    expect(skip).toBeGreaterThan(-1);
    expect(skip).toBeLessThan(LOAD.indexOf("expectedByClass.set(e.class_id, set)"));
    expect(LOAD).toContain(".filter((r) => !testStudentIds.has(r.studentId))");
  });

  it("🔴 데스크 경로(selfOnly=false)에서만 켠다 — 강사 스트립·출결 모드는 담임이 테스트하는 자리라 남긴다", () => {
    expect(BOARD).toContain("loadLiveSlots(date, classIds, { excludeTestStudents: !selfOnly })");
  });

  /**
   * 🔴 이 호출은 데스크→강사 '입력요청'이 아니라 **강사 스트립의 '데스크 확인 요청'**(strip-slot.tsx)이다.
   *    원일 스트립엔 테스트 반이 보이므로 여기서 누르면 실직원에게 벨이 가는데 데스크 큐엔 그 반이 없다
   *    (09-13 '테스트 계정 알림 off'와도 어긋난다) — 그래서 명단에서 빼고, 테스트뿐이면 벨 없이 거절한다.
   */
  it("🔴 강사 스트립 '데스크 확인 요청'은 테스트 학생을 빼고, 테스트뿐인 교시면 벨 없이 거절한다", () => {
    const ACTIONS = strip(read("src", "features", "attendance", "live", "server", "actions.ts"));
    const fn = bodyOf(ACTIONS, "export async function requestDeskConfirm");
    expect(fn).toContain("loadLiveSlots(sessionDate, [classId], { excludeTestStudents: true })");
    expect(fn).toContain("테스트 학생만 있는 수업이라 데스크에 요청하지 않았습니다");
    // 거절이 dedup·벨보다 앞이어야 한다 — 뒤로 밀면 bucket만 태우고 "요청했다는데 없다"가 된다.
    expect(fn.indexOf("테스트 학생만 있는 수업이라")).toBeLessThan(fn.indexOf("notification_events"));
    // 제외 없는 재조회는 **거절 경로에서 이유를 가르는 용도**뿐이다(명단은 제외본에서 만든다).
    expect(fn.indexOf("{ excludeTestStudents: true }")).toBeLessThan(
      fn.indexOf("inSlot(await loadLiveSlots(sessionDate, [classId]))"),
    );
  });

  it("처리현황은 같은 헬퍼로 명단에서 빼고, 테스트 학생뿐이던 반은 행째 뺀다(수강 없는 반은 그대로)", () => {
    expect(PROCESSING).toMatch(/const \[enrollments, records, testStudentIds\] = await Promise\.all\(/);
    expect(PROCESSING).toContain("getTestStudentIds(supabase),");
    expect(PROCESSING).toContain("classesWithTestStudent.add(e.class_id);");
    expect(PROCESSING).toContain("!(classesWithTestStudent.has(c.id) && !expectedByClass.has(c.id))");
    expect(PROCESSING).toContain("const rows: ClassProcessing[] = visibleClasses.map(");
  });

  it("🔴 처리현황은 **그날 유효·등원 요일 판정 뒤에** 뺀다 — 앞에서 빼면 그날 안 오는 테스트 학생 때문에 반이 사라진다", () => {
    const fn = bodyOf(PROCESSING, "export const getDailyProcessingStatus", "export type AttendanceStatus");
    expect(fn.indexOf("isEnrollmentActiveOn(")).toBeGreaterThan(-1);
    expect(fn.indexOf("isEnrollmentActiveOn(")).toBeLessThan(fn.indexOf("classesWithTestStudent.add("));
  });

  /**
   * 원장 브리핑 '어제 출석 미기록'(`unrecordedClassesSignal`)은 cron(admin db)에서도 돈다 — 목적지
   * `/attendance/{어제}`의 처리 현황에선 테스트 반이 빠졌으니 여기서 세면 두 숫자가 갈린다.
   */
  describe("브리핑 '어제 출석 미기록'도 같은 축으로 뺀다", () => {
    const fn = bodyOf(signals, "async function unrecordedClassesSignal", "async function unrecordedTodaySignal");

    it("수강·출결 조회와 같은 Promise.all에서 받고, admin 경로엔 tenantId를 넘긴다", () => {
      expect(fn).toMatch(/const \[enrollmentRows, attendanceRows, testStudentIds\] = await Promise\.all\(/);
      expect(fn).toContain("getTestStudentIds(supabase, db?.tenantId)");
    });

    it("🔴 판정 뒤에 뺀다(처리현황과 같은 순서) — 명단이 비면 그 반은 미기록 목록에 안 선다", () => {
      const skip = fn.indexOf("if (testStudentIds.has(row.student_id)) continue;");
      expect(skip).toBeGreaterThan(-1);
      expect(fn.indexOf("isEnrollmentActiveOn(")).toBeLessThan(skip);
      expect(skip).toBeLessThan(fn.indexOf("students.add(row.student_id)"));
      expect(fn).toContain("hasUnrecordedStudent");
    });
  });
});
