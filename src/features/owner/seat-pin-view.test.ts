import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./defaults";
import { operationsSchema, type OperationsSettings } from "./settings-types";
import { REDACTED_SEAT_PIN, operationsForViewer, redactSeatPins, seatPinStatus } from "./seat-pin-view";

/**
 * 자리 PIN을 읽기 전용 열람자에게 내려보내지 않기(2026-10-03 운영점검 합의 A15).
 * 합성 값으로 검증한다 — 실제 PIN·기본값은 이 테스트에 적지 않는다.
 */
const SYNTHETIC_LAB = "Zq7!labPIN";
const SYNTHETIC_JJ = "Xk3#jjPIN";
const operations = (pins: Partial<OperationsSettings["seatPins"]> = {}): OperationsSettings => ({
  ...DEFAULT_SETTINGS.operations,
  seatPins: { lab: SYNTHETIC_LAB, jj: SYNTHETIC_JJ, ...pins },
});

describe("읽기 전용 열람자에게 내려가는 운영 설정", () => {
  it("🔴 직렬화한 payload 어디에도 합성 PIN 문자열이 없다", () => {
    const json = JSON.stringify(operationsForViewer(operations(), false));
    expect(json).not.toContain(SYNTHETIC_LAB);
    expect(json).not.toContain(SYNTHETIC_JJ);
  });

  it("다른 운영 항목은 그대로다 — PIN만 지운다", () => {
    const original = operations();
    const redacted = operationsForViewer(original, false);
    // PIN 칸만 원본 값으로 되돌리면 원본과 완전히 같다 = 다른 칸은 하나도 안 바뀌었다.
    expect({ ...redacted, seatPins: original.seatPins }).toEqual(original);
    expect(redacted.seatPins).toEqual({ lab: REDACTED_SEAT_PIN, jj: REDACTED_SEAT_PIN });
  });

  it("원본 객체를 건드리지 않는다(같은 요청의 다른 소비처가 실제 값을 계속 쓴다)", () => {
    const original = operations();
    redactSeatPins(original);
    expect(original.seatPins).toEqual({ lab: SYNTHETIC_LAB, jj: SYNTHETIC_JJ });
  });

  it("🔴 지운 payload는 저장 스키마를 통과하지 못한다 — 어떤 경로로 저장에 닿아도 PIN을 덮지 못한다", () => {
    const parsed = operationsSchema.safeParse(operationsForViewer(operations(), false));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path.join(".") === "seatPins.lab")).toBe(true);
    }
    // 표식은 빈 문자열이 아니다 — 빈 값은 '그 자리 끄기'라는 정식 의미라 저장되면 공개 접속이 꺼진다.
    expect(REDACTED_SEAT_PIN.length).toBeGreaterThan(12);
  });

  it("편집자는 실제 값을 그대로 받는다 — 다른 항목만 고쳐 저장해도 PIN이 보존된다", () => {
    const original = operations();
    const forEditor = operationsForViewer(original, true);
    expect(forEditor).toBe(original);
    // 과목 운영 면이 하는 일: 과목만 바꾸고 나머지는 통과시켜 저장한다.
    const submitted = { ...forEditor, subjects: forEditor.subjects.slice(0, 1) };
    const parsed = operationsSchema.safeParse(JSON.parse(JSON.stringify(submitted)));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.seatPins).toEqual({ lab: SYNTHETIC_LAB, jj: SYNTHETIC_JJ });
    }
  });
});

describe("설정됨 / 꺼짐 — 값 없이 켜짐 여부만", () => {
  it("값이 있으면 설정됨, 비었거나 공백뿐이면 꺼짐", () => {
    expect(seatPinStatus(operations())).toEqual({ lab: true, jj: true });
    expect(seatPinStatus(operations({ lab: "", jj: "   " }))).toEqual({ lab: false, jj: false });
    expect(seatPinStatus(operations({ jj: undefined }))).toEqual({ lab: true, jj: false });
  });

  it("켜짐 여부에는 값이 실리지 않는다", () => {
    const json = JSON.stringify(seatPinStatus(operations()));
    expect(json).not.toContain(SYNTHETIC_LAB);
    expect(json).not.toContain(SYNTHETIC_JJ);
    expect(json).toBe('{"lab":true,"jj":true}');
  });
});

describe("학원 설정 페이지 배선", () => {
  const page = readFileSync(join(process.cwd(), "src/app/(shell)/owner/page.tsx"), "utf8");
  const code = page.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("🔴 운영 체계·과목 운영 두 면 모두 지운 사본을 받는다 — 원본을 직접 넘기지 않는다", () => {
    expect(code).not.toMatch(/initial=\{settings\.operations\}/);
    expect(code.match(/initial=\{operationsForClient\}/g)?.length).toBe(2);
    expect(code).toContain("const operationsForClient = operationsForViewer(settings.operations, canEditOperations);");
  });

  it("지우는 판정은 저장 액션과 같은 함수·같은 권한 키다", () => {
    expect(code).toMatch(
      /const canEditOperations = showsOperations \? await canWriteTenant\(viewer\.systemRole, OWNER_SECTION_MENU\.operations\) : false;/,
    );
    const actions = readFileSync(join(process.cwd(), "src/features/owner/server/actions.ts"), "utf8");
    // 저장 액션: 섹션의 메뉴 키(OWNER_SECTION_MENU[section])로 canWriteTenant.
    expect(actions).toMatch(/canWriteTenant\(actor\.systemRole, section in OWNER_SECTION_MENU \? OWNER_SECTION_MENU\[section as keyof typeof OWNER_SECTION_MENU\] : "owner"\)/);
  });

  it("두 면 모두 읽기 전용이면 폼 제출이 막힌다", () => {
    expect(code.match(/readOnly=\{!canEditOperations\}/g)?.length).toBe(2);
    expect(code).toContain("seatPinStatus={seatPinStatus(settings.operations)}");
  });
});
