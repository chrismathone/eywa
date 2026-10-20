import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MERGE_NOTE_PREFIX,
  isMergedStudent,
  mergeNoteFor,
  preserveMergeNote,
} from "./merged";

const KEEPER = "11111111-1111-4111-8111-111111111111";

describe("isMergedStudent — 병합 표식은 메모 맨 앞의 접두사다", () => {
  it("mergeStudents가 쓴 메모를 알아본다", () => {
    expect(isMergedStudent(`${MERGE_NOTE_PREFIX} ${KEEPER}와 통합됨 (2026-09-13)`)).toBe(true);
  });

  it("메모가 없거나 비어 있으면 병합이 아니다", () => {
    for (const notes of [null, undefined, "", "   ", "\n"]) {
      expect(isMergedStudent(notes)).toBe(false);
    }
  });

  it("보통 메모는 병합이 아니다", () => {
    expect(isMergedStudent("셔틀 A노선 · 하원만 탑승")).toBe(false);
  });

  // 🔴 사람이 쓴 메모 **본문**에 같은 말이 들어갔다고 퇴원 집계에서 빼면 안 된다.
  it("본문 가운데 같은 말이 있어도 병합이 아니다", () => {
    expect(isMergedStudent("학부모 요청 — 중복 병합: 확인 요망")).toBe(false);
  });

  /**
   * 🔴 접두사만 보면 여기서 걸린다. 앱이 직접 *"같은 사람이면 관리자 **중복 병합**으로 합치세요"*
   *    (`dup-suspect-notice.tsx`)라고 안내하므로 데스크가 이런 메모를 실제로 쓴다 — 그러면 **진짜
   *    퇴원생이 퇴원관리·운영실에서 조용히 사라진다**(고치려던 버그의 역방향).
   */
  it("🔴 맨 앞이라도 '통합됨' 꼴이 아니면 병합이 아니다 — 사람이 쓴 메모를 삼키지 않는다", () => {
    expect(isMergedStudent("중복 병합: 확인 요망")).toBe(false);
    expect(isMergedStudent("중복 병합: 학부모에게 물어볼 것")).toBe(false);
  });

  /**
   * 🔴 **리터럴로 고정한다.** 다른 단정은 전부 `MERGE_NOTE_PREFIX`를 끼워 넣어서, 상수를 바꾸면 테스트는
   *    전부 초록인데 **이미 병합된 DB 행이 통째로 판정에서 빠진다**(merged.ts의 🔴 경고가 그것이다).
   *    이 줄만은 상수를 안 따라간다 — 과거 행의 실제 문자열을 그대로 적는다.
   */
  it("🔴 이미 쌓인 과거 표식(리터럴)을 그대로 알아본다", () => {
    expect(
      isMergedStudent("중복 병합: 11111111-1111-4111-8111-111111111111와 통합됨 (2026-09-13)"),
    ).toBe(true);
  });

  it("앞 공백·줄바꿈은 무시한다(맨 앞 판정은 유지)", () => {
    expect(isMergedStudent(`\n  ${MERGE_NOTE_PREFIX} ${KEEPER}와 통합됨 (2026-09-13)`)).toBe(true);
  });

});

describe("mergeNoteFor — 기존 메모를 지우지 않는다", () => {
  it("메모가 없으면 표식만 남는다", () => {
    expect(mergeNoteFor(KEEPER, "2026-09-13", null)).toBe(
      `${MERGE_NOTE_PREFIX} ${KEEPER}와 통합됨 (2026-09-13)`,
    );
  });

  // 🔴 종전엔 notes를 통째로 덮어써서 실제 메모(셔틀 안내 등)가 사라졌다.
  it("기존 메모를 보존한다", () => {
    const result = mergeNoteFor(KEEPER, "2026-09-13", "셔틀 A노선 · 하원만 탑승");
    expect(result).toContain("셔틀 A노선 · 하원만 탑승");
  });

  // 🔴 표식이 뒤로 가면 isMergedStudent가 못 잡아 그 학생이 다시 퇴원으로 세진다.
  it("표식이 **맨 앞**이라 판정이 그대로 산다", () => {
    const result = mergeNoteFor(KEEPER, "2026-09-13", "셔틀 A노선 · 하원만 탑승");
    expect(result.startsWith(MERGE_NOTE_PREFIX)).toBe(true);
    expect(isMergedStudent(result)).toBe(true);
  });

  it("두 번 병합되면 표식이 쌓이고 판정은 유지된다", () => {
    const once = mergeNoteFor(KEEPER, "2026-09-13", "메모");
    const twice = mergeNoteFor("22222222-2222-4222-8222-222222222222", "2026-09-20", once);
    expect(isMergedStudent(twice)).toBe(true);
    expect(twice).toContain("메모");
    expect(twice).toContain(KEEPER);
  });
});

/**
 * 🔴 메모 칸(`students.notes`)은 데스크가 자유롭게 고치는 자리인데 표식이 그 안에 같이 있다 —
 *    저장 한 번에 표식이 날아가면 그 학생이 집계에서 **퇴원으로 조용히 되살아난다**.
 */
