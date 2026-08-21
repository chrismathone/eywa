// 비서 답변 바로가기 링크 — 순수 모듈(서버/클라 공용, Vitest).
//
// 원장 지시(2026-08-20): *"'A'학생을 물어보면 'A'학생의 정보로 바로갈 수 있는 버튼"*.
//
// 🔴 **모델에게 URL을 만들게 하지 않는다** — id 환각은 남의 학생으로 가는 버튼이 된다.
//    링크는 서버가 **툴 결과 JSON에서 결정론적으로 수집**한다(수집은 이 모듈, 실행은 loop.ts).
// 🔴 **답변 본문에 실제로 등장한 이름만** 버튼이 된다([[#86]] — "본문이 N명인데 link가 1개면 그
//    link는 거짓말"의 뒤집힌 꼴: 조회만 하고 언급 안 한 사람까지 붙이면 "왜 이 버튼이 있지"가 된다).
// ⚠️ **권한**: 후보는 사용자 세션(RLS)으로 돌아간 툴 결과에서만 나온다 — 즉 사용자가 이미 조회할 수
//    있었던 대상뿐이라 버튼이 권한 밖으로 새지 않는다. 이 성질이 깨지려면 툴이 admin 클라이언트를
//    쓰거나 모델이 id를 지어내야 하는데 둘 다 금지다(tools.ts 불변 조건 + 이 파일의 결정론 수집).

export const ASSISTANT_LINK_KINDS = ["student", "class", "staff", "meeting"] as const;
export type AssistantLinkKind = (typeof ASSISTANT_LINK_KINDS)[number];

export type AssistantLink = { kind: AssistantLinkKind; id: string; label: string };

/** 라벨 길이 상한 — 저장·표시 공통(긴 회의 제목이 버튼을 삼키지 않게). */
export const MAX_LINK_LABEL = 60;
/** 한 답변에 붙일 버튼 상한 — 넘으면 앞에서부터 자르고 남은 수를 밝힌다(붙인 게 전부인 척 금지). */
export const MAX_LINKS = 8;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 툴 결과 JSON에서 (id, 이름) 쌍이 나오는 자리 — 툴이 실제로 돌려주는 필드 이름 그대로. */
const LINK_FIELDS: { idKey: string; kind: AssistantLinkKind; labelKeys: string[] }[] = [
  { idKey: "studentId", kind: "student", labelKeys: ["name", "studentName"] },
  { idKey: "classId", kind: "class", labelKeys: ["className", "name"] },
  { idKey: "staffId", kind: "staff", labelKeys: ["name", "displayName"] },
  { idKey: "meetingId", kind: "meeting", labelKeys: ["title"] },
];

/** 링크 종류 → 상세 경로. 창(iframe) 시스템이라 소비처는 WindowLink로 연다([[#86]]). */
export function assistantLinkHref(link: AssistantLink): string {
  switch (link.kind) {
    case "student":
      return `/students/${link.id}`;
    case "class":
      return `/classes/${link.id}`;
    case "staff":
      return `/staff/${link.id}`;
    case "meeting":
      return `/meetings/${link.id}`;
  }
}

/** 버튼에 함께 적는 종류 라벨 — 같은 이름의 학생/반이 섞여도 어디로 가는지 보이게. */
export const LINK_KIND_LABEL: Record<AssistantLinkKind, string> = {
  student: "학생",
  class: "반",
  staff: "직원",
  meeting: "회의록",
};

function trimLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t) return null;
  return t.length > MAX_LINK_LABEL ? t.slice(0, MAX_LINK_LABEL) : t;
}

/** 한 객체에서 (id, 라벨) 쌍을 뽑는다 — 같은 객체 안에 있을 때만(다른 행의 이름과 섞이지 않게). */
function linkFromObject(obj: Record<string, unknown>): AssistantLink[] {
  const out: AssistantLink[] = [];
  for (const spec of LINK_FIELDS) {
    const id = obj[spec.idKey];
    if (typeof id !== "string" || !UUID_RE.test(id)) continue;
    let label: string | null = null;
    for (const key of spec.labelKeys) {
      label = trimLabel(obj[key]);
      if (label) break;
    }
    if (label) out.push({ kind: spec.kind, id, label });
  }
  return out;
}

/**
 * 툴 결과 문자열(JSON) 배열 → 링크 후보. JSON이 아니거나 형태가 어긋난 결과는 조용히 건너뛴다
 * (툴은 오류도 문자열로 돌려주므로 파싱 실패가 정상 흐름이다).
 */
