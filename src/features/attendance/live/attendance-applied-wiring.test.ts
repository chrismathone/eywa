/**
 * 상단 출석 스트립 ↔ 아래 화면의 배선 가드.
 *
 * 🔑 이 배선은 **떼어내도 아무 에러가 안 난다** — 방송을 안 보내거나 안 듣기만 해도 타입체크·테스트가
 *    전부 통과하고, 증상은 "새로고침하면 보이는데 안 하면 안 보인다"라 다음 사람이 조용히 지워도
 *    아무도 모른다(원장 제보 2026-08-20의 바로 그 증상). 그래서 소스 문자열로 못 박는다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("attendance applied broadcast wiring", () => {
  it("스트립은 저장 성공 시 방송한다 — applied가 있을 때만", () => {
    const src = read("src/features/attendance/live/components/strip-slot.tsx");
    expect(src).toMatch(/publishAttendanceApplied\(/);
    expect(src).toMatch(/res\.applied\.length > 0/);
    // 저장 축(교시)을 그대로 실어야 시트가 칸을 찾는다 — 화면 축(slotStart)을 실으면 수학이 틀어진다.
    expect(src).toMatch(/slot:\s*saveSlot/);
  });

  it("세 소비처가 모두 구독한다 — 원스크린·ECS 요약 카드·ECS 주간 시트", () => {
    for (const file of [
      "src/features/onescreen/components/onescreen-client.tsx",
      "src/features/class-sheets/components/today-board.tsx",
      "src/features/class-sheets/components/sheet-client.tsx",
    ]) {
      expect(read(file), file).toMatch(/subscribeAttendanceApplied\(/);
    }
  });

  it("반영은 순수 함수를 거친다 — 화면 파일에 키 계산·병합을 인라인하지 않는다", () => {
    expect(read("src/features/onescreen/components/onescreen-client.tsx")).toMatch(
      /applyAppliedAttendance\(/,
    );
    expect(read("src/features/class-sheets/components/today-board.tsx")).toMatch(
      /applyAppliedToBoardAtt\(/,
    );
    expect(read("src/features/class-sheets/components/sheet-client.tsx")).toMatch(
      /applyAppliedToSheetAtt\(/,
    );
  });

  it("버스는 server-only가 아니다 — 클라 컴포넌트가 import한다(#61)", () => {
    // 줄 처음의 실제 import만 본다 — 파일 주석이 그 문자열을 인용하고 있다(금지 이유 설명).
    expect(read("src/features/attendance/live/attendance-applied-bus.ts")).not.toMatch(
      /^import\s+"server-only"/m,
    );
  });

  it("배지 축약 표는 단일 소스 — 로스터·원스크린이 사본을 다시 만들지 않는다", () => {
    for (const file of [
      "src/features/onescreen/server/roster.ts",
      "src/features/onescreen/components/onescreen-client.tsx",
    ]) {
      expect(read(file), file).toMatch(/attendanceMarkOf/);
      expect(read(file), file).not.toMatch(/"late" \? "지각"/);
    }
  });
});
