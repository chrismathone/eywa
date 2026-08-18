/**
 * 영어 강사 시트(ECS)의 출결이 **월 출석부와 같은 배선**을 쓰는지 잠근다.
 *
 * 왜 소스 문자열로 잠그나: 여기서 갈라지면 "시트에서는 저장됐는데 출석부엔 없다"가 되는데,
 * 그건 화면을 열어보기 전엔 아무 신호가 없다(에러도 안 난다). 배선 가드 선례 =
 * `teacher-home-wiring.test.ts` · `recorded-via-fallback.test.ts` · `postgrest-embed-hints.test.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

describe("ECS 출결 → 출석부 배선", () => {
  const sheetToolbar = read("src", "features", "class-sheets", "components", "sheet-toolbar.tsx");
  const sheetClient = read("src", "features", "class-sheets", "components", "sheet-client.tsx");
  const attendanceActions = read("src", "features", "attendance", "server", "actions.ts");
  const attendanceQueries = read("src", "features", "attendance", "server", "queries.ts");

  it("출석부 버튼은 출석부의 단일 링크 빌더(attHref)를 쓴다", () => {
    // 🔴 여기서 파라미터를 손으로 조립하면 mode가 빠져 강사 기본값('강사 전체')으로 되돌아간다.
    expect(sheetToolbar).toContain('import { attHref } from "@/app/(shell)/attendance/_components/att-href"');
    expect(sheetToolbar).toMatch(/attHref\(\{[^}]*mode: "class"/);
    expect(sheetToolbar).toContain("출석부");
  });

  it("출석부로 나가기 전에 진행 중인 출결 저장을 비운다", () => {
    // 저장이 끝나기 전에 이동하면 새 화면 조회가 저장보다 먼저 끝나 "찍었는데 없다"로 보인다.
    expect(sheetToolbar).toContain("onClick={() => onNavigate(attendanceHref)}");
    expect(sheetClient).toMatch(/await drainAttendanceSaves\(\);\s*router\.push\(href\)/);
  });

  it("영어 시트가 출석부와 같은 setAttendanceCell 액션에 반·학생·날짜·교시를 보낸다", () => {
    expect(sheetClient).toContain(
      'import { setAttendanceCell } from "@/features/attendance/server/actions";',
    );
    expect(sheetClient).toMatch(
      /setAttendanceCell\(\{\s*classId,\s*studentId,\s*sessionDate: date,\s*slotStart: dbSlot,\s*status,/,
    );
  });

  it("공용 액션은 attendance_records에 반·학생·날짜·교시로 저장한다", () => {
    const start = attendanceActions.indexOf("export async function setAttendanceCell");
    const end = attendanceActions.indexOf("export type MakeupLinkResult");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = attendanceActions.slice(start, end);
    expect(body).toContain('.from("attendance_records")');
    expect(body).toContain("class_id: classId");
    expect(body).toContain("student_id: studentId");
    expect(body).toContain("session_date: sessionDate");
    expect(body).toContain("slot_start:");
  });

  it("월 출석부도 같은 attendance_records를 반·학생·날짜·교시 기준으로 읽는다", () => {
    const start = attendanceQueries.indexOf("export async function getMonthlyAttendanceMatrix");
    const end = attendanceQueries.indexOf("export async function getAttendanceForDate");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = attendanceQueries.slice(start, end);
    expect(body).toContain('.from("attendance_records")');
    expect(body).toContain("slot_start");
  });
});
