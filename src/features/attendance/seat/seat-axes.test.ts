import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isPayrollSeat,
  parseSeatKey,
  PAYROLL_SEAT_KEYS,
  PIN_SEAT_KEYS,
  USABLE_SEAT_KEYS,
} from "./seat";

/**
 * 🔴🔴 **문과 돈은 서로 다른 축이다** — 2026-08-19 `/seat/jj` 공개 오픈에서 갈라 놓은 것.
 *
 * 종전엔 배열 하나(`OPEN_SEAT_KEYS`)가 ① 공개 PIN 경로와 ② `attendance_records.seat_label`을 **동시에**
 * 정했다. 그래서 "JJ실도 로그인 없이 열자"는 요청을 그 배열에 `"jj"` 한 글자를 더해 처리하면, 그 순간부터
 * JJ 출결에 `seat_label`이 박히고 **담임 시수 집계가 그 행을 걸러 내 담임 정산에서 빠진다**
 * (실측 2026-08-19: `seat_label` 붙은 행 0 / JJ 교시 시각 출결 334 = 지금은 전부 담임 축).
 *
 * 화면은 멀쩡하고 **금액만 조용히 틀리는** 종류라, 두 배열이 다시 하나로 합쳐지는 것을 여기서 막는다.
 * ⚠️ 이 테스트가 깨지면 "테스트를 고치기 전에 왜 돈 축이 달라졌는지" 먼저 설명할 것(돈 산식 규율).
 */
