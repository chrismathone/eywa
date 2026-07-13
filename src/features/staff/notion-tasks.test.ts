import { describe, it, expect } from "vitest";
import {
  parseNotionTaskPage,
  groupTasksByDate,
  humanizeNotionError,
  NOTION_TASK_PROPS,
  type NotionPage,
  type NotionTask,
} from "./notion-tasks";

const page = (props: Record<string, unknown>, extra: Partial<NotionPage> = {}): NotionPage => ({
  id: "p1",
  url: "https://notion.so/p1",
  properties: props as NotionPage["properties"],
  ...extra,
});

describe("parseNotionTaskPage", () => {
  it("제목은 type==='title' 속성에서 이름과 무관하게 추출", () => {
    const t = parseNotionTaskPage(
      page({
        "아무이름": { type: "title", title: [{ plain_text: "전단지 배부" }, { plain_text: " (경명여중)" }] },
        [NOTION_TASK_PROPS.due]: { type: "date", date: { start: "2026-07-02" } },
        [NOTION_TASK_PROPS.done]: { type: "checkbox", checkbox: true },
        [NOTION_TASK_PROPS.dept]: { type: "select", select: { name: "개발팀" } },
      }),
    );
    expect(t).toEqual<NotionTask>({
      id: "p1",
      title: "전단지 배부 (경명여중)",
      due: "2026-07-02",
      done: true,
      dept: "개발팀",
      url: "https://notion.so/p1",
    });
  });

  it("마감일이 날짜+시각이어도 앞 10자(YYYY-MM-DD)만", () => {
    const t = parseNotionTaskPage(
      page({ 제목: { type: "title", title: [{ plain_text: "회의" }] }, [NOTION_TASK_PROPS.due]: { type: "date", date: { start: "2026-07-08T09:00:00.000+09:00" } } }),
    );
    expect(t.due).toBe("2026-07-08");
  });

  it("빈 값 방어 — 제목 없음/마감 없음/미완료/부서 없음", () => {
    const t = parseNotionTaskPage(page({ [NOTION_TASK_PROPS.due]: { type: "date", date: null } }));
    expect(t).toMatchObject({ title: "(제목 없음)", due: null, done: false, dept: null });
  });

  it("부서가 rich_text여도 읽는다", () => {
    const t = parseNotionTaskPage(
      page({ 제목: { type: "title", title: [{ plain_text: "x" }] }, [NOTION_TASK_PROPS.dept]: { type: "rich_text", rich_text: [{ plain_text: "영어과" }] } }),
    );
    expect(t.dept).toBe("영어과");
  });

  it("부서가 formula(문자)면 그 문자열을 읽는다 (실 DB 형태)", () => {
    const t = parseNotionTaskPage(
      page({ 제목: { type: "title", title: [{ plain_text: "x" }] }, [NOTION_TASK_PROPS.dept]: { type: "formula", formula: { string: "회계/경리" } } }),
    );
    expect(t.dept).toBe("회계/경리");
  });
});

describe("groupTasksByDate", () => {
  it("마감일별로 묶고, 마감일 없는 항목은 제외", () => {
    const tasks: NotionTask[] = [
      { id: "a", title: "A", due: "2026-07-02", done: false, dept: null, url: null },
      { id: "b", title: "B", due: "2026-07-02", done: true, dept: null, url: null },
      { id: "c", title: "C", due: "2026-07-05", done: false, dept: null, url: null },
      { id: "d", title: "D", due: null, done: false, dept: null, url: null },
    ];
    const g = groupTasksByDate(tasks);
    expect(g["2026-07-02"]).toHaveLength(2);
    expect(g["2026-07-05"]).toHaveLength(1);
    expect(Object.keys(g)).toHaveLength(2); // due=null 제외
  });
});

describe("humanizeNotionError — raw 노출 금지", () => {
  it("토큰/DB/속성/레이트/네트워크를 한글로", () => {
    expect(humanizeNotionError("API token is invalid (401 unauthorized)")).toMatch(/토큰/);
    expect(humanizeNotionError("object_not_found: Could not find database")).toMatch(/DB/);
    expect(humanizeNotionError("body failed validation: 마감일 is not a property")).toMatch(/속성/);
    expect(humanizeNotionError("rate_limited (429)")).toMatch(/잠시 후/);
    expect(humanizeNotionError("fetch failed ETIMEDOUT")).toMatch(/연결/);
    expect(humanizeNotionError("")).toMatch(/불러오지 못/);
  });
});
