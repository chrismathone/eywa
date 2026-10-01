import { describe, expect, it } from "vitest";
import {
  ARCHIVED_NAME_MAX_TRIES,
  FREE_CLOSED_NAME_FIELDS,
  archivedClassNameBase,
  archivedClassNameCandidates,
  canFreeClassName,
  classNameConflictHint,
  classNameHolderStatus,
  postgrestQuoted,
  duplicateClassNameMessage,
  isUniqueViolation,
  pickArchivedClassName,
  readFreeClosedNameRequest,
  strongestClassNameHolder,
} from "./class-name-conflict";

const TODAY = "2026-10-01";
const h = (id: string, isActive: boolean, closedAt: string | null) => ({ id, isActive, closedAt });

describe("반 이름 충돌 — 그 반의 상태", () => {
  it("종강일이 오늘 이전·당일이면 종강 처리된 반(종강은 is_active를 켠 채 둔다)", () => {
    expect(classNameHolderStatus(h("a", true, "2026-07-02"), TODAY)).toBe("closed");
    expect(classNameHolderStatus(h("a", true, TODAY), TODAY)).toBe("closed");
    expect(classNameHolderStatus(h("a", false, "2026-07-02"), TODAY)).toBe("closed");
  });

  it("폐지(is_active=false)인데 종강일이 없으면 폐지된 반", () => {
    expect(classNameHolderStatus(h("a", false, null), TODAY)).toBe("archived");
  });

  it("종강 예정(종강일이 아직 안 옴)인 활성 반은 운영 중 — 아직 수업한다", () => {
    expect(classNameHolderStatus(h("a", true, "2026-12-31"), TODAY)).toBe("operating");
    expect(classNameHolderStatus(h("a", true, null), TODAY)).toBe("operating");
  });

  it("여럿이면 가장 강한 것(운영 중 > 종강 > 폐지)으로 말한다", () => {
    const list = [h("x", false, null), h("y", true, "2026-07-02"), h("z", true, null)];
    expect(strongestClassNameHolder(list, TODAY)).toEqual({ holder: list[2], status: "operating" });
    expect(strongestClassNameHolder(list.slice(0, 2), TODAY)?.status).toBe("closed");
    expect(strongestClassNameHolder([], TODAY)).toBeNull();
  });

  it("문구 = '같은 과목에 중복되는 반 이름이 있습니다. (상태)' — 운영 중인 반은 비워 주지 않는다", () => {
    expect(duplicateClassNameMessage("closed")).toBe("같은 과목에 중복되는 반 이름이 있습니다. (종강 처리된 반)");
    expect(duplicateClassNameMessage("archived")).toBe("같은 과목에 중복되는 반 이름이 있습니다. (폐지된 반)");
    expect(duplicateClassNameMessage("operating")).toBe("같은 과목에 중복되는 반 이름이 있습니다. (운영 중인 반)");
    expect(canFreeClassName("operating")).toBe(false);
    expect(canFreeClassName("closed")).toBe(true);
    expect(canFreeClassName("archived")).toBe(true);
  });
});

describe("반 이름 충돌 — 비울 때 붙이는 이름", () => {
  it("종강월 접미사 — 손으로 하던 스크립트와 같은 모양(PJ2 → PJ2 (~2026-07))", () => {
    expect(archivedClassNameBase("PL5", "2026-07-02")).toBe("PL5 (~2026-07)");
    // 종강일이 없는 폐지 반은 스크립트 규칙 그대로 '(~종강)'
    expect(archivedClassNameBase("PL5", null)).toBe("PL5 (~종강)");
  });

  it("접미사 이름까지 있으면 ' 2', ' 3' … — 겹치지 않는 첫 이름", () => {
    expect(pickArchivedClassName("PL5", "2026-07-02", [])).toBe("PL5 (~2026-07)");
    expect(pickArchivedClassName("PL5", "2026-07-02", ["PL5 (~2026-07)"])).toBe("PL5 (~2026-07) 2");
    expect(pickArchivedClassName("PL5", "2026-07-02", ["PL5 (~2026-07)", "PL5 (~2026-07) 2"])).toBe("PL5 (~2026-07) 3");
  });

  it("후보가 바닥나면 null — 사람이 정한다(버튼을 주지 않는다)", () => {
    const all = archivedClassNameCandidates("PL5", "2026-07-02");
    expect(all).toHaveLength(ARCHIVED_NAME_MAX_TRIES);
    expect(new Set(all).size).toBe(all.length);
    expect(pickArchivedClassName("PL5", "2026-07-02", all)).toBeNull();
  });

  it("공백이 섞인 이름도 DB 트리거와 같은 정규화를 거친 모양으로 만든다", () => {
    expect(archivedClassNameBase("중등M 개별 BS3R", "2026-08-31")).toBe("중등M 개별 BS3R (~2026-08)");
  });
});

