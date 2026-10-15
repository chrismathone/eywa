// Notion 업무 DB 페이지 → aywa 표시용 순수 변환 + 에러 한글화. 클라·서버 공용(순수, server-only 금지 [[#61]]).
// 표시 문자열은 전부 한글 매핑을 거친다(raw 코드·에러 원문 UI 노출 금지 규칙 [[feedback_no-raw-codes-in-ui]]).

export type NotionTask = {
  id: string;
  title: string;
  start: string | null; // YYYY-MM-DD 기간 시작(시작일 없으면 마감일과 동일)
  due: string | null; // YYYY-MM-DD 기간 끝 = 마감일(anchor)
  done: boolean; // 업무완료 체크박스
  dept: string | null; // 부서
  url: string | null; // Notion 페이지 링크(새 탭 열람용)
};

/**
 * Notion DB 속성 이름 매핑 — 실제 DB의 속성명과 일치해야 함(연동 시 확인).
 * 제목(title)은 이름이 아니라 타입(type==="title")으로 찾으므로 여기 없음.
 * ⚠️ 실제 워크스페이스 속성명이 다르면 여기만 고치면 됨(단일 소스).
 */
export const NOTION_TASK_PROPS = {
  due: "마감일",
  start: "시작일",
  assigneePrimary: "담당자(정)",
  assigneeSecondary: "담당자(부)",
  done: "업무완료",
  dept: "부서",
} as const;

// Notion API 페이지의 최소 형태(필요한 속성만 타이핑). 판별 유니온이라 catch-all 멤버는 두지 않음
// (두면 type 좁히기가 깨진다) — 실제 페이지의 다른 속성 타입은 type-guard가 false로 흘려보냄.
type NotionAnnotations = {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  code?: boolean;
};
type NotionRichText = { plain_text?: string; href?: string | null; annotations?: NotionAnnotations };
type NotionPropVal =
  | { type: "title"; title?: NotionRichText[] }
  | { type: "rich_text"; rich_text?: NotionRichText[] }
  | { type: "date"; date?: { start?: string | null; end?: string | null } | null }
  | { type: "people"; people?: { id: string; name?: string; person?: { email?: string } }[] }
  | { type: "checkbox"; checkbox?: boolean }
  | { type: "select"; select?: { name?: string } | null }
  | { type: "status"; status?: { name?: string } | null }
  | { type: "formula"; formula?: { string?: string | null; number?: number | null; boolean?: boolean | null } };
export type NotionPage = {
  id: string;
  url?: string;
  properties?: Record<string, NotionPropVal>;
};

function plain(rt?: NotionRichText[]): string {
  return (rt ?? [])
    .map((t) => t.plain_text ?? "")
    .join("")
    .trim();
}

/** Notion 업무 페이지 → NotionTask. 제목은 type==="title" 속성에서(이름 무관), 나머지는 매핑 이름으로. */
export function parseNotionTaskPage(page: NotionPage): NotionTask {
  const props = page.properties ?? {};
  let title = "";
  for (const val of Object.values(props)) {
    if (val && val.type === "title") title = plain(val.title);
  }

  // 기간 = [start, due]. due(anchor) = 마감일 range의 끝(end) ?? 마감일 start.
  // start = 시작일 속성 ?? 마감일 start. start>due면 due로 클램프(데이터 방어).
  const dueVal = props[NOTION_TASK_PROPS.due];
  const dueStart = dueVal && dueVal.type === "date" ? (dueVal.date?.start?.slice(0, 10) ?? null) : null;
  const dueEnd = dueVal && dueVal.type === "date" ? (dueVal.date?.end?.slice(0, 10) ?? null) : null;
  const startVal = props[NOTION_TASK_PROPS.start];
  const startOwn =
    startVal && startVal.type === "date" ? (startVal.date?.start?.slice(0, 10) ?? null) : null;
  const due = dueEnd ?? dueStart;
  let start = startOwn ?? dueStart;
  if (start && due && start > due) start = due;

  const doneVal = props[NOTION_TASK_PROPS.done];
  const done = !!(doneVal && doneVal.type === "checkbox" && doneVal.checkbox);

  // 부서 — 실 DB에선 formula(문자)로 계산되나, select/status/rich_text도 방어적으로 처리.
  const deptVal = props[NOTION_TASK_PROPS.dept];
  let dept: string | null = null;
  if (deptVal) {
    if (deptVal.type === "select") dept = deptVal.select?.name ?? null;
    else if (deptVal.type === "status") dept = deptVal.status?.name ?? null;
    else if (deptVal.type === "rich_text") dept = plain(deptVal.rich_text) || null;
    else if (deptVal.type === "formula") {
      const f = deptVal.formula;
      dept = (f?.string ?? (f?.number != null ? String(f.number) : null)) || null;
    }
  }

  return { id: page.id, title: title || "(제목 없음)", start, due, done, dept, url: page.url ?? null };
}

/** 마감일(YYYY-MM-DD) 기준으로 묶기 — 리스트 뷰용. 마감일 없는 항목은 제외. */
export function groupTasksByDate(tasks: NotionTask[]): Record<string, NotionTask[]> {
  const out: Record<string, NotionTask[]> = {};
  for (const t of tasks) {
    if (!t.due) continue;
    (out[t.due] ??= []).push(t);
  }
  return out;
}

