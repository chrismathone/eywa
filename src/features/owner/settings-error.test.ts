import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isVisitCounted } from "@/features/nav/menu-visits";
import { MENU_LABEL } from "@/lib/permissions";
import { SETTINGS_ROLE_KEYS } from "@/lib/settings-role-catalog";
import { DEFAULT_SETTINGS } from "./defaults";
import { diffSettingsSection, settingFieldLabel } from "./settings-diff";
import { plainSettingsReason, settingsValidationError, type SettingsIssue } from "./settings-error";
import {
  SECTION_SCHEMAS,
  consultationsSchema,
  navigationSchema,
  operationsSchema,
  permissionsSchema,
  profileSchema,
} from "./settings-types";

/**
 * 학원 설정 저장의 화면용 오류 문구(2026-10-06) — 일반 지점 화면에 내부 식별자를 내보내지 않되,
 * **어느 칸을 어떻게 고쳐야 하는지는 알려 준다**.
 *
 * 전에는 `입력값 오류 (subjects.1.monthPlan.notices): Too big: expected string to have <=600 characters`처럼
 * 칸의 경로와 검증 도구의 영문 원문이 그대로 떴다. 그걸 통째로 지우면 사용자가 무엇을 고칠지 알 수 없다(적대 리뷰 5 C1).
 */
/** 실제 스키마로 검증해 첫 오류를 화면 문구로 — 저장 액션이 하는 일 그대로. */
function said(section: string, schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: unknown[] } } }, input: unknown): string {
  const result = schema.safeParse(input);
  if (result.success) throw new Error("검증을 통과했다 — 사례가 잘못됐다");
  return settingsValidationError(section, result.error!.issues[0] as SettingsIssue, input);
}
const RAW = /\/[a-z]|[a-z0-9]_[a-z0-9]|[?&][a-z]+=|subjects|monthPlan|weekdayPeriods|Too |Invalid|expected/;

describe("검증 오류 — 정상 화면에서 만들 수 있는 입력 실수", () => {
  const ops = () => structuredClone(DEFAULT_SETTINGS.operations);

  it("🔴 월간 계획서 '표 위 안내'가 너무 길다 → 어느 과목의 어느 칸인지와 한도를 말한다", () => {
    const input = ops();
    const english = input.subjects.find((s) => s.key === "english")!;
    english.monthPlan = { bookLegend: "", notices: "가".repeat(601), slogan: "", prepTitle: "", prepNotes: "" };
    const message = said("operations", operationsSchema, input);
    expect(message).toBe(`입력값 오류 (과목 '${english.label}' · 월간 계획서 · 표 위 안내): 600자 이내로 입력해 주세요`);
    expect(message).not.toMatch(RAW);
  });

  it("🔴 사업자등록번호가 너무 길다 → 칸 이름과 한도", () => {
    const message = said("profile", profileSchema, { ...DEFAULT_SETTINGS.profile, bizRegNo: "1".repeat(21) });
    expect(message).toBe("입력값 오류 (사업자등록번호): 20자 이내로 입력해 주세요");
  });

  it("과목 이름이 겹친다 → 그 과목 줄과, 스키마가 적어 둔 한글 사유", () => {
    const input = ops();
    input.subjects[1]!.label = input.subjects[0]!.label;
    const message = said("operations", operationsSchema, input);
    expect(message).toContain(`과목 '${input.subjects[0]!.label}'`);
    expect(message).toContain("과목명이 중복됩니다");
    expect(message).not.toMatch(RAW);
  });

  it("교시 시각의 형식이 틀리다 → 몇 번째 교시의 어느 칸인지", () => {
    const input = ops();
    input.weekdayPeriods[1] = { ...input.weekdayPeriods[1]!, startTime: "9시" };
    const message = said("operations", operationsSchema, input);
    // 이름이 있는 교시는 그 이름으로, 없으면 차례로 가리킨다. 사유는 스키마가 적어 둔 한글 문장이다.
    const label = input.weekdayPeriods[1]!.label;
    const where = label ? `평일 교시 '${label}'` : "평일 교시 · 2번째";
    expect(message).toBe(`입력값 오류 (${where} · 시작 시각): HH:MM 형식`);
    expect(message).not.toMatch(/weekdayPeriods|startTime/);
  });

  it("목록이 한도를 넘는다 → 몇 개까지인지", () => {
    const tooMany = Array.from({ length: 200 }, (_, i) => `학년${i}`);
    const message = said("operations", operationsSchema, { ...ops(), gradeLevels: tooMany });
    expect(message).toMatch(/^입력값 오류 \(학년\): \d+개까지 넣을 수 있습니다$/);
  });
});