describe("반 이름 충돌 — 버튼이 없을 때의 안내", () => {
  it("운영 중이거나 버튼이 있으면 안내 없음", () => {
    expect(classNameConflictHint({ status: "operating", freeTo: null, allowFree: true })).toBeNull();
    expect(classNameConflictHint({ status: "closed", freeTo: "PL5 (~2026-07)", allowFree: true })).toBeNull();
  });

  it("권한이 없으면 관리자에게, 권한은 있는데 새 이름을 못 정했으면 직접 바꾸라고 — 관리자에게 '관리자에게 요청'을 띄우지 않는다", () => {
    expect(classNameConflictHint({ status: "closed", freeTo: null, allowFree: false })).toContain("관리자에게 요청");
    const own = classNameConflictHint({ status: "archived", freeTo: null, allowFree: true });
    expect(own).toContain("직접 바꾼 뒤");
    expect(own).not.toContain("관리자에게");
  });
});

describe("PostgREST or() 값 인용", () => {
  it("괄호·쉼표가 든 반 이름을 큰따옴표로 감싸고 \\·\"를 이스케이프", () => {
    expect(postgrestQuoted("PL5 (~2026-07)")).toBe('"PL5 (~2026-07)"');
    expect(postgrestQuoted('A"B\\C')).toBe('"A\\"B\\\\C"');
  });
});

describe("반 이름 충돌 — 유니크 위반 판정은 오류 코드로만", () => {
  it("23505만 유니크 위반 — 문구는 보지 않는다", () => {
    expect(isUniqueViolation({ code: "23505", message: "x" })).toBe(true);
    expect(isUniqueViolation({ code: "23503", message: 'duplicate key value violates unique constraint "classes_tenant_name_subject_idx"' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
  });
});

describe("반 이름 충돌 — 비우기 요청은 버튼을 누른 것만", () => {
  const form = (entries: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(entries)) fd.set(k, v);
    return fd;
  };
  const full = {
    [FREE_CLOSED_NAME_FIELDS.flag]: "1",
    [FREE_CLOSED_NAME_FIELDS.name]: " PL5 ",
    [FREE_CLOSED_NAME_FIELDS.holderId]: "holder-1",
    [FREE_CLOSED_NAME_FIELDS.to]: "PL5  (~2026-07)",
  };

  it("플래그 + 이름 + 그 반 + 새 이름이 다 있어야 요청으로 본다(이름은 정규화)", () => {
    expect(readFreeClosedNameRequest(form(full))).toEqual({ name: "PL5", holderId: "holder-1", to: "PL5 (~2026-07)" });
  });

  it("플래그가 없거나 칸이 하나라도 비면 요청이 아니다", () => {
    expect(readFreeClosedNameRequest(form({ ...full, [FREE_CLOSED_NAME_FIELDS.flag]: "" }))).toBeNull();
    expect(readFreeClosedNameRequest(form({ ...full, [FREE_CLOSED_NAME_FIELDS.holderId]: "" }))).toBeNull();
    expect(readFreeClosedNameRequest(form({ ...full, [FREE_CLOSED_NAME_FIELDS.to]: " " }))).toBeNull();
    expect(readFreeClosedNameRequest(new FormData())).toBeNull();
  });
});
