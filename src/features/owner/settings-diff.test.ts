import { describe, expect, it } from "vitest";
import { diffSettingsSection, formatSettingChange, MAX_CHANGES } from "./settings-diff";

describe("diffSettingsSection — 스칼라 섹션", () => {
  it("바뀐 필드만 이전 → 이후로 남는다", () => {
    const d = diffSettingsSection(
      "billing",
      { dueDay: 10, latePolicy: "안내문" },
      { dueDay: 5, latePolicy: "안내문" },
    );
    expect(d.changes).toEqual([{ label: "납부일", from: "10", to: "5" }]);
    expect(d.others).toBe(0);
  });

  it("🔴 비밀·긴 문자열은 값이 안 실린다(감사로그가 자격증명 사본이 되면 안 된다)", () => {
    const d = diffSettingsSection(
      "notifications",
      { alimtalkSenderKey: "OLD_KEY_123" },
      { alimtalkSenderKey: "NEW_KEY_456" },
    );
    expect(d.changes).toEqual([{ label: "알림톡 발신키", note: "변경됨" }]);
    expect(JSON.stringify(d)).not.toContain("NEW_KEY_456");
  });

  it("🔴 라벨을 모르는 필드는 영문 키를 싣지 않고 개수만 센다", () => {
    const d = diffSettingsSection("profile", { someNewField: 1 }, { someNewField: 2 });
    expect(d.changes).toEqual([]);
    expect(d.others).toBe(1);
    expect(JSON.stringify(d)).not.toContain("someNewField");
  });

  it("첫 저장(이전 값 없음)은 조용하다 — 전 필드가 '없음 → 값'으로 쏟아지지 않게", () => {
    expect(diffSettingsSection("profile", null, { name: "인재원" })).toEqual({ changes: [], others: 0 });
  });

  it("키가 통째로 사라진 것도 '지움'으로 잡는다(선택 필드를 비운 경우)", () => {
    const d = diffSettingsSection("billing", { dueDay: 10, latePolicy: "안내문" }, { dueDay: 10 });
    expect(d.changes).toEqual([{ label: "연체 안내", note: "지움" }]);
  });

  it("불리언은 켬/끔으로", () => {
    const d = diffSettingsSection("report", { allowTeacherTestMax: false }, { allowTeacherTestMax: true });
    expect(d.changes[0]).toEqual({ label: "강사 문항수 변경 허용", from: "끔", to: "켬" });
  });
});

describe("diffSettingsSection — 배열(과목·학년 등)", () => {
  it("개수 + 추가/삭제된 이름을 남긴다", () => {
    const d = diffSettingsSection(
      "operations",
      { subjects: [{ key: "math", label: "수학" }, { key: "english", label: "영어" }] },
      { subjects: [{ key: "math", label: "수학" }, { key: "science", label: "과학" }] },
    );
    expect(d.changes[0]).toMatchObject({ label: "과목", from: "2개", to: "2개" });
    expect(d.changes[0]!.note).toContain("추가 과학");
    expect(d.changes[0]!.note).toContain("삭제 영어");
  });

  it("이름·개수가 같고 속성만 바뀌면 '내용 변경'", () => {
    const d = diffSettingsSection(
      "operations",
      { subjects: [{ key: "math", label: "수학", color: "blue" }] },
      { subjects: [{ key: "math", label: "수학", color: "green" }] },
    );
    expect(d.changes[0]).toEqual({ label: "과목", note: "내용 변경" });
  });

  it("안 바뀐 섹션은 빈 목록", () => {
    const same = { gradeLevels: ["초1", "초2"] };
    expect(diffSettingsSection("operations", same, { ...same })).toEqual({ changes: [], others: 0 });
  });
});

describe("diffSettingsSection — 기능 저장 메타데이터", () => {
  it("known은 사람이 고르는 값이 아니므로 추가·변경·삭제 모두 감사 변경에서 뺀다", () => {
    expect(diffSettingsSection("modules", { disabled: [] }, { disabled: [], known: ["eie"] }))
      .toEqual({ changes: [], others: 0 });
    expect(diffSettingsSection("modules", { disabled: [], known: ["eie"] }, { disabled: [], known: ["eie", "classnote"] }))
      .toEqual({ changes: [], others: 0 });
    expect(diffSettingsSection("modules", { disabled: [], known: ["eie"] }, { disabled: [] }))
      .toEqual({ changes: [], others: 0 });
  });
});

describe("diffSettingsSection — 권한(역할×메뉴 한 칸 단위)", () => {
  it("역할 권한이 열리면 무엇이 어떻게 열렸는지 남는다", () => {
    const d = diffSettingsSection(
      "permissions",
      { overrides: [], userOverrides: [] },
      { overrides: [{ role: "teacher", menu: "class_review", access: "readonly" }], userOverrides: [] },
    );
    expect(d.changes).toEqual([{ label: "강사 · 직원 평가", from: "기본값", to: "조회" }]);
  });

  it("예외가 사라지면 '기본값(예외 해제)'로 남는다 — 조용히 닫히지 않게", () => {
    const d = diffSettingsSection(
      "permissions",
      { overrides: [{ role: "admin", menu: "staff", access: "none" }], userOverrides: [] },
      { overrides: [], userOverrides: [] },
    );
    expect(d.changes).toEqual([{ label: "관리자 · 직원관리", from: "차단", to: "기본값(예외 해제)" }]);
  });

  it("개인 예외도 메뉴 단위로 잡힌다(이름은 감사 화면이 붙인다)", () => {
    const d = diffSettingsSection(
      "permissions",
      { overrides: [], userOverrides: [] },
      { overrides: [], userOverrides: [{ userId: "u1", menu: "staff", access: "full" }] },
    );
    expect(d.changes).toEqual([{ label: "개인 예외 · 직원관리", from: "기본값", to: "쓰기" }]);
  });

  it("변경 없으면 조용하다", () => {
    const same = { overrides: [{ role: "teacher", menu: "ecs", access: "scoped" }], userOverrides: [] };
    expect(diffSettingsSection("permissions", same, JSON.parse(JSON.stringify(same)))).toEqual({
      changes: [],
      others: 0,
    });
  });

  it("상한을 넘으면 나머지는 개수로만(metadata 폭주 방지)", () => {
    const menus = [
      "students", "classes", "billing", "staff", "exams", "meetings",
      "documents", "calendar", "shuttle", "approvals", "timetable", "attendance", "ecs",
    ];
    const d = diffSettingsSection(
      "permissions",
      { overrides: [], userOverrides: [] },
      { overrides: menus.map((menu) => ({ role: "teacher", menu, access: "readonly" })), userOverrides: [] },
    );
    expect(d.changes).toHaveLength(MAX_CHANGES);
    expect(d.others).toBe(menus.length - MAX_CHANGES);
  });
});

describe("formatSettingChange", () => {
  it("이전 → 이후", () => {
    expect(formatSettingChange({ label: "납부일", from: "10", to: "5" })).toBe("납부일 10 → 5");
  });
  it("주석만 있으면 라벨 + 주석", () => {
    expect(formatSettingChange({ label: "과목", note: "내용 변경" })).toBe("과목 내용 변경");
  });
  it("둘 다 있으면 함께", () => {
    expect(formatSettingChange({ label: "과목", from: "2개", to: "3개", note: "추가 과학" })).toBe(
      "과목 2개 → 3개, 추가 과학",
    );
  });
});