describe("🔴 한글 사유라도 내부 식별자가 섞이면 내보내지 않는다", () => {
  it("메뉴 구성에 같은 메뉴가 두 번 → 주소가 아니라 메뉴 이름으로 말한다", () => {
    const duplicated = { menus: [{ href: "/owner?tab=operations" }, { href: "/owner?tab=operations" }], groups: [], teacherMenus: [] };
    const message = said("navigation", navigationSchema, duplicated);
    expect(message).toContain("같은 메뉴가 두 번 담겼습니다");
    expect(message).toContain("운영 체계");
    expect(message).not.toMatch(/\/owner|tab=/);
  });

  it("강사뷰 메뉴 중복도 주소를 싣지 않는다", () => {
    const duplicated = { menus: [], groups: [], teacherMenus: [{ href: "/onescreen" }, { href: "/onescreen" }] };
    const message = said("navigation", navigationSchema, duplicated);
    expect(message).toContain("강사뷰에 같은 메뉴가 두 번 담겼습니다");
    expect(message).not.toMatch(/\/onescreen|\/[a-z]/);
  });

  it("과목 식별자가 겹친다 → 식별자 값을 싣지 않고 무엇을 하면 되는지 말한다", () => {
    const input = structuredClone(DEFAULT_SETTINGS.operations);
    input.subjects[1] = { ...input.subjects[1]!, key: input.subjects[0]!.key, label: "다른 이름" };
    const message = said("operations", operationsSchema, input);
    expect(message).toContain("이 과목 줄을 지우고 다시 추가해 주세요");
    expect(message).not.toContain(`: ${input.subjects[0]!.key}`);
    expect(message).not.toMatch(/[a-z0-9]_[a-z0-9]/);
  });

  it("🔴 상담 양식의 식별자가 겹친다 → 식별자 값을 싣지 않고 그 양식 줄을 이름으로 가리킨다(적대 리뷰 5b B2)", () => {
    // 밑줄이 없는 식별자는 '내부 식별자 모양' 검사에 안 걸린다 — 사유 문장 자체에 값을 싣지 않아야 한다.
    for (const key of ["general", "firstvisit", "initial_visit"]) {
      const row = { key, body: "", category: null, audience: null, isDefault: false };
      const input = { templates: [{ ...row, name: "첫 상담" }, { ...row, name: "두 번째 상담" }] };
      const message = said("consultations", consultationsSchema, input);
      expect(message).toBe(
        "입력값 오류 (상담 양식 '두 번째 상담'): 다른 양식과 같은 양식으로 저장되어 있습니다. 이 양식 줄을 지우고 다시 추가해 주세요",
      );
      expect(message).not.toContain(key);
    }
  });

  it("스키마 밖에서 온 한글 문장에 주소·내부 키가 섞였으면 기본 사유로 바꾼다(한글이 있다는 것만으로 통과시키지 않는다)", () => {
    for (const message of ["같은 메뉴가 두 번 담겼습니다 (/owner?tab=operations)", "잠긴 메뉴입니다: teacher_onescreen", "주소가 틀렸습니다 ?tab=x"]) {
      expect(settingsValidationError("navigation", { path: [], message, code: "custom" })).toBe("입력값 오류: 값을 확인해 주세요");
    }
    // 내부 식별자가 없는 한글 사유는 그대로.
    expect(settingsValidationError("permissions", { path: [], message: "담당자를 중복 지정할 수 없습니다", code: "custom" })).toBe(
      "입력값 오류: 담당자를 중복 지정할 수 없습니다",
    );
  });
});

