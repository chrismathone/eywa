import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DUPLICATE_REASON_LABEL,
  autoSuffixKey,
  duplicateReasons,
  groupDuplicateCandidates,
  loneSuspects,
  stripAutoSuffix,
  suspectReason,
  type DuplicateInput,
} from "./duplicate-candidates";

function student(over: Partial<DuplicateInput> & { id: string; name: string }): DuplicateInput {
  return { grade: null, school: null, parentPhone: null, ...over };
}

describe("stripAutoSuffix — 동기화가 붙인 알파벳 접미사만 뗀다", () => {
  it("대문자 꼬리를 뗀다(엑셀 열 방식 A·B·…·AA)", () => {
    expect(stripAutoSuffix("권민서B")).toBe("권민서");
    expect(stripAutoSuffix("이지호AB")).toBe("이지호");
    expect(stripAutoSuffix(" 김민서G ")).toBe("김민서");
  });
  it("🔴 소문자는 이름의 일부라 건드리지 않는다", () => {
    expect(stripAutoSuffix("jane")).toBe("jane");
    expect(stripAutoSuffix("Florence")).toBe("Florence");
  });
  it("접미사가 없으면 그대로", () => {
    expect(stripAutoSuffix("권민서")).toBe("권민서");
  });
  it("⚠️ 전부 대문자면 원문을 돌려준다 — 이름을 빈 문자열로 만들지 않는다", () => {
    expect(stripAutoSuffix("ABC")).toBe("ABC");
  });
  it("키는 DB name_normalized와 같은 정규화를 거친다(공백 제거·소문자)", () => {
    expect(autoSuffixKey(" 권 민 서 B ")).toBe("권민서");
  });
});

describe("duplicateReasons — 무엇이 같아서 후보인가", () => {
  const a = student({
    id: "a",
    name: "김수아",
    grade: "초6",
    school: "수창초",
    parentPhone: "010-1234-5678",
  });

  it("(a) 이름·학년·학교가 같으면 자연키 근거", () => {
    const b = student({ id: "b", name: "김수아", grade: "초6", school: "수창초" });
    expect(duplicateReasons(a, b)).toContain("natural_key");
  });

  it("(b) 이름·학년이 같고 학부모 연락처가 같으면(표기 달라도 숫자만 비교) 연락처 근거", () => {
    const b = student({
      id: "b",
      name: "김수아",
      grade: "초6",
      school: "산격중",
      parentPhone: "01012345678",
    });
    expect(duplicateReasons(a, b)).toEqual(["parent_phone"]);
  });

  it("(b) 보호자2 연락처(s2_0022)가 상대의 보호자1·보호자2 번호와 겹쳐도 연락처 근거 — 한 집의 두 보호자", () => {
    const mom = student({ id: "b", name: "김수아", grade: "초6", school: "산격중", parentPhone: "010-9999-0000", parent2Phone: "010-1234-5678" });
    expect(duplicateReasons(a, mom)).toEqual(["parent_phone"]);
    expect(duplicateReasons(mom, a)).toEqual(["parent_phone"]);
    const both2 = student({ id: "c", name: "김수아", grade: "초6", school: "칠성초", parentPhone: null, parent2Phone: "010 9999 0000" });
    expect(duplicateReasons(mom, both2)).toEqual(["parent_phone"]);
    // 번호가 하나도 안 겹치면 근거가 아니다(빈 보호자2는 겹침으로 치지 않는다)
    const other = student({ id: "d", name: "김수아", grade: "초6", school: "산격중", parentPhone: "010-5555-6666", parent2Phone: "" });
    expect(duplicateReasons(a, other)).toEqual([]);
  });

  it("이름이 같아도 학년이 다르면 근거가 없다", () => {
    const b = student({
      id: "b",
      name: "김수아",
      grade: "중1",
      school: "수창초",
      parentPhone: "010-1234-5678",
    });
    expect(duplicateReasons(a, b)).toEqual([]);
  });

  it("연락처가 둘 다 비어 있으면 '같은 연락처'가 아니다", () => {
    const x = student({ id: "x", name: "김수아", grade: "초6", school: "수창초" });
    const y = student({ id: "y", name: "김수아", grade: "초6", school: "산격중" });
    expect(duplicateReasons(x, y)).toEqual([]);
  });
});

