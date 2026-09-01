import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 🔴 `<input type="file">`의 `e.target.files`는 **입력 요소에 매인 라이브 FileList**다.
 *    `e.target.value = ""`(같은 파일 재선택용 초기화)를 하는 순간 그 목록이 **함께 비워지므로**,
 *    FileList 참조를 그대로 들고 있다가 나중에 읽으면 **빈 목록**이 된다.
 *
 * 실제 사고(2026-09-01 실브라우저 재현): 학부모 공지 이미지 첨부가 **아무 반응이 없었다** —
 * 토스트도, 네트워크 요청도 0건. 서버·버킷·워커는 전부 정상이었고 원인은 이 두 줄의 순서뿐이었다.
 * 2026-07-22 기능이 생긴 날부터 **한 번도 동작한 적이 없다**(이미지가 붙은 공지 7건은 전부 교재요청
 * 자동 첨부·개발 테스트였다).
 *
 * 규칙: **꺼내기(복사) 먼저, 비우기 나중.** `Array.from(e.target.files ?? [])`이나 `files?.[0]`처럼
 * **값을 먼저 꺼내면** 안전하다(File 객체 자체는 살아 있다). 위험한 건 FileList 참조를 들고 있는 것뿐.
 */
describe("file input — value 초기화보다 파일 꺼내기가 먼저", () => {
  const repoFiles = () =>
    execSync('git ls-files "src/**/*.tsx"', { encoding: "utf8", cwd: process.cwd() })
      .split("\n")
      .filter(Boolean);

  it("🔴 `e.target.value = \"\"` 앞에서 파일을 꺼낸다(라이브 FileList를 들고 있지 않는다)", () => {
    const offenders: string[] = [];
    for (const rel of repoFiles()) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      if (!src.includes("target.value")) continue;
      // `const x = e.target.files;` (배열 복사·인덱스 접근이 아닌 **목록 그대로**) 뒤에 value 초기화가 오면 위험.
      const rawGrab = /const\s+\w+\s*=\s*\w+\.target\.files\s*;/.test(src);
      if (rawGrab) offenders.push(rel);
    }
    expect(offenders, "라이브 FileList를 그대로 들고 있다 — Array.from(...)으로 먼저 복사할 것").toEqual([]);
  });

  it("공지 첨부 피커가 그 규약을 지킨다", () => {
    const src = readFileSync(
      join(process.cwd(), "src/features/onescreen/components/notice-attachment-picker.tsx"),
      "utf8",
    );
    const copyAt = src.indexOf("Array.from(e.target.files");
    const clearAt = src.indexOf('e.target.value = ""');
    expect(copyAt).toBeGreaterThan(-1);
    expect(clearAt).toBeGreaterThan(-1);
    expect(copyAt, "복사가 초기화보다 먼저여야 한다").toBeLessThan(clearAt);
    // 첨부 함수는 FileList가 아니라 File[]을 받는다(잘못 넘길 수 없게 타입으로 막는다).
    expect(src).toContain("async function addFiles(picked: File[])");
  });
});
