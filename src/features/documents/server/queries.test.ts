import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  rows: [] as { id: number; category: string; staff_user_id: string | null }[],
  ranges: [] as [number, number][],
  failOffset: -1,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      expect(table).toBe("academy_documents");
      let visible = db.rows;
      const query = {
        select: () => query,
        is: (column: string, value: null) => {
          expect(column).toBe("staff_user_id");
          visible = visible.filter((row) => row.staff_user_id === value);
          return query;
        },
        order: () => query,
        range: async (from: number, to: number) => {
          db.ranges.push([from, to]);
          return from === db.failOffset
            ? { data: null, error: { message: "read failed" }, count: null }
            : {
                data: visible.slice(from, to + 1),
                error: null,
                count: visible.length,
              };
        },
      };
      return query;
    },
  }),
}));

import { getDocumentCategoryCounts, getDocumentsPage } from "./queries";

describe("문서 탐색기 집계 범위", () => {
  beforeEach(() => {
    db.rows = [];
    db.ranges = [];
    db.failOffset = -1;
  });

  it("직원 연결 문서를 제외해 전체 목록과 폴더 수가 일치한다", async () => {
    db.rows = [
      { id: 1, category: "hr", staff_user_id: "protected-staff" },
      { id: 2, category: "hr", staff_user_id: null },
      { id: 3, category: "class", staff_user_id: null },
    ];
    const counts = await getDocumentCategoryCounts();
    const page = await getDocumentsPage();
    expect(counts).toEqual({ all: 2, hr: 1, class: 1 });
    expect(page.total).toBe(counts?.all);
    expect(page.rows.map((row) => row.id)).toEqual([2, 3]);
  });

  it("37건은 20건씩 서버에서 나눠 읽는다", async () => {
    db.rows = Array.from({ length: 37 }, (_, id) => ({ id, category: "class", staff_user_id: null }));
    const first = await getDocumentsPage({}, 1, 20);
    const second = await getDocumentsPage({}, 2, 20);
    expect(db.ranges).toEqual([[0, 19], [20, 39]]);
    expect([first.rows.length, second.rows.length]).toEqual([20, 17]);
    expect(first.total).toBe(37);
    expect(second.total).toBe(37);
  });

  it("1000건 응답 상한을 넘어도 모든 공개 문서를 센다", async () => {
    db.rows = Array.from({ length: 1003 }, (_, id) => ({
      id,
      category: "class",
      staff_user_id: null,
    }));
    expect(await getDocumentCategoryCounts()).toEqual({
      all: 1003,
      class: 1003,
    });
    expect(db.ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("목록 조회가 실패하면 '0건'이 아니라 실패로 알린다(E6)", async () => {
    db.rows = [{ id: 1, category: "class", staff_user_id: null }];
    db.failOffset = 0;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const page = await getDocumentsPage({}, 1, 20);
      expect(page.failed).toBe(true);
      expect(page.rows).toEqual([]);
    } finally {
      log.mockRestore();
    }
  });

  it("다음 페이지가 실패하면 부분 합계나 0 대신 조회 실패를 반환한다", async () => {
    db.rows = Array.from({ length: 1003 }, (_, id) => ({
      id,
      category: "class",
      staff_user_id: null,
    }));
    db.failOffset = 1000;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await getDocumentCategoryCounts()).toBeNull();
    } finally {
      log.mockRestore();
    }
  });

  it("문서가 없으면 정상적인 0건이다", async () => {
    expect(await getDocumentCategoryCounts()).toEqual({ all: 0 });
  });
});
