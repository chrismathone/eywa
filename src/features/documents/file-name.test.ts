import { expect, it } from "vitest";
import { renamedFileName, splitFileName } from "./file-name";

it("이름의 점과 확장자를 구분하고 원본 확장자 대소문자를 보존한다", () => {
  expect(splitFileName("시험지.v2.PDF")).toEqual({ base: "시험지.v2", extension: ".PDF" });
  expect(renamedFileName("중간고사.v3", "시험지.PDF")).toEqual({ fileName: "중간고사.v3.PDF" });
  expect(renamedFileName("다른이름.exe", "시험지.pdf")).toEqual({ fileName: "다른이름.exe.pdf" });
});
it("빈 이름·경로 조작·확장자 없는 파일에 확장자 추가를 거부한다", () => {
  for (const base of ["", " ", ".", "..", "../파일", "C:\\파일", "파일?", "파일.", "a\u0000b"])
    expect(renamedFileName(base, "old.pdf")).toHaveProperty("error");
  expect(renamedFileName("새 문서", "문서")).toEqual({ fileName: "새 문서" });
  expect(renamedFileName("새 문서.exe", "문서")).toHaveProperty("error");
});
