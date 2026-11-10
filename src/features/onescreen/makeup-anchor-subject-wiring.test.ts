import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// 원스크린 화면 + 옮겨 낸 훅(P3-O)을 한 덩어리로 읽는다 — 화면에서 코드를 옮겨도 같은 단언이 선다.
import { readOnescreenScreen } from "./components/onescreen-screen-source.test-util";

/**
 * 보강 추가의 반 필터 앵커는 과목 **키**로 거른다 — 원장 제보 2026-09-14(권영준·이수진).
 * `TodayClass.subject`는 표시 라벨("수학")이라 보강 줄의 `subjectKey`("math")와 비교하면 늘 거짓이 되고,
 * 반 칩을 고른 채 보강 학생을 추가하면 보강 줄이 0개 → 저장이 "보강 날짜와 과목을 확인해 주세요"로 막혔다.
 */
const root = join(__dirname);
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

describe("보강 앵커 과목 = 키(라벨 아님)", () => {
  it("서버가 오늘 반 목록에 과목 키를 싣는다", () => {
    const roster = read("server/roster.ts");
    expect(roster).toMatch(/subjectKey:\s*string;/);
    expect(roster).toMatch(/subjectKey:\s*c\.subject\s*\?\?\s*""/);
  });

  it("보강 추가가 앵커 과목을 subjectKey로 잡고, 라벨(subject)로 거르지 않는다", () => {
    const client = readOnescreenScreen();
    expect(client).toMatch(/const anchorSubject = matchingClasses\.length === 1 \? matchingClasses\[0\]!\.subjectKey/);
    expect(client).not.toMatch(/const anchorSubject = matchingClasses\.length === 1 \? matchingClasses\[0\]!\.subject :/);
  });
});
