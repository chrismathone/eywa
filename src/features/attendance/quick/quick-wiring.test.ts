/**
 * '출결 모드' **배선 가드**(원장 2026-08-20: *"배선 철저히해서 다른 출결 시스템과 잘 연동되게"*).
 *
 * 🔑 이 배선은 **떼어내도 아무 에러가 안 난다** — 저장 축을 화면 교시로 바꾸거나, 방송을 빼거나,
 *    `source:"live"`를 흘려도 타입체크·단위테스트가 전부 통과한다. 증상은 몇 주 뒤 시수·급여나
 *    데스크 큐에서 조용히 드러난다. 그래서 소스 문자열로 못 박는다
 *    ([attendance-applied-wiring.test.ts](../live/attendance-applied-wiring.test.ts)와 같은 규약).
 * ⚠️ 이 파일이 깨지면 테스트를 고치기 전에 **왜 배선이 달라졌는지**를 먼저 설명할 것.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SUBTABS_BY_MENU } from "@/lib/navigation";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const BOARD = "src/features/attendance/quick/components/quick-board.tsx";
const PAGE = "src/app/(shell)/attendance/quick/page.tsx";

describe("저장은 기존 액션만 쓴다", () => {
  const src = read(BOARD);

  it("개별 = setAttendanceCell, 일괄 = setAttendanceBulk", () => {
    expect(src).toMatch(/setAttendanceCell\(/);
    expect(src).toMatch(/setAttendanceBulk\(/);
  });

  it("🔴 자체 DB 경로를 만들지 않는다 — 권한·담당 반·7일 잠금이 그 액션 안에 있다(#77)", () => {
    expect(src).not.toMatch(/from\("attendance_records"\)/);
    expect(src).not.toMatch(/createClient\(/);
  });

  it("🔴 저장 축은 writeSlot, 화면 교시는 periodStart로만 간다", () => {
    expect(src).toMatch(/slotStart:\s*student\.writeSlot/);
    expect(src).toMatch(/periodStart:\s*klass\.firstStart/);
    // 저장 축에 화면 교시를 실으면 영어 반 시수가 두 배가 된다.
    expect(src).not.toMatch(/slotStart:\s*klass\.firstStart/);
  });

  it("데스크 10분 유예 게이트를 켠다 — 당일 출결 화면의 규약", () => {
    expect(src).toMatch(/source:\s*"live"/);
  });

  it("일괄은 빈 칸만 채운다(서버 강제) — 낡은 화면이 남의 결석을 뒤집지 못한다", () => {
    expect(src).toMatch(/fillEmptyOnly:\s*true/);
  });

  it("사유 덧붙이기는 noteOnly — 상태·시수를 다시 보내지 않는다", () => {
    expect(src).toMatch(/noteOnly:\s*true/);
  });
});

describe("방송 — 같은 문서의 원스크린·ECS가 따라오게", () => {
  const src = read(BOARD);

  it("개별·일괄 둘 다 방송한다", () => {
    expect((src.match(/publishAttendanceApplied\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("🔴 방송에 싣는 slot은 **저장 축 그대로**다(개별=writeSlot · 일괄=plan.slot)", () => {
    expect(src).toMatch(/slot:\s*student\.writeSlot/);
    expect(src).toMatch(/slot:\s*plan\.slot/);
  });

  it("일괄은 **응답 applied**만 싣는다 — 요청 배열을 실으면 걸러진 칸까지 알린다", () => {
    expect(src).toMatch(/res\.applied\.map\(/);
    expect(src).toMatch(/res\.applied\.length > 0/);
  });
});

describe("거절은 화면에 한글로", () => {
  const src = read(BOARD);

  it("에러를 토스트와 화면에 함께 남기고 낙관 반영을 되돌린다", () => {
    expect(src).toMatch(/toast\.error\(/);
    expect(src).toMatch(/revert\(/);
    expect(src).toMatch(/res\.error/);
  });
});

describe("색·라벨은 단일 소스", () => {
  it("화면 파일이 상태 색·라벨 맵을 새로 만들지 않는다(팔레트 v4 캐논)", () => {
    for (const file of [
      BOARD,
      "src/features/attendance/quick/components/quick-class-card.tsx",
      "src/features/attendance/quick/components/quick-mark-sheet.tsx",
    ]) {
      const src = read(file);
      expect(src, file).not.toMatch(/STATUS_META|SUBJECT_META|"결석"\s*:/);
    }
    expect(read("src/features/attendance/quick/components/quick-class-card.tsx")).toMatch(
      /SEAT_MARK_TONE\[/,
    );
    expect(read("src/features/attendance/quick/components/quick-mark-sheet.tsx")).toMatch(
      /ATT_SOLID\[|ATT_SOFT\[/,
    );
  });
});

describe("라우트", () => {
  const page = read(PAGE);

  it("기존 attendance 권한 키를 쓴다 — 새 메뉴 키 신설 금지([[#92]])", () => {
    expect(page).toMatch(/requireAccess\("attendance"\)/);
  });

  it("🔴 오늘 고정 — 지난 날짜 파라미터를 받지 않는다", () => {
    expect(page).not.toMatch(/searchParams/);
    expect(page).toMatch(/getLiveBoard\(today,\s*true\)/); // selfOnly = 내 수업만
  });

  it("독립 조회는 Promise.all(B4) · 첫 페인트를 막지 않게 스켈레톤이 있다(B7)", () => {
    expect(page).toMatch(/Promise\.all\(/);
    expect(() => read("src/app/(shell)/attendance/quick/loading.tsx")).not.toThrow();
  });

  it("학생 연락처를 클라 페이로드에 남기지 않는다", () => {
    expect(page).toMatch(/parentPhone:\s*null/);
    expect(page).toMatch(/studentPhone:\s*null/);
  });
});

describe("입구 — 하부탭 하나만으로는 폰에서 갈 길이 없다", () => {
  it("사이드바 하부탭에 있다", () => {
    expect(read("src/lib/navigation.ts")).toMatch(/href:\s*"\/attendance\/quick"/);
  });

  it("🔴 강사 홈 두 곳(원스크린 상단 바·ECS 오늘 툴바)에도 같은 링크가 있다", () => {
    expect(read("src/features/onescreen/components/top-bar.tsx")).toMatch(/"\/attendance\/quick"/);
    expect(read("src/app/(shell)/ecs/_components/today-nav.tsx")).toMatch(/"\/attendance\/quick"/);
    expect(read("src/app/(shell)/ecs/page.tsx")).toMatch(/EcsQuickAttendanceLink/);
  });

  it("🔴 강사 미니셸 '내 메뉴'에도 있다 — 폰 강사의 실제 입구", () => {
    expect(read("src/components/teacher-menu.tsx")).toMatch(/"\/attendance\/quick"/);
  });

  // 원장 2026-08-20: *"강사뷰가 아닌데 왜 메뉴에 '출결 모드'가 있지..?"* — 사이드바는 관리자뷰에만
  // 있는데 이 면은 자기 담당 반만 그린다. 담당 반 0인 사무실 계정엔 눌러도 빈 화면이라 줄만 늘었다.
  it("🔴 사이드바 줄은 겸직에게만(teacherOnly) — 사무실이 매일 쓰는 두 면은 그대로 보인다", () => {
    const faces = SUBTABS_BY_MENU.attendance ?? [];
    expect(faces.find((s) => s.href === "/attendance/quick")?.teacherOnly).toBe(true);
    expect(faces.find((s) => s.href === "/attendance/live")?.teacherOnly).toBeUndefined();
    expect(faces.find((s) => s.href === "/attendance")?.teacherOnly).toBeUndefined();
  });

  it("🔴 사이드바가 그 플래그를 실제로 읽는다 — 플래그만 두면 write-only orphan", () => {
    const flat = read("src/components/app-sidebar.tsx").replace(/\s+/g, "");
    expect(flat).toContain("!s.teacherOnly||canTeacherView||isSubActive(");
  });
});