/** 그리드 기간막대용 스팬 [start, end] — 마감일 있는 업무만. start 없으면 due로. */
export function taskSpans(tasks: NotionTask[]): { id: string; start: string; end: string }[] {
  return tasks
    .filter((t) => t.due)
    .map((t) => ({ id: t.id, start: t.start ?? t.due!, end: t.due! }));
}

/** 한 날짜(YYYY-MM-DD)에 걸치는 업무들 — 그날 상세(그리드 셀 클릭) 목록용. */
export function tasksOnDate(tasks: NotionTask[], date: string): NotionTask[] {
  return tasks.filter((t) => t.due && (t.start ?? t.due) <= date && date <= t.due);
}

// === 업무 본문(Notion 블록) → 표시용 라인 (상세창에서 렌더, 서식·이모지 보존) ===
export type RichSpan = {
  text: string; // 이모지는 텍스트에 그대로 포함됨
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  href?: string; // 링크
};
export type ContentLine = {
  kind: "heading" | "text" | "bullet" | "number" | "todo" | "quote" | "divider" | "image" | "table" | "code";
  spans: RichSpan[]; // 텍스트 조각(서식 보존). divider/image/table은 라벨 한 조각 or 빈 배열.
  checked?: boolean; // todo
  level?: number; // heading 1..3
};

type LooseBlock = {
  type?: string;
  has_children?: boolean;
  [key: string]: unknown;
};

/** rich_text → 서식 보존 span[]. 빈 조각은 제거. */
function toSpans(rt?: NotionRichText[]): RichSpan[] {
  return (rt ?? [])
    .map((r) => {
      const a = r.annotations ?? {};
      const s: RichSpan = { text: r.plain_text ?? "" };
      if (a.bold) s.bold = true;
      if (a.italic) s.italic = true;
      if (a.strikethrough) s.strike = true;
      if (a.code) s.code = true;
      if (r.href) s.href = r.href;
      return s;
    })
    .filter((s) => s.text.length > 0);
}
function blockSpans(b: LooseBlock, key: string): RichSpan[] {
  const inner = b[key] as { rich_text?: NotionRichText[] } | undefined;
  return toSpans(inner?.rich_text);
}

/** span[]을 이어붙인 평문(검색·폴백용). */
export function spansPlain(spans: RichSpan[]): string {
  return spans.map((s) => s.text).join("");
}

/** Notion 블록 배열 → 서식 보존 라인들(제목/문단/불릿/번호/체크/인용/구분선/이미지/표/코드). 알 수 없는 타입은 생략. */
export function notionBlocksToLines(blocks: LooseBlock[]): ContentLine[] {
  const out: ContentLine[] = [];
  for (const b of blocks) {
    const t = b.type ?? "";
    switch (t) {
      case "heading_1":
      case "heading_2":
      case "heading_3": {
        const spans = blockSpans(b, t);
        if (spans.length) out.push({ kind: "heading", level: Number(t.slice(-1)), spans });
        break;
      }
      case "paragraph": {
        const spans = blockSpans(b, t);
        if (spans.length) out.push({ kind: "text", spans });
        break;
      }
      case "bulleted_list_item":
        out.push({ kind: "bullet", spans: blockSpans(b, t) });
        break;
      case "numbered_list_item":
        out.push({ kind: "number", spans: blockSpans(b, t) });
        break;
      case "to_do": {
        const inner = b["to_do"] as { checked?: boolean } | undefined;
        out.push({ kind: "todo", spans: blockSpans(b, t), checked: !!inner?.checked });
        break;
      }
      case "quote":
      case "callout":
      case "toggle": {
        const spans = blockSpans(b, t);
        if (spans.length) out.push({ kind: "quote", spans });
        break;
      }
      case "code":
        out.push({ kind: "code", spans: blockSpans(b, t) });
        break;
      case "divider":
        out.push({ kind: "divider", spans: [] });
        break;
      case "image":
        out.push({ kind: "image", spans: [{ text: "이미지" }] });
        break;
      case "table":
        out.push({ kind: "table", spans: [{ text: "표" }] });
        break;
      // 그 외(link_preview·embed 등)는 생략 — 노이즈 방지.
    }
  }
  return out;
}

/** Notion API/네트워크 에러 → 원장이 읽을 한글(원문은 호출부가 title 툴팁으로만). */
export function humanizeNotionError(raw: string | null | undefined): string {
  const r = (raw ?? "").trim();
  if (!r) return "Notion에서 업무를 불러오지 못했습니다";
  if (/unauthorized|401|invalid.*token|api token|no_token/i.test(r))
    return "Notion 연동 토큰이 유효하지 않습니다 — 관리자에게 문의하세요";
  if (/object_not_found|404|could not find/i.test(r))
    return "Notion 업무 DB를 찾지 못했습니다 — DB 공유·ID를 확인하세요";
  if (/validation|is not a property|property|400/i.test(r))
    return "Notion 속성 이름이 맞지 않습니다 — 마감일·담당자 속성명을 확인하세요";
  if (/rate.?limit|429|conflict/i.test(r)) return "Notion 요청이 많아 잠시 후 다시 시도해주세요";
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout|network|fetch failed|abort/i.test(r))
    return "Notion 서버에 연결하지 못했습니다 — 네트워크를 확인하세요";
  return "Notion에서 업무를 불러오지 못했습니다";
}
