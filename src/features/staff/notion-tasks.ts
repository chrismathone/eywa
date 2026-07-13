// Notion 업무 DB 페이지 → eywa 표시용 순수 변환 + 에러 한글화. 클라·서버 공용(순수, server-only 금지 [[#61]]).
// 표시 문자열은 전부 한글 매핑을 거친다(raw 코드·에러 원문 UI 노출 금지 규칙 [[feedback_no-raw-codes-in-ui]]).

export type NotionTask = {
  id: string;
  title: string;
  due: string | null; // YYYY-MM-DD (마감일)
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
  assigneePrimary: "담당자(정)",
  assigneeSecondary: "담당자(부)",
  done: "업무완료",
  dept: "부서",
} as const;

// Notion API 페이지의 최소 형태(필요한 속성만 타이핑). 판별 유니온이라 catch-all 멤버는 두지 않음
// (두면 type 좁히기가 깨진다) — 실제 페이지의 다른 속성 타입은 type-guard가 false로 흘려보냄.
type NotionRichText = { plain_text?: string };
type NotionPropVal =
  | { type: "title"; title?: NotionRichText[] }
  | { type: "rich_text"; rich_text?: NotionRichText[] }
  | { type: "date"; date?: { start?: string | null } | null }
  | { type: "people"; people?: { id: string; name?: string }[] }
  | { type: "checkbox"; checkbox?: boolean }
  | { type: "select"; select?: { name?: string } | null };
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

  const dueVal = props[NOTION_TASK_PROPS.due];
  const due =
    dueVal && dueVal.type === "date" ? (dueVal.date?.start?.slice(0, 10) ?? null) : null;

  const doneVal = props[NOTION_TASK_PROPS.done];
  const done = !!(doneVal && doneVal.type === "checkbox" && doneVal.checkbox);

  const deptVal = props[NOTION_TASK_PROPS.dept];
  let dept: string | null = null;
  if (deptVal && deptVal.type === "select") dept = deptVal.select?.name ?? null;
  else if (deptVal && deptVal.type === "rich_text") dept = plain(deptVal.rich_text) || null;

  return { id: page.id, title: title || "(제목 없음)", due, done, dept, url: page.url ?? null };
}

/** 마감일(YYYY-MM-DD) 기준으로 묶기 — 그리드 셀 배치용. 마감일 없는 항목은 제외. */
export function groupTasksByDate(tasks: NotionTask[]): Record<string, NotionTask[]> {
  const out: Record<string, NotionTask[]> = {};
  for (const t of tasks) {
    if (!t.due) continue;
    (out[t.due] ??= []).push(t);
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
