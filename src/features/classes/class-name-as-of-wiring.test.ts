/**
 * **미래 주 반 이름**의 배선 규약. 하나만 어긋나도 **에러 없이** 틀린 이름이 뜬다.
 *
 * 2026-08-29 적대 리뷰에서 실제로 잡힌 것:
 *  · 로더가 세션 클라이언트를 고정으로 써서, cron(주입 db)에선 RLS가 **0행**을 돌려주고 시트 동기화만
 *    조용히 옛 이름으로 나갔다([[#104]]와 같은 결 — 에러가 안 난다).
 *  · 셀 타입이 `ScheduleSlot`이 아니라 `ClassDetailQuick`이라 새 필드가 안 닿았다(타입체크가 잡았다).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const queries = strip(read("src", "features", "timetable", "server", "queries.ts"));
const loader = strip(
  read("src", "features", "classes", "server", "class-name-as-of-queries.ts"),
);

describe("🔴 미래 이름은 사람이 읽는 화면에만 — 시트·엑셀 금지", () => {
  // 시트에선 반 이름이 **매칭 키**다. 아직 DB에 없는 이름(9/1부터 쓸 PL1a)이 적히면, 그 시트를 되읽는
  // 구조 가져오기가 그 반을 "DB에 없는 이름"으로 버리고 **배치를 통째로 마감한다**.
  it("기본값은 꺼짐이다(새 소비처가 모르고 켜지지 않게)", () => {
    expect(queries).toMatch(/opts\?\.futureNames && weekSundayOf\(referenceDate\) >= todayStr\(\)/);
  });

  it("시간표 화면만 명시적으로 켠다", () => {
    const page = strip(read("src", "app", "(shell)", "timetable", "page.tsx"));
    expect(page).toContain("futureNames: true");
  });

  it("시트·엑셀 빌더는 켜지 않는다", () => {
    for (const f of [
      ["src", "features", "exports", "english-timetable", "build-buffer.ts"],
      ["src", "app", "api", "cron", "sheets-sync", "route.ts"],
    ]) {
      expect(strip(read(...f))).not.toContain("futureNames");
    }
  });
});

describe("미래 주 반 이름 — 조회", () => {
  it("지난 주엔 조회하지 않는다 — 담임 게이트와 정확히 대칭", () => {
    // 예약은 언제나 미래라 지난 주엔 닿지 않는다. 담임 되살리기의 거울상이어야 한다:
    //   담임(과거) weekSundayOf(ref) <  today
    //   이름(미래) weekSundayOf(ref) >= today
    // 🔴 `weekEndOf`(=ref+6 롤링 창)를 쓰면 지난 주에서도 참이 된다(week.ts 주석의 옛 버그와 같은 축).
    expect(queries).toMatch(/weekSundayOf\(referenceDate\) < todayStr\(\)/);
    expect(queries).toMatch(/weekSundayOf\(referenceDate\) >= todayStr\(\)/);
    expect(queries).not.toMatch(/futureNames && weekEnd >=/);
  });

  it("주입된 db가 있으면 그 클라이언트로 읽는다", () => {
    // 🔴 세션 고정이면 cron에서 RLS 0행 → 시트만 옛 이름(조용한 불일치).
    expect(queries).toContain("getClassNameAsOfIndexWith(db.supabase, db.tenantId)");
  });

  it("admin 경로엔 tenant 필터를 건다", () => {
    // admin은 RLS 우회 — 필터가 없으면 남의 학원 예약을 읽는다.
    expect(loader).toMatch(/if \(tenantId\) query = query\.eq\("tenant_id", tenantId\)/);
    expect(loader).toMatch(/if \(tenantId\) logQuery = logQuery\.eq\("tenant_id", tenantId\)/);
  });

  it("되돌린 예약은 뺀다", () => {
    // 취소한 예약의 이름을 미래 주에 그리면 오지 않을 미래다.
    expect(loader).toContain("restored_at");
    expect(loader).toMatch(/restored\.has\(r\.id\)/);
  });

  it("무한 스캔을 막는다(B2)", () => {
    expect(loader).toMatch(/\.limit\(50\)/);
  });
});

describe("미래 주 반 이름 — 적용 범위", () => {
  it("칸의 실제 날짜로 판정한다(주 단위로 뭉뚱그리지 않는다)", () => {
    // 적용일이 주 중간에 끼면 그 요일부터 새 이름이다.
    expect(queries).toMatch(/resolveClassNameAsOf\(nameIndex, r\.class_id as string, d,/);
    expect(queries).toMatch(/dateOfDowInWeek\(referenceDate, r\.day_of_week as string\)/);
  });

  it("🔴 특강 판정은 **DB 이름**으로 남는다(미래 이름으로 바뀌면 급여와 갈린다)", () => {
    // isSpecialLecture는 이름 폴백 규칙을 급여 autoSalaryGroup과 공유한다 — 표시용 미래 이름을
    // 여기 먹이면 시간표엔 특강인데 급여엔 아닌 반이 생긴다.
    expect(queries).toMatch(/isSpecialLecture\(\{[\s\S]{0,160}className: \(klass\?\.class_name/);
  });

  it("바뀐 칸만 옛 이름을 함께 실어 보낸다", () => {
    expect(queries).toContain("classNameBefore: renamed.before");
    expect(queries).toContain("classNameChangeDate: renamed.date");
  });
});