describe("오류 종류별 사유 · 칸 이름", () => {
  it("길이 · 개수 · 범위 · 형식", () => {
    const at = (issue: Partial<SettingsIssue>) => settingsValidationError("billing", { path: ["dueDay"], message: "Too big", ...issue });
    expect(at({ code: "too_big", origin: "string", maximum: 30 })).toBe("입력값 오류 (납부일): 30자 이내로 입력해 주세요");
    expect(at({ code: "too_big", origin: "number", maximum: 31 })).toBe("입력값 오류 (납부일): 31 이하로 입력해 주세요");
    expect(at({ code: "too_big", origin: "array", maximum: 5 })).toBe("입력값 오류 (납부일): 5개까지 넣을 수 있습니다");
    expect(at({ code: "too_small", origin: "string", minimum: 1 })).toBe("입력값 오류 (납부일): 비워 둘 수 없습니다");
    expect(at({ code: "too_small", origin: "number", minimum: 1 })).toBe("입력값 오류 (납부일): 1 이상으로 입력해 주세요");
    expect(at({ code: "too_small", origin: "array", minimum: 1 })).toBe("입력값 오류 (납부일): 하나 이상 넣어 주세요");
    expect(at({ code: "invalid_format" })).toBe("입력값 오류 (납부일): 형식을 확인해 주세요");
    expect(at({ code: "invalid_type" })).toBe("입력값 오류 (납부일): 값을 확인해 주세요");
  });

  it("🔴 칸의 경로(내부 키)와 검증 도구의 영문 원문은 어떤 경우에도 싣지 않는다", () => {
    for (const path of [["subjects", 1, "weekdayPeriods", 0, "label"], ["futureField", "inner"], ["overrides", 3, "menu"], []] as PropertyKey[][]) {
      for (const message of ["Invalid input: expected string, received number", "Too big: expected array to have <=80 items", "Required"]) {
        const text = settingsValidationError("operations", { path, message, code: "invalid_type" });
        expect(text, JSON.stringify(path)).not.toMatch(/subjects|weekdayPeriods|futureField|inner|overrides|menu|Invalid|Too big|Required|expected/);
        expect(text.startsWith("입력값 오류")).toBe(true);
      }
    }
  });

  it("모르는 칸 · 모르는 섹션 · 오류 없음 — 이름 없이 사유만", () => {
    expect(settingsValidationError("operations", { path: ["futureField"], message: "Invalid", code: "invalid_type" })).toBe("입력값 오류: 값을 확인해 주세요");
    expect(settingsValidationError("unknown", { path: ["x"], message: "한글 사유" })).toBe("입력값 오류: 한글 사유");
    expect(settingsValidationError("profile", undefined)).toBe("입력값 오류: 값을 확인해 주세요");
  });

  it("목록의 줄 — 이름이 있으면 그 이름으로, 없으면 차례로 가리킨다(보낸 값을 받았을 때만 이름을 안다)", () => {
    const input = { subjects: [{ label: "수학" }, { label: "영어", weekdayPeriods: [{ label: "" }] }], gradeLevels: ["초1", ""] };
    const at = (path: PropertyKey[], withInput = true) =>
      settingsValidationError("operations", { path, message: "x", code: "invalid_type" }, withInput ? input : undefined);
    expect(at(["subjects", 1, "color"])).toBe("입력값 오류 (과목 '영어' · 색): 값을 확인해 주세요");
    expect(at(["subjects", 1, "weekdayPeriods", 0, "startTime"])).toBe("입력값 오류 (과목 '영어' · 평일 교시 · 1번째 · 시작 시각): 값을 확인해 주세요");
    expect(at(["gradeLevels", 1])).toBe("입력값 오류 (학년 · 2번째): 값을 확인해 주세요");
    expect(at(["subjects", 1, "color"], false)).toBe("입력값 오류 (과목 · 2번째 · 색): 값을 확인해 주세요");
  });

  it("사용자가 지은 긴 이름은 줄여 싣는다", () => {
    const input = { subjects: [{ label: "가".repeat(60) }] };
    const text = settingsValidationError("operations", { path: ["subjects", 0, "color"], message: "x", code: "invalid_type" }, input);
    expect(text).toContain(`'${"가".repeat(20)}…'`);
  });

  it("🔴 섹션의 맨 위 칸은 전부 이름을 댈 수 있다 — 이름 없는 '값을 확인해 주세요'만 남는 칸이 없다", () => {
    // 저장 화면이 따로 있거나(보강 설정) 켜고 끄는 값뿐인 칸은 제외한다.
    const SKIP: Record<string, RegExp> = { report: /^(show|allow|classnoteSend|classnoteShared|classnoteMath|noticeMode)/, dashboard: /^version$/, makeups: /./ };
    const missing: string[] = [];
    for (const [section, schema] of Object.entries(SECTION_SCHEMAS)) {
      const shape = (schema as unknown as { shape?: Record<string, unknown> }).shape ?? {};
      for (const key of Object.keys(shape)) {
        if (SKIP[section]?.test(key)) continue;
        const text = settingsValidationError(section, { path: [key], message: "x", code: "invalid_type" });
        if (text === "입력값 오류: 값을 확인해 주세요") missing.push(`${section}.${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("🔴 자리 출석부 비밀번호의 이름을 댄다고 값이 감사 기록에 실리지는 않는다(칸 표를 따로 둔다)", () => {
    expect(settingsValidationError("operations", { path: ["seatPins", "lab"], message: "Too big", code: "too_big", origin: "string", maximum: 12 })).toBe(
      "입력값 오류 (자리 출석부 비밀번호): 12자 이내로 입력해 주세요",
    );
    const diff = diffSettingsSection(
      "operations",
      { seatPins: { lab: "1111", jj: "" }, gradeLevels: ["초1"] },
      { seatPins: { lab: "9999", jj: "" }, gradeLevels: ["초1"] },
    );
    expect(JSON.stringify(diff)).not.toMatch(/1111|9999/);
    const diffSource = readFileSync(join(process.cwd(), "src", "features", "owner", "settings-diff.ts"), "utf8");
    expect(diffSource.slice(diffSource.indexOf("const FIELD_LABELS"), diffSource.indexOf("export function settingFieldLabel"))).not.toContain("seatPins");
  });
});

describe("🔴 상속된 속성 이름을 칸 이름으로 치지 않는다(적대 리뷰 5b B1)", () => {
  /** 객체라면 누구나 물려받는 이름 — 이름 표를 그냥 읽으면 함수가 나와 그 원문이 문구에 섞인다. */
  const INHERITED = ["constructor", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf", "__proto__"];
  const LEAK = /function|native code|\[object|undefined|=>/;

  it("실제 스키마 — 부서별 직급의 부서 이름이 그런 이름이어도 칸 이름만 말한다", () => {
    // `__proto__` 는 검증 도구가 키로 받지 않아 오류 자체가 안 난다 — 아래 직접 호출 사례가 맡는다.
    for (const key of INHERITED.filter((k) => k !== "__proto__")) {
      const input = structuredClone(DEFAULT_SETTINGS.operations) as Record<string, unknown>;
      input.jobTitlesByDepartment = Object.fromEntries([[key, 3]]);
      const message = said("operations", operationsSchema, input);
      expect(message, key).not.toMatch(LEAK);
      expect(message, key).toMatch(/^입력값 오류 \(부서별 직급\): /);
    }
  });

  it("맨 위 칸 · 안쪽 칸 · 섹션 이름 어느 자리에 와도 이름으로 치지 않는다", () => {
    for (const key of INHERITED) {
      const cases: [string, PropertyKey[]][] = [
        ["operations", [key]],
        ["operations", ["subjects", key]],
        ["operations", [key, key]],
        [key, ["subjects"]],
        [key, [key, key]],
      ];
      for (const [section, path] of cases) {
        const message = settingsValidationError(section, { path, message: "Invalid input", code: "custom" }, { subjects: [] });
        expect(message, `${section} / ${path.join(".")}`).not.toMatch(LEAK);
      }
      // 이름을 하나도 못 대는 경로는 사유만 남는다.
      expect(settingsValidationError(key, { path: [key, key], message: "Invalid input", code: "custom" })).toBe("입력값 오류: 값을 확인해 주세요");
    }
  });

  it("보낸 값의 상속 속성으로는 내려가지 않는다 — 줄의 이름은 그 줄이 직접 가진 값만", () => {
    // label 을 물려받기만 한 줄(직접 가진 이름이 없다) — 이름 대신 차례로 가리킨다.
    const inherited = Object.create({ label: "물려받은 이름" }) as Record<string, unknown>;
    const message = settingsValidationError(
      "operations",
      { path: ["subjects", 0, "label"], message: "Invalid input", code: "custom" },
      { subjects: [inherited] },
    );
    expect(message).toBe("입력값 오류 (과목 · 1번째 · 이름): 값을 확인해 주세요");
    expect(message).not.toContain("물려받은 이름");
  });

  it("감사 기록의 칸 이름 표도 제 속성만 읽는다", () => {
    for (const key of INHERITED) {
      expect(settingFieldLabel("operations", key), key).toBeUndefined();
      expect(settingFieldLabel(key, "subjects"), key).toBeUndefined();
    }
    expect(settingFieldLabel("operations", "subjects")).toBe("과목");
  });
});

describe("역할·권한 스키마의 사유 문구", () => {
  it("🔴 역할·메뉴의 내부 이름(master · student · owner · admin)을 쓰지 않는다", () => {
    const student = said("permissions", permissionsSchema, { overrides: [{ menu: "billing", role: "student", access: "full" }] });
    const master = said("permissions", permissionsSchema, { overrides: [{ menu: "owner", role: "master", access: "none" }] });
    expect(student).toBe("입력값 오류: 학생 계정은 '내 학습' 전용이라 메뉴 권한을 줄 수 없습니다");
    expect(master).toBe(`입력값 오류: 원장의 ${MENU_LABEL.owner} · ${MENU_LABEL.admin} · ${MENU_LABEL.dashboard} 접근은 잠글 수 없습니다`);
    for (const text of [student, master]) expect(text).not.toMatch(/[A-Za-z]/);
  });
});

describe("DB가 돌려준 사유", () => {
  it("운영자 역할 이름을 지점 화면 문구로 바꾼다 — SQL의 문장은 그대로 둔다", () => {
    expect(plainSettingsReason("대시보드 공개 설정은 원장 또는 총괄만 변경할 수 있습니다")).toBe("대시보드 공개 설정은 원장만 변경할 수 있습니다");
  });

  it("괄호 속 내부 식별자를 걷는다(옛 가드의 문장)", () => {
    expect(plainSettingsReason("학원 설정(tenant_settings)은 원장(master)만 삭제할 수 있습니다")).toBe("학원 설정은 원장만 삭제할 수 있습니다");
    expect(plainSettingsReason("역할·권한(permissions)은 원장(master)만 변경할 수 있습니다")).toBe("역할·권한은 원장만 변경할 수 있습니다");
  });

  it("그 밖의 문장은 그대로", () => {
    expect(plainSettingsReason("해당 설정 변경 권한이 없습니다")).toBe("해당 설정 변경 권한이 없습니다");
    expect(plainSettingsReason("설정을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.")).toBe("설정을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
  });
});

describe("화면 문구 — 일반 지점 화면에 내부 용어가 없다", () => {
  const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
  const strip = (code: string) => code.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  /**
   * 소스에서 사람에게 보일 만한 글 조각을 뽑는다 — 한글이 든 따옴표 문자열(큰·작은·백틱)과 JSX 본문(여러 줄 포함).
   * ⚠️ 문자열을 다 잡는다고 보장하지는 않는다(조립된 문장 등) — 그래서 아래에서 추출기 자체를 먼저 확인하고,
   *    실제 오류 문구는 위 사례들이 스키마·헬퍼를 직접 돌려 확인한다.
   */
  const texts = (code: string): string[] => {
    const stripped = strip(code);
    const quoted = [...stripped.matchAll(/"([^"\n]*[가-힣][^"\n]*)"|'([^'\n]*[가-힣][^'\n]*)'|`([^`]*[가-힣][^`]*)`/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
    const jsx = [...stripped.matchAll(/>([^<>{}]*[가-힣][^<>{}]*)</g)].map((m) => m[1]!.replace(/\s+/g, " ").trim());
    return [...quoted, ...jsx];
  };
  const LEAK = /테넌트|\(master\)|\(owner\)|super_admin|슈퍼관리자|총괄|SQL을 적용|DB에 없습니다/;

  it("추출기 자체 — 여러 줄 JSX · 작은따옴표 · 백틱 문장을 잡고, 주석은 잡지 않는다", () => {
    const sample = [
      "// 주석의 원장(master)은 세지 않는다",
      "const a = '작은따옴표 원장(master)';",
      "const b = `백틱 학원 설정(owner) ${x}`;",
      "<p>",
      "  여러 줄 본문의 테넌트",
      "</p>",
    ].join("\n");
    const found = texts(sample);
    expect(found).toEqual(expect.arrayContaining(["작은따옴표 원장(master)", "백틱 학원 설정(owner) ${x}", "여러 줄 본문의 테넌트"]));
    expect(found.join("|")).not.toContain("주석의");
    expect(found.filter((t) => LEAK.test(t))).toHaveLength(3);
  });

  it("🔴 설정 화면과 그 저장 경로의 문구에 내부 용어가 없다", () => {
    const files: string[][] = [
      ["src", "app", "(shell)", "owner", "page.tsx"],
      ["src", "app", "(shell)", "owner", "_components", "section-form.tsx"],
      ["src", "app", "(shell)", "owner", "_components", "slack-card.tsx"],
      ["src", "app", "(shell)", "owner", "_components", "permissions-section.tsx"],
      ["src", "app", "(shell)", "owner", "_components", "role-matrix-table.tsx"],
      ["src", "app", "(shell)", "owner", "_components", "teacher-menu-toggles.tsx"],
      ["src", "app", "(shell)", "owner", "_components", "user-override-editor.tsx"],
      ["src", "app", "(shell)", "owner", "_components", "special-access-editor.tsx"],
      ["src", "app", "(shell)", "owner", "_components", "staff-scope-editor.tsx"],
      ["src", "features", "owner", "server", "actions.ts"],
      ["src", "features", "owner", "server", "subject-actions.ts"],
      ["src", "features", "owner", "server", "classroom-actions.ts"],
      ["src", "features", "owner", "settings-types.ts"],
      ["src", "features", "integrations", "server", "actions.ts"],
      ["src", "features", "periods", "server", "actions.ts"],
      ["src", "features", "notices", "server", "actions.ts"],
    ];
    for (const rel of files) {
      const found = texts(read(...rel));
      // 추출이 비어서 통과하는 일이 없게 — 파일마다 한글 문구가 실제로 잡혀야 한다.
      expect(found.length, rel.join("/")).toBeGreaterThan(0);
      expect(found.filter((text) => LEAK.test(text)), rel.join("/")).toEqual([]);
    }
  });

  it("권한 거절 문구는 실제로 검사하는 설정의 이름을 댄다", () => {
    expect(read("src", "features", "integrations", "server", "actions.ts").match(/\$\{MENU_LABEL\.integration_settings\} 변경 권한이 없습니다/g)).toHaveLength(3);
    expect(read("src", "features", "owner", "server", "subject-actions.ts")).toContain("${MENU_LABEL.operations_settings} 변경 권한이 없습니다");
    expect(read("src", "features", "owner", "server", "classroom-actions.ts")).toContain("${MENU_LABEL.operations_settings} 변경 권한이 없습니다");
    expect(read("src", "features", "periods", "server", "actions.ts")).toContain("${MENU_LABEL.operations_settings} 변경 권한이 없습니다");
    expect(read("src", "features", "notices", "server", "actions.ts")).toContain("${MENU_LABEL.popup_settings} 변경 권한이 없습니다");
  });

  it("저장·과목 삭제 경로는 DB 원문과 표 이름을 그대로 돌려주지 않는다", () => {
    const actions = strip(read("src", "features", "owner", "server", "actions.ts"));
    expect(actions).not.toMatch(/return \{ error: error\.message \}/);
    expect(actions).toContain('plainSettingsReason(explainDbError(error, { scope: "owner.saveOwnerSection"');
    const subjects = strip(read("src", "features", "owner", "server", "subject-actions.ts"));
    expect(subjects).not.toMatch(/\$\{table\}: \$\{error\.message\}|absorb_subject_key: \$\{|e instanceof Error \? e\.message/);
    expect(subjects).not.toMatch(/throw new Error\(`\w+: \$\{/);
  });

  it("인쇄물 머리글의 안내는 실제로 찍히는 곳을 말한다(등록 상담지 · 상담 준비 서류)", () => {
    const face = read("src", "app", "(shell)", "owner", "_components", "notifications-section.tsx");
    expect(face).toContain("등록 상담지·상담 준비 서류 상단");
    expect(face).not.toMatch(/청구서·성적표/);
    for (const page of ["print", "prep"]) {
      expect(read("src", "app", "(print)", "enrollment", "[id]", page, "page.tsx")).toContain("settings.notifications.printHeader");
    }
  });

  it("옛 위치·옛 이름 안내를 지금 화면에 맞췄다", () => {
    const report = read("src", "app", "(shell)", "owner", "_components", "report-section.tsx");
    expect(report).not.toMatch(/학원 운영 > (과목|AI 멘트)/);
    expect(read("src", "app", "(shell)", "owner", "_components", "consultations-section.tsx")).toContain("원생상담 등록 화면에서");
  });
});

describe("자주 방문한 메뉴 — 설정은 세지 않는다", () => {
  it("🔴 설정 면·설정 화면의 권한 키도 세지 않는다 — 세면 목적지로 못 바꿔 한 칸이 비고 업무 메뉴가 줄어든다", () => {
    for (const key of SETTINGS_ROLE_KEYS) expect(isVisitCounted(key), key).toBe(false);
    expect(isVisitCounted("kiosk_settings")).toBe(false);
    for (const key of ["owner", "dashboard", "help"]) expect(isVisitCounted(key)).toBe(false);
    for (const key of ["timetable", "attendance", "students", "billing"]) expect(isVisitCounted(key), key).toBe(true);
  });
});