describe("(c) 접미사 신호 — 원장 제보 2026-09-10 '중복 병합으로 합칠 곳이 없음'", () => {
  // 실데이터(injaewon 2026-09-10): 동기화가 `권민서` → `권민서A` → `권민서B`로 갈라 놓았고
  // 학년·학교·학부모 연락처가 전부 같은데도 후보가 0건이었다.
  const gwonA = student({
    id: "A",
    name: "권민서A",
    grade: "초6",
    school: "칠성초",
    parentPhone: "010-0000-9104",
  });
  const gwonB = student({
    id: "B",
    name: "권민서B",
    grade: "초6",
    school: "칠성초",
    parentPhone: "010-0000-9104",
    dupSuspect: true,
  });

  it("🔴 접미사만 다른 짝은 후보다(옛 두 신호로는 영원히 못 잡던 쌍)", () => {
    const groups = groupDuplicateCandidates([gwonA, gwonB]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.students.map((s) => s.id)).toEqual(["A", "B"]);
    expect(groups[0]!.reasons).toContain("auto_suffix");
  });

  it("근거는 접미사 하나로 끝내지 않는다 — 학년·학교·연락처 일치도 함께 적는다", () => {
    const groups = groupDuplicateCandidates([gwonA, gwonB]);
    expect(groups[0]!.reasons).toEqual(["natural_key", "parent_phone", "auto_suffix"]);
    for (const r of groups[0]!.reasons) expect(DUPLICATE_REASON_LABEL[r]).toMatch(/[가-힣]/);
  });

  it("🔴 '정상 확인'(dup_suspect 해제)한 짝은 후보에서 빠진다 — 매번 다시 뜨지 않는다", () => {
    const cleared = { ...gwonB, dupSuspect: false };
    expect(groupDuplicateCandidates([gwonA, cleared])).toEqual([]);
  });

  it("🔴 진짜 동명이인(학교·학년이 다른 접미사 쌍)은 후보가 아니다 — 영구 노이즈 금지", () => {
    // 실측 17개 접미사 그룹 중 16개가 이 모양이다(`김나연` 중3 침산중 vs `김나연A` 초4 달성초).
    const rows = [
      student({ id: "n1", name: "김나연", grade: "중3", school: "침산중", parentPhone: "010-0000-9110" }),
      student({ id: "n2", name: "김나연A", grade: "초4", school: "달성초", parentPhone: "010-0000-9107" }),
      student({ id: "j1", name: "이지호", grade: "초5", school: "칠성초" }),
      student({ id: "j2", name: "이지호A", grade: "초4", school: "옥산초" }),
      student({ id: "j3", name: "이지호B", grade: "중1", school: "달성초" }),
    ];
    expect(groupDuplicateCandidates(rows)).toEqual([]);
  });

  it("표식이 살아 있으면 학년·학교가 달라도 후보로 올린다 — 배너가 가리키는 화면이 비면 안 된다", () => {
    // 동기화의 충돌은 **이름만** 보고 일어난다(uniqueName). 그래서 (c)도 이름만 본다 — 근거가 약한 건
    // 화면에 그대로 적고(접미사만 다름) 사람이 '정상 확인'으로 내린다.
    const groups = groupDuplicateCandidates([
      student({ id: "p", name: "홍길동", grade: "초5", school: "칠성초" }),
      student({ id: "q", name: "홍길동A", grade: "중1", school: "침산중", dupSuspect: true }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.reasons).toEqual(["auto_suffix"]);
  });

  it("🔴 이름이 글자까지 같은 무리는 (c)로 묶지 않는다 — 그건 '같은 이름' 섹션의 몫", () => {
    const rows = [
      student({ id: "s1", name: "이지호A", grade: "초4", school: "옥산초", dupSuspect: true }),
      student({ id: "s2", name: "이지호A", grade: "초1", school: "달성초" }),
    ];
    expect(groupDuplicateCandidates(rows)).toEqual([]);
  });

  it("접미사가 붙어도 이름 무리에 표식이 하나도 없으면 안 잡는다", () => {
    const rows = [
      student({ id: "x", name: "권민서A", grade: "초6", school: "칠성초" }),
      student({ id: "y", name: "권민서B", grade: "초6", school: "칠성초" }),
    ];
    expect(groupDuplicateCandidates(rows)).toEqual([]);
  });
});

describe("짝 없는 '의심' · 왜 의심인지(원장 2026-10-14 — 데이터 정리에서 계속 정리)", () => {
  it("왜 의심인지 한 줄 — 🔴 붙인 글자를 단정하지 않는다(원래 이름이 대문자로 끝날 수 있다)", () => {
    expect(suspectReason("권민서B")).toBe("동기화 때 같은 이름이 이미 있어 끝에 알파벳을 붙여 따로 등록");
    expect(suspectReason("김민서GA")).toBe("동기화 때 같은 이름이 이미 있어 끝에 알파벳을 붙여 따로 등록");
  });
  it("끝이 알파벳이 아니면(이름을 고쳤다) 지어내지 않는다", () => {
    expect(suspectReason("권민서")).toBe("동기화 때 같은 이름이 이미 있어 따로 등록");
  });
  it("표식이 살아 있는데 어느 그룹에도 안 든 학생만 — 짝이 퇴원해 목록에 없어도 남는다", () => {
    const rows = [
      student({ id: "x", name: "권민서A", grade: "중2", dupSuspect: true }), // 짝 권민서B와 그룹
      student({ id: "y", name: "권민서B", grade: "중2", dupSuspect: true }),
      student({ id: "z", name: "이지호B", grade: "중1", dupSuspect: true }), // 짝 이지호A는 퇴원(목록 밖)
      student({ id: "w", name: "박하늘", grade: "중1" }), // 표식 없음
    ];
    const groups = groupDuplicateCandidates(rows);
    expect(groups.map((g) => g.students.map((s) => s.id))).toEqual([["x", "y"]]);
    expect(loneSuspects(rows, groups).map((s) => s.id)).toEqual(["z"]);
  });
});

describe("groupDuplicateCandidates — 묶기·정렬", () => {
  it("혼자면 그룹이 아니다", () => {
    expect(groupDuplicateCandidates([student({ id: "a", name: "이지호" })])).toEqual([]);
  });

  it("신호로 이어진 셋은 한 덩어리(union-find)", () => {
    const rows = [
      student({ id: "a", name: "김수아", grade: "초6", school: "수창초", parentPhone: "010-1111-2222" }),
      student({ id: "b", name: "김수아", grade: "초6", school: "수창초" }),
      student({ id: "c", name: "김수아", grade: "초6", school: "산격중", parentPhone: "01011112222" }),
    ];
    const groups = groupDuplicateCandidates(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.students.map((s) => s.id).sort()).toEqual(["a", "b", "c"]);
    expect(groups[0]!.reasons).toEqual(["natural_key", "parent_phone"]);
  });

  it("보호자2 번호(s2_0022)로도 묶는다 — 한쪽은 아버지 번호만, 다른 쪽은 보호자2에 같은 번호", () => {
    const rows = [
      student({ id: "a", name: "한별", grade: "초5", school: "칠성초", parentPhone: "010-2222-3333" }),
      student({ id: "b", name: "한별", grade: "초5", school: "산격초", parentPhone: "010-4444-5555", parent2Phone: "01022223333" }),
    ];
    const groups = groupDuplicateCandidates(rows);
    expect(groups.map((g) => g.students.map((s) => s.id))).toEqual([["a", "b"]]);
    expect(groups[0]!.reasons).toEqual(["parent_phone"]);
  });

  it("정렬은 이름→id로 고정 — 조회 순서가 흔들려도 페이지가 안 들썩인다", () => {
    const rows = [
      student({ id: "z2", name: "이지호", grade: "초4", school: "옥산초" }),
      student({ id: "z1", name: "이지호", grade: "초4", school: "옥산초" }),
      student({ id: "b2", name: "강민수", grade: "중1", school: "산격중" }),
      student({ id: "b1", name: "강민수", grade: "중1", school: "산격중" }),
    ];
    const groups = groupDuplicateCandidates(rows);
    expect(groups.map((g) => g.students[0]!.name)).toEqual(["강민수", "이지호"]);
    expect(groups[1]!.students.map((s) => s.id)).toEqual(["z1", "z2"]);
    expect(groupDuplicateCandidates([...rows].reverse())).toEqual(groups);
  });

  it("이름이 공백뿐인 행은 (c)의 판정 대상이 아니다", () => {
    expect(
      groupDuplicateCandidates([
        student({ id: "a", name: "  ", dupSuspect: true }),
        student({ id: "b", name: " " }),
      ]),
    ).toHaveLength(1); // 이름이 같아 (a) 신호로는 잡히지만, (c)가 빈 키로 엮은 것은 아니다
  });
});

describe("🔴 자동 병합 없음 — 후보 판정은 아무것도 쓰지 않는다", () => {
  const root = path.join(process.cwd(), "src", "features", "admin");
  /** 주석은 규칙을 설명하는 자리라 스캔에서 뺀다(설명에 적힌 이름이 위반으로 잡히면 가드가 아니다). */
  const codeOf = (file: string): string =>
    fs
      .readFileSync(file, "utf8")
      .split("\n")
      .map((line) => {
        const t = line.trimStart();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return "";
        const i = line.indexOf("//");
        return i === -1 ? line : line.slice(0, i);
      })
      .join("\n");

  it("판정 모듈은 순수하다(DB 접근·쓰기 0)", () => {
    const src = codeOf(path.join(root, "duplicate-candidates.ts"));
    for (const forbidden of ["supabase", "createClient", ".update(", ".insert(", ".delete("]) {
      expect(src.includes(forbidden), `순수 모듈에 ${forbidden} 금지`).toBe(false);
    }
  });

  it("후보 조회(findDuplicateStudents)는 읽기만 하고 병합을 부르지 않는다", () => {
    const src = codeOf(path.join(root, "server", "queries.ts"));
    expect(src.includes("mergeStudents"), "조회가 병합을 부르면 자동 병합이다").toBe(false);
    for (const forbidden of [".update(", ".insert(", ".delete(", ".upsert("]) {
      expect(src.includes(forbidden), `조회 모듈에 ${forbidden} 금지`).toBe(false);
    }
  });

  it("병합은 사람이 누르는 서버 액션 하나뿐이고 감사로그를 남긴다", () => {
    const src = fs.readFileSync(path.join(root, "server", "actions.ts"), "utf8");
    expect(src).toContain("export async function mergeStudents");
    expect(src).toContain('action: "student_merge"');
    // 살아남은 쪽 표식 해제 — 병합 직후 배너가 다시 빈 화면을 가리키지 않게(원장 제보 재현 방지).
    // 2026-10-22 코드 변경에 맞춤: 2186c9ac4가 메이크에듀 번호 받기를 같은 문장에 얹어(`...(makeeduCarry…)`) 한 줄 모양이
    // 바뀌었다. 지키는 뜻은 그대로 — `dup_suspect: false`가 **조건 없이 맨 앞 키**이고 그 문장이 남길 쪽(keeperId)을 고른다.
    // (진 쪽 퇴원 문장도 dup_suspect: false를 갖지만 맨 앞 키가 status라 여기 걸리지 않는다.) 동작은 actions.test.ts가 확인한다.
    expect(src).toMatch(/\.update\(\{ dup_suspect: false[,\s][^;]*?\}\)\s*\.eq\("id", keeperId\)/);
  });
});