describe("preserveMergeNote — 사람이 메모를 고쳐도 표식은 남는다", () => {
  const MARK = `${MERGE_NOTE_PREFIX} ${KEEPER}와 통합됨 (2026-09-13)`;

  it("표식을 지운 채 저장해도 서버가 다시 붙인다", () => {
    const result = preserveMergeNote(`${MARK}\n셔틀 A노선`, "셔틀 B노선");
    expect(isMergedStudent(result)).toBe(true);
    expect(result).toContain("셔틀 B노선");
    expect(result).not.toContain("셔틀 A노선"); // 사람이 고친 내용은 그대로 반영된다
  });

  it("메모를 통째로 비워도 표식은 남는다", () => {
    expect(isMergedStudent(preserveMergeNote(MARK, ""))).toBe(true);
    expect(isMergedStudent(preserveMergeNote(MARK, null))).toBe(true);
  });

  it("사람이 표식을 그대로 뒀으면 덧붙이지 않는다(중복 방지)", () => {
    const kept = `${MARK}\n새 메모`;
    expect(preserveMergeNote(`${MARK}\n옛 메모`, kept)).toBe(kept);
  });

  /** 🔴 메모 칸은 자유 텍스트라 사람이 표식 **위에** 쓸 수 있다 — 그때 표식이 한 줄씩 쌓이면 안 된다. */
  it("표식 위에 글을 써도 표식은 한 줄만 남는다", () => {
    const once = preserveMergeNote(`${MARK}\n메모`, `앞에 쓴 글\n${MARK}`);
    expect(once).toBe(`${MARK}\n앞에 쓴 글`);
    // 여러 번 저장해도 늘지 않는다(멱등).
    expect(preserveMergeNote(`${MARK}\n메모`, once)).toBe(once);
    expect((once!.match(/중복 병합:/g) ?? []).length).toBe(1);
  });

  it("줄바꿈이 CRLF여도 표식을 한 줄로 알아본다", () => {
    const result = preserveMergeNote(`${MARK}\r\n옛 메모`, `${MARK}\r\n새 메모`);
    expect((result!.match(/중복 병합:/g) ?? []).length).toBe(1);
    expect(result).toContain("새 메모");
  });

  /**
   * 🔑 **잘못 병합한 건을 푸는 유일한 손잡이.** 표식을 지우는 액션이 앱에 하나도 없어서, 상태를 되돌리는
   *    저장에서 놓아 주지 않으면 잘못 병합된 학생이 영원히 집계 밖에 남는다.
   */
  it("퇴원에서 되돌리는 저장이면 표식을 놓아 준다", () => {
    expect(preserveMergeNote(`${MARK}\n메모`, "메모", false)).toBe("메모");
    expect(isMergedStudent(preserveMergeNote(MARK, null, false))).toBe(false);
    // 퇴원인 채로 저장하면 종전대로 지켜낸다.
    expect(isMergedStudent(preserveMergeNote(MARK, "메모", true))).toBe(true);
  });

  it("병합된 학생이 아니면 들어온 값을 그대로 쓴다", () => {
    expect(preserveMergeNote(null, "그냥 메모")).toBe("그냥 메모");
    expect(preserveMergeNote("셔틀 A노선", "")).toBe("");
    expect(preserveMergeNote("셔틀 A노선", null)).toBe(null);
  });
});

/**
 * 🔴 표식이 **사람이 고치는 칸** 안에 살기 때문에, 쓰기 경로가 이 규칙을 지나는지를 소스로 잠근다.
 *    순수 함수만 맞아도 저장 경로가 안 거치면 아무 소용이 없다(#77과 같은 모양).
 */
describe("쓰기 경로 배선", () => {
  const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  it("학생 정보 수정은 메모를 저장할 때 표식을 지켜낸다", () => {
    const src = strip(read("src", "features", "students", "server", "actions.ts"));
    // 🔴 **수정 경로만** 본다 — 생성(`createStudent`)은 `notes: input.notes`가 맞다(새 학생은 병합될 수 없다).
    const from = src.indexOf("export async function updateStudent");
    expect(from).toBeGreaterThan(-1);
    const next = src.indexOf("export async function", from + 1);
    const update = src.slice(from, next === -1 ? undefined : next);
    expect(update).toContain("notes: preserveMergeNote(");
    // 판정 재료를 실제로 읽어야 한다 — select에서 빠지면 stored가 undefined라 표식이 조용히 날아간다.
    expect(update).toMatch(/select\("status, withdrawal_metadata, withdrawn_at, name, notes"\)/);
    // 맨 입력값을 그대로 쓰는 옛 경로가 이 함수에 남아 있으면 안 된다.
    expect(update).not.toContain("notes: input.notes");
  });

  it("병합은 기존 메모를 덮어쓰지 않는다", () => {
    const src = strip(read("src", "features", "admin", "server", "actions.ts"));
    expect(src).toContain("mergeNoteFor(keeperId, today,");
    expect(src).not.toMatch(/notes: `중복 병합/); // 옛 덮어쓰기 리터럴
  });
});