const root = join(__dirname, "../../../..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");
/** 실제 **코드**만 본다 — 주석에 적힌 상수 이름("…로 가르지 말 것")까지 위반으로 세면 경고문을 못 쓴다. */
const code = (...p: string[]) =>
  read(...p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("자리 축 분리 — 공개 PIN(문) ≠ 자리 시수(돈)", () => {
  it("🔴 JJ실은 공개 PIN이 열려도 급여 자리가 아니다", () => {
    expect(isPayrollSeat("jj")).toBe(false);
    expect(isPayrollSeat("lab")).toBe(true);
    expect(PAYROLL_SEAT_KEYS).toEqual(["lab"]);
    expect(PAYROLL_SEAT_KEYS).not.toContain("jj");
  });

  it("🔴 두 목록은 서로 다른 상수다 — 하나로 합치면 실패한다", () => {
    expect(PIN_SEAT_KEYS).not.toBe(PAYROLL_SEAT_KEYS); // 같은 배열을 두 이름으로 쓰는 것도 금지
    expect(PIN_SEAT_KEYS).not.toEqual(PAYROLL_SEAT_KEYS);
    expect(PIN_SEAT_KEYS).toContain("jj");
    // 문은 열되 화면 축(USABLE)과도 별개로 유지 — 셋 다 각자의 이유로 늘고 준다.
    expect(USABLE_SEAT_KEYS).toContain("jj");
  });

  it("🔴 isPayrollSeat는 급여 목록만 본다(문 목록을 보면 자리를 열 때 돈이 따라 움직인다)", () => {
    const body = /export function isPayrollSeat[\s\S]*?\n}/.exec(read("src/features/attendance/seat/seat.ts"))?.[0];
    expect(body, "isPayrollSeat 본문을 못 찾았다").toBeTruthy();
    expect(body!).toMatch(/PAYROLL_SEAT_KEYS/);
    expect(body!).not.toMatch(/PIN_SEAT_KEYS/);
    expect(body!).not.toMatch(/USABLE_SEAT_KEYS/);
  });

  it("공개 PIN 문 3곳(경로·쿠키·쓰기 게이트)이 모두 PIN 목록을 본다", () => {
    expect(parseSeatKey("jj")).toBe("jj");
    expect(parseSeatKey("lab")).toBe("lab");

    const pin = code("src/features/attendance/seat/pin.ts");
    expect(pin, "쿠키 검증이 PIN 목록을 봐야 한다").toMatch(/PIN_SEAT_KEYS/);
    expect(pin).not.toMatch(/PAYROLL_SEAT_KEYS/);

    const session = code("src/features/attendance/seat/server/pin-session.ts");
    expect(session, "writeSeatPinCookie가 PIN 목록을 봐야 한다").toMatch(/PIN_SEAT_KEYS/);
    expect(session).not.toMatch(/PAYROLL_SEAT_KEYS|isPayrollSeat\(/);

    const gate = code("src/features/attendance/seat/server/gate.ts");
    expect(gate, "gateSeatWrite PIN 분기가 PIN 목록을 봐야 한다").toMatch(/PIN_SEAT_KEYS/);
    expect(gate, "쓰기 게이트를 돈 축으로 가르지 말 것").not.toMatch(/isPayrollSeat\(|PAYROLL_SEAT_KEYS/);
  });

  it("🔴 출결 쓰기의 seat_label은 급여 자리 안에서만 박힌다(JJ는 null)", () => {
    const lines = code("src/features/attendance/seat/server/actions.ts").split("\n");
    const withLabel = lines.map((line, i) => ({ line, i })).filter(({ line }) => /seat_label\s*:/.test(line));
    // ① 라벨을 실제로 **박는** 줄(SEAT_DB_LABEL을 싣는 줄)은 급여 자리 안에서만.
    const stamps = withLabel.filter(({ line }) => /SEAT_DB_LABEL/.test(line));
    expect(stamps.length, "actions.ts에 seat_label 쓰기가 사라졌다").toBeGreaterThan(0);
    for (const { line, i } of stamps) {
      // 같은 줄에서 삼항으로 갈리거나(비급여 = null), `if (isPayrollSeat(...))` 블록 안이어야 한다.
      const guarded =
        /isPayrollSeat\([^)]*\)\s*\?/.test(line) ||
        lines.slice(Math.max(0, i - 25), i).some((l) => /if \(isPayrollSeat\(/.test(l));
      expect(guarded, `actions.ts:${i + 1} — seat_label이 급여 자리 밖에서 박힌다: ${line.trim()}`).toBe(true);
    }
    // ② 라벨을 **옮기는** 줄은 위에서 갈린 값(`<식별자>.seat_label`)을 복사해야 한다 —
    //    리터럴이나 미가공 라벨이 들어오면 비급여 자리에도 라벨이 박힌다.
    for (const { line, i } of withLabel.filter(({ line }) => !/SEAT_DB_LABEL/.test(line))) {
      expect(line, `actions.ts:${i + 1} — seat_label에 출처 모를 값이 들어간다`).toMatch(
        /seat_label:\s*\w+\.seat_label\s*,?\s*$/,
      );
    }
  });

  it("자리 시수를 거르는 담임 집계 두 곳은 그대로다(seat-money-guard와 이중 방어)", () => {
    for (const rel of [
      "src/features/payroll/server/tier-rows.ts",
      "src/features/payroll/server/settlement-queries.ts",
    ]) {
      expect(read(rel), `${rel}: seat_label 행을 거르는 분기가 없다`).toMatch(/if \(r\.seat_label\) continue;/);
    }
  });
});

describe("공개 PIN 화면은 명단 밖으로 나가지 않는다", () => {
  const page = read("src/app/(seat)/seat/[seat]/page.tsx");

  it("오늘·그 자리만 — 날짜 파라미터도, 다른 자리 전환도 없다", () => {
    expect(page, "공개 화면은 kstToday만 그린다").toMatch(/kstToday\(\)/);
    expect(page, "공개 화면에 날짜 이동을 만들지 말 것").not.toMatch(/date\?:\s*string/);
    expect(page, "쿠키의 자리와 주소의 자리가 같아야 한다").toMatch(/session\.seat !== seat/);
  });

  it("학생 상세·검색·월간으로 가는 길이 없다", () => {
    expect(page).not.toMatch(/\/students\//);
    expect(page).not.toMatch(/\/month/);
  });

  it("검색엔진에 실리지 않는다(주소가 새면 남는 건 비밀번호뿐)", () => {
    expect(page).toMatch(/robots:\s*\{\s*index:\s*false/);
  });
});
