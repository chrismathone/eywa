import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("학부모 포털 이용 가능 상태 배선", () => {
  it("레이아웃과 모든 학부모 페이지가 같은 판정을 먼저 지난다", () => {
    for (const path of [
      "src/app/(parent)/parent/layout.tsx",
      "src/app/(parent)/parent/page.tsx",
      "src/app/(parent)/parent/live/page.tsx",
      "src/app/(parent)/parent/nearby/page.tsx",
      "src/app/(parent)/parent/classes/page.tsx",
      "src/app/(parent)/parent/rides/page.tsx",
    ]) {
      const source = read(path);
      // 판정(3상태 또는 켜짐 여부)이 데이터 조회·이동보다 먼저 온다 — 페이지는 빈 본문(null) 대신 같은 종착 화면을 그린다.
      const gate = source.search(/parentPortal(State|Available)\(viewer\)/);
      expect(gate, path).toBeGreaterThan(-1);
      expect(source, path).not.toContain("return null;");
      for (const later of ['redirect("/parent/rides")', "await load", "loadParent"]) {
        const at = source.indexOf(later, source.indexOf("export default"));
        if (at > -1 && !path.endsWith("layout.tsx")) expect(gate, `${path} · ${later}`).toBeLessThan(at);
      }
    }
  });

  it("학부모 전용 조회·외부 지도 액션·실시간 액션도 같은 판정을 지난다", () => {
    for (const path of [
      "src/features/shuttle/parent/server/parent-ride-data.ts",
      "src/features/shuttle/parent/server/parent-month-data.ts",
      "src/features/shuttle/parent/server/parent-departure.ts",
      "src/features/shuttle/parent/server/nearby-data.ts",
      "src/features/shuttle/parent/server/nearby-actions.ts",
      "src/features/classes/server/parent-timetable-data.ts",
      "src/features/shuttle/map/server/parent-live-data.ts",
      "src/features/shuttle/map/server/vehicle-position-actions.ts",
      "src/features/shuttle/map/server/route-path.ts",
    ]) {
      expect(read(path), path).toContain("parentPortalAvailable");
    }
  });

  it("꺼진 지점은 브라우저 제목에도 기능 이름을 남기지 않는다", () => {
    for (const path of [
      "src/app/(parent)/parent/live/page.tsx",
      "src/app/(parent)/parent/nearby/page.tsx",
      "src/app/(parent)/parent/classes/page.tsx",
      "src/app/(parent)/parent/rides/page.tsx",
    ]) {
      const source = read(path);
      expect(source, path).toContain("export async function generateMetadata");
      expect(source, path).toContain('? "');
      expect(source, path).toContain(': "학부모"');
    }
  });

  it("모든 학부모 쓰기는 공용 문 또는 직접 판정을 거쳐 꺼진 지점에서 거절된다", () => {
    const state = read("src/features/shuttle/ride-change/server/parent-ride-state.ts");
    expect(state).toContain("parentPortalAvailable(viewer)");

    const dayActions = read("src/features/shuttle/ride-change/server/parent-ride-actions.ts");
    for (const action of ["changeParentRideStop", "resetParentRide", "skipParentRide", "absentParentRide"]) {
      expect(dayActions, action).toContain(`export async function ${action}`);
    }
    expect(dayActions.match(/parentDayGate\(/g)).toHaveLength(4);

    const regular = read("src/features/shuttle/ride-change/server/parent-regular-ride-actions.ts");
    expect(regular).toContain("const ctx = await parentGate(");

    const notice = read("src/features/shuttle/parent/server/parent-departure-actions.ts");
    expect(notice).toContain("parentPortalAvailable(viewer)");
    expect(notice.indexOf("parentPortalAvailable(viewer)")).toBeLessThan(notice.indexOf(".upsert("));
  });
});
