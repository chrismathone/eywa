/**
 * 녹음이 걸린 작성 화면으로 돌아오는 주소 규약(원장 2026-10-16 "녹음하는 곳을 옮겨다니면서").
 *
 * - 작성 화면 한 벌 = 경로 + `form=<id>`(없으면 첫 작성 화면 "main"). 녹음이 걸린 작성 화면이 있는데 '신규 콜&상담'·
 *   '새 회의록'·'상담 기록 추가'를 다시 누르면 새 작성 화면을 이 표식으로 연다. 페이지가 이 값으로 폼에 `key`를 걸고
 *   (Next 16은 페이지 상태 키에서 쿼리를 빼서, 같은 주소의 쿼리만 바뀌면 폼이 그대로 남는다 — gotchas #146), 폼은 임시
 *   저장 칸을 따로 쓴다(`formDraftScope`).
 * - 녹음이 걸린 작성 화면으로 돌아오면(녹음 아이콘의 '작성 화면 열기' · 뒤로 가기) 그 녹음을 누른 뒤의 임시 저장을 안내
 *   없이 바로 되살린다(`recordingSince`). 그보다 오래된 임시 저장(지난번에 쓰다 만 것)은 종전처럼 복구 안내로 묻는다.
 */
import { getBrowserRecordings, recordingIsActive, type BrowserRecording } from "./browser-recording";
import { getForeignRecordings } from "./browser-recording-channel";

export const FORM_PARAM = "form";

/** 지금 주소(창 안이면 `embed=1` 포함)에 값을 얹은 경로 — 녹음이 '작성 화면 열기'로 돌아올 곳. */
export function recordingReturnHref(set: Record<string, string> = {}): string {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(set)) url.searchParams.set(key, value);
  return url.pathname + url.search;
}

/** 새 작성 화면 한 벌의 주소 — 같은 경로에 `form=<새 id>`. */
export function withFormInstance(href: string, id: string = crypto.randomUUID()): string {
  const url = new URL(href, "http://local");
  url.searchParams.set(FORM_PARAM, id);
  return url.pathname + url.search;
}

/** 주소의 작성 화면 표식(`form`) — 없으면 null(첫 작성 화면). */
export function formInstanceOf(href: string): string | null {
  return new URL(href, "http://local").searchParams.get(FORM_PARAM);
}

/** 표식을 뗀 주소 — '새 X'가 여는 화면과 같은 화면인지(학생 등 다른 쿼리까지 같은지) 견줄 때. */
export function withoutFormInstance(href: string): string {
  const url = new URL(href, "http://local");
  url.searchParams.delete(FORM_PARAM);
  return url.pathname + url.search;
}

/** 작성 화면 한 벌의 임시 저장 칸 — 표식이 없으면 종전 칸(`consultation:new`·`meeting:new`). */
export function formDraftScope(base: string, formId: string | null | undefined): string {
  return formId ? `${base}#${formId}` : base;
}

/** 페이지가 폼에 거는 key — 작성 화면이 바뀌면 폼을 새로 그린다. */
export function formInstanceKey(formId: string | string[] | null | undefined): string {
  return typeof formId === "string" && formId ? formId : "main";
}

/** 주소가 가리키는 작성 화면 한 벌 — 경로 + `form`(다른 쿼리는 같은 화면이다). */
function slotOf(href: string): string {
  const url = new URL(href, "http://local");
  return `${url.pathname}|${formInstanceKey(url.searchParams.get(FORM_PARAM))}`;
}

const withSlot = (pathname: string, formId: string | null | undefined) => (formId ? withFormInstance(pathname, formId) : pathname);

/** 이 작성 화면에 걸린 녹음 — 살아 있거나, 끝났지만 파일이 아직 폼에 들어가지 않은 것(아이콘이 떠 있는 동안). */
const holdsForm = (value: BrowserRecording) => recordingIsActive(value) || !!value.file;

/**
 * 이 작성 화면(지금 경로 + `formId`)에 걸린 녹음 중 가장 먼저 누른 것의 시각 — 돌아온 화면이 그 뒤의 임시 저장을 안내 없이
 * 되살린다. 없으면 undefined(종전대로 복구 안내). 녹음은 문서마다 따로라 이 문서의 녹음만 본다.
 */
export function recordingSince(formId: string | null | undefined): number | undefined {
  const here = slotOf(withSlot(window.location.pathname, formId));
  const times = getBrowserRecordings().filter((value) => holdsForm(value) && slotOf(value.href) === here).map((value) => value.startedAt);
  return times.length ? Math.min(...times) : undefined;
}

/**
 * 단일 화면의 '새 X' 주소 — 그 작성 화면(첫 화면)에 녹음이 걸려 있으면(이 탭 또는 다른 창·탭) 새 작성 화면으로 연다(원장
 * 2026-10-16 "녹음중일때 새 회의록 등을 눌러도 새 작성화면이 되도록"). 비어 있으면 첫 화면 그대로 — 임시 저장 안내가 산다.
 */
export function pageFormHref(href: string): string {
  const target = slotOf(href);
  const taken = getBrowserRecordings().some((value) => holdsForm(value) && slotOf(value.href) === target)
    || getForeignRecordings().some((value) => !!value.href && slotOf(value.href) === target);
  return taken ? withFormInstance(href) : href;
}

/** 이 문서에 살아 있는 녹음이 있나 — 있으면 저장 뒤 풀 문서 이동을 하지 않는다(문서가 내려가면 그 녹음이 끝난다). */
export function documentHasLiveRecording(): boolean {
  return getBrowserRecordings().some(recordingIsActive);
}
