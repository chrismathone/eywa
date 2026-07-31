import { describe, expect, it } from "vitest";
import { toggleSort } from "@/lib/table/sort";
import {
  DOCUMENT_SORT_KEYS,
  documentOrderSpecs,
  isDocumentSortKey,
  parseDocumentSort,
  type DocumentSort,
} from "./document-sort";

describe("parseDocumentSort", () => {
  it("URL 파라미터를 정렬 상태로 읽는다", () => {
    expect(parseDocumentSort("name", "asc")).toEqual({ key: "name", dir: "asc" });
    expect(parseDocumentSort("date", "desc")).toEqual({ key: "date", dir: "desc" });
  });

  it("dir이 없거나 이상하면 오름차순 — 3단 순환의 첫 단계와 같아야 한다", () => {
    expect(parseDocumentSort("size")).toEqual({ key: "size", dir: "asc" });
    expect(parseDocumentSort("size", "sideways")).toEqual({ key: "size", dir: "asc" });
  });

  it("모르는 열/빈 값은 정렬 없음 — 손으로 URL을 고쳐도 목록이 깨지지 않는다", () => {
    expect(parseDocumentSort(undefined, "asc")).toBeNull();
    expect(parseDocumentSort("", "asc")).toBeNull();
    expect(parseDocumentSort("category", "asc")).toBeNull(); // 의도적으로 안 여는 열
    expect(parseDocumentSort("type")).toBeNull();
    expect(parseDocumentSort("title; drop table")).toBeNull();
  });

  it("isDocumentSortKey는 열린 열만 통과시킨다", () => {
    expect(DOCUMENT_SORT_KEYS.every(isDocumentSortKey)).toBe(true);
    expect(isDocumentSortKey("category")).toBe(false);
  });
});

describe("documentOrderSpecs", () => {
  it("정렬 해제(기본)는 고정 먼저 → 최신순", () => {
    const specs = documentOrderSpecs(null);
    expect(specs[0]).toEqual({ column: "pinned", ascending: false, nullsFirst: false });
    expect(specs[1]?.column).toBe("created_at");
  });

  it("정렬을 누르면 고정 우선을 뗀다 — 안 떼면 '이름' 정렬인데 고정 행이 위에 남아 고장난 것처럼 보인다", () => {
    for (const key of DOCUMENT_SORT_KEYS) {
      const specs = documentOrderSpecs({ key, dir: "asc" });
      expect(specs.some((s) => s.column === "pinned"), `${key}에 pinned가 남아 있다`).toBe(false);
    }
  });

  it("모든 정렬은 유일값(id)으로 끝난다 — 없으면 동률 행이 페이지마다 뒤바뀌어 중복/누락된다", () => {
    for (const key of DOCUMENT_SORT_KEYS) {
      for (const dir of ["asc", "desc"] as const) {
        const specs = documentOrderSpecs({ key, dir });
        expect(specs.at(-1), `${key}/${dir}`).toEqual({ column: "id", ascending: false, nullsFirst: false });
      }
    }
  });

  it("정렬 키가 첫 order이고 방향이 반영된다", () => {
    expect(documentOrderSpecs({ key: "name", dir: "asc" })[0]).toEqual({
      column: "title",
      ascending: true,
      nullsFirst: false,
    });
    expect(documentOrderSpecs({ key: "name", dir: "desc" })[0]?.ascending).toBe(false);
    expect(documentOrderSpecs({ key: "size", dir: "asc" })[0]?.column).toBe("file_size");
    expect(documentOrderSpecs({ key: "date", dir: "asc" })[0]?.column).toBe("created_at");
  });

  it("빈 값은 방향과 무관하게 뒤로(nullsFirst=false) — '값 없음'이 맨 위로 오면 목록이 쓸모없다", () => {
    for (const key of DOCUMENT_SORT_KEYS) {
      for (const dir of ["asc", "desc"] as const) {
        expect(documentOrderSpecs({ key, dir }).every((s) => s.nullsFirst === false)).toBe(true);
      }
    }
  });

  it("등록자는 임베드 **별칭**으로 정렬한다 — 테이블명(users)은 PostgREST가 거부한다(2026-07-31 실측)", () => {
    expect(documentOrderSpecs({ key: "uploader", dir: "asc" })[0]?.column).toBe("uploader(display_name)");
  });

  it("등록일 정렬은 created_at을 tiebreak로 중복해서 넣지 않는다", () => {
    const cols = documentOrderSpecs({ key: "date", dir: "desc" }).map((s) => s.column);
    expect(cols.filter((c) => c === "created_at")).toHaveLength(1);
  });
});

describe("헤더 3단 순환 — 공용 규약(lib/table/sort)을 그대로 쓴다", () => {
  it("오름 → 내림 → 해제", () => {
    let s: DocumentSort = null;
    s = toggleSort(s, "name");
    expect(s).toEqual({ key: "name", dir: "asc" });
    s = toggleSort(s, "name");
    expect(s).toEqual({ key: "name", dir: "desc" });
    s = toggleSort(s, "name");
    expect(s).toBeNull(); // 해제 = 기본 순서(고정 먼저)로 돌아갈 길
  });

  it("다른 열을 누르면 그 열 오름차순부터", () => {
    expect(toggleSort({ key: "name", dir: "desc" }, "date")).toEqual({ key: "date", dir: "asc" });
  });
});
