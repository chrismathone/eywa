/**
 * 통합 탭 명단 파서 — 실측 모양으로 고정.
 *
 * 🔴 이 파서가 한 반을 놓치면 **그 반 전원이 종료 후보**가 된다(computeImportDiff는 시트를 그 과목
 *    전 수강의 진실로 본다). 그래서 검산(`인원` 칸 대조)이 안전벨트이고, 그 검산이 실제로 도는지를
 *    여기서 잠근다.
 * 🔴 교시 행(강사·강의실)이 학생으로 새는 것이 가장 흔한 오작동이다 — `Anna 605`가 명단에 들어가면
 *    매칭에서 조용히 빠지고, 진짜 학생 수와 시트 인원이 어긋난다.
 */
import { describe, expect, it } from "vitest";
import {
  classNameFromHeader,
  parseIntegratedRoster,
  splitSchoolGrade,
  stripNickname,
} from "./parse-roster";

describe("splitSchoolGrade", () => {
  it("학교 끝 글자가 학년 접두사다", () => {
    expect(splitSchoolGrade("침산초1")).toEqual({ school: "침산초", grade: "초1" });
    expect(splitSchoolGrade("경명여중1")).toEqual({ school: "경명여중", grade: "중1" });
    expect(splitSchoolGrade("마이스터고1")).toEqual({ school: "마이스터고", grade: "고1" });
    expect(splitSchoolGrade("칠성초3")).toEqual({ school: "칠성초", grade: "초3" });
  });

  it("모양이 아니면 학년을 지어내지 않는다", () => {
    expect(splitSchoolGrade("검정고시")).toEqual({ school: "검정고시", grade: null });
    expect(splitSchoolGrade("")).toEqual({ school: null, grade: null });
  });

  it("실업계처럼 끝 글자가 초·중·고가 아니면 학년은 비운다(실측 경북여상2)", () => {
    // DB는 `경북여상`/`고2`인데 `상`에서 `고`를 유도할 길이 없다 — 지어내면 없는 학년으로 매칭이 틀어진다.
    // 학년이 null이면 매칭은 이름+학교로만 좁힌다(그쪽이 정직하다).
    expect(splitSchoolGrade("경북여상2")).toEqual({ school: "경북여상", grade: null });
  });
});

describe("classNameFromHeader", () => {
  it("반 이름만 남긴다", () => {
    expect(classNameFromHeader("PL1a 매일 2:20~3:40 (Anna)")).toBe("PL1a");
    expect(classNameFromHeader("LT4 월수목 2:20~4:20 (Anna)")).toBe("LT4");
    expect(classNameFromHeader("중등E_초등 브릿지 A 화금 3:00~5:00 (Jane)")).toBe("중등E_초등 브릿지 A");
  });
});

describe("stripNickname", () => {
  it("영어 닉네임 괄호를 뗀다", () => {
    expect(stripNickname("김하윤C(Hanny)")).toBe("김하윤C");
    expect(stripNickname("이윤 (Justin)")).toBe("이윤");
    expect(stripNickname("이지호A")).toBe("이지호A");
  });
});

/** 실측 시트 모양을 최소로 재현한 격자(블록 2개, 5열 폭). */
function sheet(): string[][] {
  const W = 14;
  const row = (): string[] => Array.from({ length: W }, () => "");
  const g = Array.from({ length: 14 }, row);
  // 머리(앵커에만 글자) — c=2, c=7
  g[2]![2] = "PL1a 매일 2:20~3:40 (Anna)";
  g[2]![7] = "PL1b 매일 2:20~3:40 (Song)";
  // 요일 행
  g[5]![2] = "월";
  // 교시 행 — A열에 시각이 있다. B열 번호까지 있어서 이걸 안 거르면 학생이 된다.
  g[6]![0] = "2:20~3:00";
  g[6]![1] = "1";
  g[6]![2] = "Anna 602";
  g[6]![7] = "Sam";
  g[7]![0] = "3:00~3:40";
  g[7]![1] = "2";
  g[7]![2] = "LAB";
  g[7]![7] = "LAB";
  // 명단 — A열이 비어 있고 B열에 순번
  g[8]![1] = "1";
  g[8]![2] = "김하윤C(Hanny)";
  g[8]![5] = "침산초1";
  g[8]![7] = "신지민(Jenny)";
  g[8]![10] = "종로초2";
  g[9]![1] = "2";
  g[9]![2] = "박예지(Candy)";
  g[9]![5] = "칠성초2";
  // 정원 / 인원
  g[11]![1] = "정원";
  g[11]![2] = "8";
  g[11]![7] = "8";
  g[12]![1] = "인원";
  g[12]![2] = "2";
  g[12]![7] = "1";
  return g;
}

describe("parseIntegratedRoster", () => {
  const res = parseIntegratedRoster(sheet());

  it("블록마다 반 이름과 명단을 뽑는다", () => {
    expect(res.blocks.map((b) => b.className)).toEqual(["PL1a", "PL1b"]);
    expect(res.blocks[0]!.entries.map((e) => e.name)).toEqual(["김하윤C", "박예지"]);
    expect(res.blocks[1]!.entries.map((e) => e.name)).toEqual(["신지민"]);
  });

  it("교시 행(강사·강의실)을 학생으로 읽지 않는다", () => {
    const names = res.blocks.flatMap((b) => b.entries.map((e) => e.name));
    expect(names).not.toContain("Anna 602");
    expect(names).not.toContain("LAB");
    expect(names).not.toContain("Sam");
  });

  it("학교+학년을 블록 안 +3열에서 읽어 가른다", () => {
    expect(res.blocks[0]!.entries[0]).toMatchObject({ school: "침산초", grade: "초1" });
    expect(res.blocks[1]!.entries[0]).toMatchObject({ school: "종로초", grade: "초2" });
  });

  it("인원 칸과 일치하면 mismatch가 없다", () => {
    expect(res.mismatches).toEqual([]);
  });

  it("인원 칸과 어긋나면 잡아낸다(적용 중단 신호)", () => {
    const g = sheet();
    g[12]![2] = "5"; // 시트는 5명이라는데 파싱은 2명
    const bad = parseIntegratedRoster(g);
    expect(bad.mismatches).toEqual([{ className: "PL1a", parsed: 2, declared: 5 }]);
  });

  it("정원 행이 없는 머리는 명단 없음으로 건너뛴다", () => {
    const g = sheet();
    g[11]![1] = "";
    expect(parseIntegratedRoster(g).blocks).toEqual([]);
  });
});
