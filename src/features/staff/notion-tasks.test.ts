import { describe, it, expect } from "vitest";
import {
  parseNotionTaskPage,
  groupTasksByDate,
  taskSpans,
  tasksOnDate,
  notionBlocksToLines,
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
      start: "2026-07-02", // 시작일 없으면 마감일과 동일
      due: "2026-07-02",
      done: true,
      dept: "개발팀",
      url: "https://notion.so/p1",
    });
  });

  it("시작일 속성이 있으면 기간 [시작일, 마감일]로 파싱", () => {
    const t = parseNotionTaskPage(
      page({
        제목: { type: "title", title: [{ plain_text: "직원명부 작성" }] },
        [NOTION_TASK_PROPS.start]: { type: "date", date: { start: "2026-06-29" } },
        [NOTION_TASK_PROPS.due]: { type: "date", date: { start: "2026-07-03" } },
      }),
    );
    expect(t).toMatchObject({ start: "2026-06-29", due: "2026-07-03" });
  });

  it("마감일이 range면 end가 anchor(due), start는 range 시작", () => {
    const t = parseNotionTaskPage(
      page({ 제목: { type: "title", title: [{ plain_text: "x" }] }, [NOTION_TASK_PROPS.due]: { type: "date", date: { start: "2026-07-01", end: "2026-07-04" } } }),
    );
    expect(t).toMatchObject({ start: "2026-07-01", due: "2026-07-04" });
  });

  it("마감일이 날짜+시각이어도 앞 10자(YYYY-MM-DD)만", () => {
    const t = parseNotionTaskPage(
      page({ 제목: { type: "title", title: [{ plain_text: "회의" }] }, [NOTION_TASK_PROPS.due]: { type: "date", date: { start: "2026-07-08T09:00:00.000+09:00" } } }),
    );
    expect(t.due).toBe("2026-07-08");
  });

  it("빈 값 방어 — 제목 없음/마감 없음/미완료/부서 없음", () => {
    const t = parseNotionTaskPage(page({ [NOTION_TASK_PROPS.due]: { type: "date", date: null } }));
    expect(t).toMatchObject({ title: "(제목 없음)", start: null, due: null, done: false, dept: null });
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

const T = (o: Partial<NotionTask> & { id: string; due: string | null }): NotionTask => ({
  title: o.id,
  start: o.start ?? o.due,
  done: false,
  dept: null,
  url: null,
  ...o,
});

describe("groupTasksByDate", () => {
  it("마감일별로 묶고, 마감일 없는 항목은 제외", () => {
    const tasks = [T({ id: "a", due: "2026-07-02" }), T({ id: "b", due: "2026-07-02" }), T({ id: "c", due: "2026-07-05" }), T({ id: "d", due: null })];
    const g = groupTasksByDate(tasks);
    expect(g["2026-07-02"]).toHaveLength(2);
    expect(g["2026-07-05"]).toHaveLength(1);
    expect(Object.keys(g)).toHaveLength(2);
  });
});

describe("taskSpans / tasksOnDate", () => {
  it("taskSpans는 [start,end], start 없으면 due로", () => {
    const spans = taskSpans([T({ id: "a", start: "2026-06-29", due: "2026-07-03" }), T({ id: "b", due: "2026-07-01" }), T({ id: "c", due: null })]);
    expect(spans).toEqual([
      { id: "a", start: "2026-06-29", end: "2026-07-03" },
      { id: "b", start: "2026-07-01", end: "2026-07-01" },
    ]); // due=null 제외
  });
  it("tasksOnDate는 그 날짜에 걸치는 업무(기간 포함)", () => {
    const tasks = [T({ id: "a", start: "2026-06-29", due: "2026-07-03" }), T({ id: "b", due: "2026-07-01" }), T({ id: "c", due: "2026-07-05" })];
    expect(tasksOnDate(tasks, "2026-07-01").map((t) => t.id)).toEqual(["a", "b"]);
    expect(tasksOnDate(tasks, "2026-07-05").map((t) => t.id)).toEqual(["c"]);
  });
});

describe("notionBlocksToLines", () => {
  it("제목/문단/불릿/번호/체크/구분선/이미지/표를 라인으로, 미지 타입은 생략", () => {
    const lines = notionBlocksToLines([
      { type: "heading_3", heading_3: { rich_text: [{ plain_text: "체크리스트" }] } },
      { type: "paragraph", paragraph: { rich_text: [{ plain_text: "본문 한 줄" }] } },
      { type: "paragraph", paragraph: { rich_text: [] } }, // 빈 문단 생략
      { type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "항목" }] } },
      { type: "to_do", to_do: { rich_text: [{ plain_text: "할일" }], checked: true } },
      { type: "divider", divider: {} },
      { type: "image", image: {} },
      { type: "table", table: {} },
      { type: "link_preview", link_preview: { url: "x" } }, // 생략
    ]);
    expect(lines).toEqual([
      { kind: "heading", level: 3, text: "체크리스트" },
      { kind: "text", text: "본문 한 줄" },
      { kind: "bullet", text: "항목" },
      { kind: "todo", text: "할일", checked: true },
      { kind: "divider", text: "" },
      { kind: "image", text: "이미지" },
      { kind: "table", text: "표" },
    ]);
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
