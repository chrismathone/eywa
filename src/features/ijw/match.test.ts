import { describe, expect, it } from "vitest";
import {
  countNameKeys,
  hasHomonymSuffix,
  linkNameKey,
  suggestLinks,
  type LinkableEywaStudent,
  type UniqueGuard,
} from "./match";

const eywa = (
  id: string,
  name: string,
  ijwId: string | null = null,
  classNames: string[] = [],
): LinkableEywaStudent => ({ id, name, school: null, grade: null, ijwId, classNames });

/** 학원 전체 학생 이름(퇴원생 포함) → 유일성 판정 재료. */
const guardOf = (tenantNames: string[]): UniqueGuard => ({ eywaNameCounts: countNameKeys(tenantNames) });

describe("linkNameKey · hasHomonymSuffix", () => {
  it("공백·동명이인 접미(한글 끝 대문자 한 자)를 뗀다", () => {
    expect(linkNameKey(" 박 서연C ")).toBe("박서연");
  });
  it("🔴 로마자 이름은 통째로 지우지 않는다", () => {
    expect(linkNameKey("Kevin")).toBe("Kevin");
  });
  it("동명이인 접미 판별", () => {
    expect(hasHomonymSuffix("박서연B")).toBe(true);
    expect(hasHomonymSuffix("박서연")).toBe(false);
    expect(hasHomonymSuffix("Kevin")).toBe(false);
  });
  it("🔴 A~Z를 다 쓴 뒤의 숫자 접미(학원이2)도 동명이인 표식 — 로마자 이름 뒤 숫자는 아니다", () => {
    expect(linkNameKey("학원이2")).toBe("학원이");
    expect(linkNameKey("학원이12")).toBe("학원이");
    expect(hasHomonymSuffix("학원이2")).toBe(true);
    expect(linkNameKey("Kevin2")).toBe("Kevin2");
    expect(hasHomonymSuffix("Kevin2")).toBe(false);
  });
});

describe("suggestLinks", () => {
  it("이름이 양쪽 전체에서 유일하면 한 번에 연결 대상", () => {
    const r = suggestLinks(
      [{ ijwId: "u1", name: "공서연", className: "A반" }],
      [eywa("s1", "공서연")],
      guardOf(["공서연", "김민수"]),
    );
    expect(r[0]!.unique?.id).toBe("s1");
    expect(r[0]!.candidates[0]!.reason).toBe("name");
  });

  it("🔴 유일성 재료가 없으면 한 번에 잇지 않는다(fail-closed)", () => {
    const r = suggestLinks([{ ijwId: "u1", name: "공서연", className: null }], [eywa("s1", "공서연")]);
    expect(r[0]!.unique).toBeNull();
    expect(r[0]!.candidates.map((c) => c.id)).toEqual(["s1"]); // 제안은 그대로
  });

  it("🔴 퇴원한 동명이인이 학원에 남아 있으면(후보 모집단 밖이어도) 고르지 않는다", () => {
    // 모집단 = 지금 영어 반 학생 1명뿐, 학원 전체엔 8월에 그만둔 같은 이름이 있다.
    const r = suggestLinks(
      [{ ijwId: "old-kmj", name: "김민준", className: "A반" }],
      [eywa("s-new", "김민준")],
      guardOf(["김민준", "김민준"]),
    );
    expect(r[0]!.unique).toBeNull();
  });

  it("🔴 동명이인 접미가 붙은 이름은 전체에서 하나여도 고르지 않는다", () => {
    const r = suggestLinks(
      [{ ijwId: "u1", name: "박서연", className: null }],
      [eywa("s2", "박서연B")],
      guardOf(["박서연B"]),
    );
    expect(r[0]!.unique).toBeNull();
    expect(r[0]!.candidates[0]!.id).toBe("s2");
  });

  it("🔴 인재원에 짝이 이미 걸린 동명 계정이 있으면 고르지 않는다", () => {
    const r = suggestLinks(
      [
        { ijwId: "u-old", name: "김민준", className: "A반" }, // 이미 퇴원생에게 걸린 계정
        { ijwId: "u-new", name: "김민준", className: "B반" },
      ],
      [eywa("s-left", "김민준", "u-old"), eywa("s-new", "김민준")],
      guardOf(["김민준"]),
    );
    expect(r.map((x) => x.ijw.ijwId)).toEqual(["u-new"]);
    expect(r[0]!.unique).toBeNull();
  });

  it("🔴 eywa에 같은 이름이 둘이면 제안만 하고 고르지 않는다", () => {
    const r = suggestLinks(
      [{ ijwId: "u1", name: "박서연", className: null }],
      [eywa("s1", "박서연A"), eywa("s2", "박서연B")],
      guardOf(["박서연A", "박서연B"]),
    );
    expect(r[0]!.candidates.map((c) => c.id)).toEqual(["s1", "s2"]);
    expect(r[0]!.unique).toBeNull();
  });

  it("🔴 인재원에 같은 이름이 둘이어도 고르지 않는다(한 eywa 학생에 둘이 몰림)", () => {
    const r = suggestLinks(
      [
        { ijwId: "u1", name: "김민수", className: "A반" },
        { ijwId: "u2", name: "김민수", className: "B반" },
      ],
      [eywa("s1", "김민수")],
      guardOf(["김민수"]),
    );
    expect(r.every((x) => x.unique === null)).toBe(true);
  });

  it("이미 짝이 있는 인재원 학생은 목록에서 빠지고, 짝 있는 eywa 학생은 후보에서 빠진다", () => {
    const r = suggestLinks(
      [
        { ijwId: "u1", name: "공서연", className: null },
        { ijwId: "u2", name: "이윤", className: null },
      ],
      [eywa("s1", "공서연", "u1"), eywa("s2", "이윤", "u9")],
      guardOf(["공서연", "이윤"]),
    );
    expect(r.map((x) => x.ijw.ijwId)).toEqual(["u2"]);
    expect(r[0]!.candidates).toEqual([]);
  });

  it("이름 = 로그인 아이디(ijwgsy)면 머리글자로 후보를 찾고, 반 이름이 같으면 앞에 둔다", () => {
    const r = suggestLinks(
      [{ ijwId: "ijwgsy", name: "ijwgsy", className: "중등E_중2 정규 C" }],
      [eywa("s1", "김서윤", null, ["중등E_중1 정규 A"]), eywa("s2", "공서연", null, ["중등E_중2 정규 C"]), eywa("s3", "박민수")],
      guardOf(["김서윤", "공서연", "박민수"]),
    );
    expect(r[0]!.candidates.map((c) => [c.id, c.reason])).toEqual([
      ["s2", "id-class"],
      ["s1", "id"],
    ]);
    // 🔴 머리글자 후보는 겹칠 수 있어 '한 번에 연결' 대상이 아니다.
    expect(r[0]!.unique).toBeNull();
  });

  it("후보가 있는 학생을 목록 앞에 둔다", () => {
    const r = suggestLinks(
      [
        { ijwId: "ijwzzz", name: "ijwzzz", className: "A반" },
        { ijwId: "ijwgsy", name: "ijwgsy", className: "B반" },
      ],
      [eywa("s2", "공서연")],
    );
    expect(r.map((x) => x.ijw.ijwId)).toEqual(["ijwgsy", "ijwzzz"]);
  });
});