export function collectLinkCandidates(toolResults: string[]): AssistantLink[] {
  const out: AssistantLink[] = [];
  const seen = new Set<string>();
  for (const raw of toolResults) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // 툴 오류 문자열("오류: …") 등 — 링크 없음
    }
    walk(parsed, out, seen, 0);
  }
  return out;
}

/** 재귀 수집 — 깊이·개수 상한으로 병적 입력 방어(툴 결과는 이미 6000자 상한이지만 이중 방어). */
function walk(node: unknown, out: AssistantLink[], seen: Set<string>, depth: number): void {
  if (depth > 6 || out.length >= 200) return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, out, seen, depth + 1);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const obj = node as Record<string, unknown>;
  for (const link of linkFromObject(obj)) {
    const key = `${link.kind}:${link.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(link);
  }
  for (const value of Object.values(obj)) walk(value, out, seen, depth + 1);
}

/**
 * 답변 본문에 **실제로 등장한** 후보만 버튼으로. 규칙:
 *  - 이름이 본문에 없으면 제외(조회만 하고 안 부른 대상은 버튼도 없다).
 *  - 같은 종류에서 **이름이 겹치는 후보(동명이인)는 통째 제외** — 어느 쪽인지 모르는 버튼은
 *    잘못된 사람으로 가는 버튼이라 없느니만 못하다.
 *  - 다른 후보 이름의 **일부인 이름은 제외**("김민"과 "김민수"가 함께 후보일 때 본문의 '김민수'가
 *    짧은 쪽까지 켜지는 것 방지).
 *  - 등장 순서대로 정렬하고 상한(8)을 넘으면 잘라내되 **몇 명이 빠졌는지 함께 돌려준다**.
 *
 * ⚠️ 알려진 한계: 후보 "김민"이 있고 본문의 "김민수"가 **후보가 아닐** 때(예: 이름만 있고 id가 없는
 * 툴 결과에서 온 이름)는 짧은 쪽이 켜진다 — 한국어는 이름 뒤에 조사가 그대로 붙어(김민수는/김민수님)
 * 경계를 문자로 못 가른다. 조사 사전을 두면 정상 링크를 잃는 쪽으로 자주 틀리므로 두지 않았다.
 */
export function pickLinksForAnswer(
  answer: string,
  candidates: AssistantLink[],
  max = MAX_LINKS,
): { links: AssistantLink[]; omitted: number } {
  if (!answer.trim() || candidates.length === 0) return { links: [], omitted: 0 };

  // 동명이인 판정 — 같은 종류에서 같은 라벨을 쓰는 서로 다른 id가 있으면 그 라벨은 통째로 버린다.
  const idsByLabel = new Map<string, Set<string>>();
  for (const c of candidates) {
    const key = `${c.kind}:${c.label}`;
    const set = idsByLabel.get(key) ?? new Set<string>();
    set.add(c.id);
    idsByLabel.set(key, set);
  }

  const matched: { link: AssistantLink; at: number }[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (c.label.length < 2) continue; // 한 글자 라벨은 본문 어디에나 걸린다
    if ((idsByLabel.get(`${c.kind}:${c.label}`)?.size ?? 0) > 1) continue;
    const at = answer.indexOf(c.label);
    if (at < 0) continue;
    const key = `${c.kind}:${c.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matched.push({ link: c, at });
  }

  // 더 긴 라벨에 포함되는 짧은 라벨은 제외(같은 종류 안에서만 — 반 이름과 학생 이름은 서로 다른 버튼).
  const kept = matched.filter(
    ({ link }) =>
      !matched.some(
        (other) =>
          other.link !== link &&
          other.link.kind === link.kind &&
          other.link.label.length > link.label.length &&
          other.link.label.includes(link.label),
      ),
  );

  kept.sort((a, b) => a.at - b.at);
  const links = kept.slice(0, max).map((m) => m.link);
  return { links, omitted: Math.max(0, kept.length - links.length) };
}

/**
 * DB jsonb → 검증된 링크 배열. **저장된 값을 신뢰하지 않는다**(수동 조작·옛 스키마) — 종류
 * 화이트리스트·uuid 형식·라벨 길이를 항목별로 검사하고 어긋난 항목만 조용히 버린다(대화를 안 깬다).
 */
export function parseStoredLinks(value: unknown): AssistantLink[] {
  if (!Array.isArray(value)) return [];
  const out: AssistantLink[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const { kind, id, label } = item as { kind?: unknown; id?: unknown; label?: unknown };
    if (typeof kind !== "string" || !(ASSISTANT_LINK_KINDS as readonly string[]).includes(kind)) continue;
    if (typeof id !== "string" || !UUID_RE.test(id)) continue;
    const clean = trimLabel(label);
    if (!clean) continue;
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: kind as AssistantLinkKind, id, label: clean });
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}
