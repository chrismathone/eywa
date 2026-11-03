/**
 * 업무 요청 내용을 받는 사람마다 — 선생님마다 자기 몫만(원장 2026-11-03 *"각 선생님에게 각자 학생것만 가면 되지 않을까?
 * 이렇게 같은 서식이 전부 날아갈 필요가 있나?"*). 글은 하나로 저장하고(요청자 · 검토자 · 업무 처리 현황 권한은 전체를 본다)
 * 담당자에게 내려줄 때만 맨 위 블록을 제목으로 가른다.
 *  - '○○ 선생님' 제목(○○ = 이 요청의 담당자 제목 이름) → 다음 제목 전까지 그 선생님 몫
 *  - '담당 미정 · N명' 제목, 담당자가 아닌 사람의 '○○ 선생님 · N명' 제목 → 아무에게도 안 간다
 *  - 그 밖의 제목 아래 · 첫 제목 위 → 모두에게
 * 제목 이름 = 미리 채움이 지은 이름 = 서버가 가르는 이름(둘 다 `recipientNames` — 직원 이름, 담당자끼리 겹치면 과목을 붙인다).
 * 내 몫 제목을 못 찾으면 모두에게 가는 글만 받는다 — 다른 선생님 몫은 보내지 않는다(요청자의 받는 글 미리보기가 알린다 · 맡은 학생은 근거 학생에 그대로).
 * 순수 함수 — 서버(담당자에게 내려줄 때)와 화면(받는 글 미리보기)이 같은 함수를 쓴다.
 */
import type { WorkItem, WorkPerson } from "./model";
import { isRichBody, richBodyText } from "./rich-body";

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
/** 미리 채운 선생님 묶음 제목 — `김은정 선생님 · 7명`. */
const SECTION = /^(.+?)\s*선생님\s*·\s*[\d,]+명$/;
/** 요청자가 쓴 선생님 제목 — `## 김은정 선생님`(그 선생님에게만 덧붙이는 말). */
const PLAIN = /^(.+?)\s*선생님$/;
const NOBODY = /^담당\s*미정(?:\s*·\s*[\d,]+명)?$/;
/** 제목 글자(`richBodyText`)와 같은 모양으로 — 빈칸을 한 칸으로 · 앞뒤 빈칸 없이. */
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * 제목에 쓰는 담당자 이름 — 직원 이름. 이 요청의 담당자끼리 이름이 겹치면 담당 과목(없으면 역할)을 붙이고(`김민지(수학)`),
 * 그래도 겹치면 순번(`김민지(2)` — id 순이라 만들 때와 읽을 때가 같다).
 */
export function recipientNames(people: readonly Pick<WorkPerson, "id" | "name" | "role" | "subjects">[]): Map<string, string> {
  const nameOf = (p: (typeof people)[number]) => norm(p.name);
  const labels = people.map((p) => {
    const name = nameOf(p);
    if (people.filter((q) => nameOf(q) === name).length < 2) return name;
    const tag = p.subjects?.length ? p.subjects.join("·") : p.role;
    return tag ? `${name}(${tag})` : name;
  });
  const byId = people.map((p, i) => ({ id: p.id, label: labels[i]! })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return new Map(people.map((p, i) => {
    const same = byId.filter((x) => x.label === labels[i]);
    return [p.id, same.length < 2 ? labels[i]! : `${nameOf(p)}(${same.findIndex((x) => x.id === p.id) + 1})`];
  }));
}

/** 맨 위 블록으로 나눈다 — 거른 서식 글(태그 짝이 맞고 글자 속 꺾쇠는 이스케이프)을 전제로 깊이만 센다. */
export function topBlocks(html: string): string[] {
  const blocks: string[] = [];
  const tag = /<(\/?)([a-z][a-z0-9]*)\b[^>]*>/gi;
  let depth = 0;
  let start = 0;
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    const closing = m[1] === "/";
    if (depth === 0 && !closing) {
      if (html.slice(start, m.index).trim()) blocks.push(html.slice(start, m.index));
      start = m.index;
    }
    if (closing) depth = Math.max(0, depth - 1);
    else if (!VOID.has(m[2]!.toLowerCase()) && !m[0].endsWith("/>")) depth += 1;
    if (depth === 0) { blocks.push(html.slice(start, tag.lastIndex)); start = tag.lastIndex; }
  }
  if (html.slice(start).trim()) blocks.push(html.slice(start));
  return blocks;
}

/** `some` = 꼬리표 없이 적은 동명이인 제목(`## 김민지 선생님`) — 누구인지 몰라 그 이름의 담당자 모두에게만. */
export type BlockOwner = { to: "all" } | { to: "none" } | { to: "one"; name: string } | { to: "some"; names: string[] };
const ALL: BlockOwner = { to: "all" };
const NONE: BlockOwner = { to: "none" };

/** 블록마다 받는 사람 — 제목을 만날 때마다 바뀌고, 제목이 아닌 블록은 바로 앞 제목을 따른다. */
export function ownedBlocks(body: string, assignees: readonly string[]): { html: string; owner: BlockOwner }[] {
  const names = new Set(assignees.map(norm).filter(Boolean));
  // 이름이 겹쳐 꼬리표를 붙인 담당자(`김민지(수학)`) — 꼬리표 없는 이름으로 적은 제목은 그 이름의 담당자 모두에게.
  const twins = new Map<string, string[]>();
  for (const n of names) {
    const base = /^(.+)\((.+)\)$/.exec(n)?.[1];
    if (base) twins.set(norm(base), [...(twins.get(norm(base)) ?? []), n]);
  }
  const ownerOf = (raw: string): BlockOwner | null => {
    const name = norm(raw);
    return names.has(name) ? { to: "one", name } : twins.has(name) ? { to: "some", names: twins.get(name)! } : null;
  };
  let owner = ALL;
  return topBlocks(body).map((html) => {
    if (/^\s*<h[1-6][\s>]/i.test(html)) {
      const text = richBodyText(html);
      const section = SECTION.exec(text)?.[1];
      const plain = PLAIN.exec(text)?.[1];
      owner = section !== undefined ? ownerOf(section) ?? NONE
        : (plain !== undefined ? ownerOf(plain) : null) ?? (NOBODY.test(text) ? NONE : ALL);
    }
    return { html, owner };
  });
}

/** 받는 사람마다 글이 갈리나 — 아니면 모두 같은 글이라 미리보기 · 안내를 띄우지 않는다. */
export const splitsByRecipient = (body: string, assignees: readonly string[]) =>
  isRichBody(body) && ownedBlocks(body, assignees).some((b) => b.owner.to !== "all");

/** 담당자 한 사람이 받는 글 — 모두에게 가는 블록 + 그 사람 몫. 서식 글이 아니면(옛 요청 · 글자만) 그대로. */
/** 이 블록이 그 사람 몫인가(그 사람 이름 제목 · 동명이인 모두에게 가는 제목). */
const isOwnedBy = (owner: BlockOwner, me: string) => (owner.to === "one" && owner.name === me) || (owner.to === "some" && owner.names.includes(me));

export function bodyFor(body: string, viewer: string, assignees: readonly string[]): string {
  if (!isRichBody(body)) return body;
  const me = norm(viewer);
  return ownedBlocks(body, assignees).filter((b) => b.owner.to === "all" || isOwnedBy(b.owner, me)).map((b) => b.html).join("");
}

/** 가르는 글인데 이 사람 이름 제목이 없나 — 맡은 학생이 있으면 미리보기가 알린다(그 사람은 모두에게 가는 글만 받는다). */
export const lacksOwnPart = (body: string, viewer: string, assignees: readonly string[]) =>
  splitsByRecipient(body, assignees) && !ownedBlocks(body, assignees).some((b) => isOwnedBy(b.owner, norm(viewer)));

/** 꼬리표 없이 적은 동명이인 제목 — 미리보기가 "그 이름의 선생님 모두에게 간다"고 알린다(받는 사람 이름들). */
export const twinHeadings = (body: string, assignees: readonly string[]) =>
  isRichBody(body) ? [...new Set(ownedBlocks(body, assignees).flatMap((b) => (b.owner.to === "some" ? [b.owner.names.join(" · ")] : [])))] : [];

/**
 * 담당자에게 내려줄 업무 — 내 몫 글 · 내 근거 학생 · 내 보고만(다른 담당자 몫의 글 · 학생 이름 · 보고 글은 내려보내지 않는다).
 * 글 전체를 보는 사람(`seesAll` — 요청자 · 검토자 · 업무 처리 현황 권한)은 거치지 않는다.
 */
export function forAssignee(item: WorkItem, me: string): WorkItem {
  const names = recipientNames(item.steps.map((s) => s.user));
  const mine = item.steps.find((s) => s.user.id === me);
  // 보완 요청 기록은 누구에게 돌렸는지 모른다 — 내게 온 마지막 글(내 단계에 남은 글)과 같을 때만 남긴다(그 전에 받은 보완 글은
  // 기록에서 가려진다 — 대상을 기록에 남기려면 SQL이 필요하다). DB `left(…, 1000)`은 글자 단위라 코드 포인트로 자른다(이모지).
  const toMe = (note: string | null) => !!note && !!mine?.returnedNote && Array.from(note).slice(0, 1000).join("") === mine.returnedNote;
  return {
    ...item,
    body: bodyFor(item.body, names.get(me) ?? "", [...names.values()]),
    links: item.links.filter((l) => l.assigneeId === me),
    // 남의 보고 · 받은 보완 요청 글은 비운다 — 진행 상태 · 결과 · 시각은 그대로(누가 어디까지 했는지는 보인다).
    steps: item.steps.map((s) => (s.user.id === me ? s : { ...s, note: null, returnedNote: null })),
    // 사건 기록의 글도 — 남의 보고 · 내게 오지 않은 보완 요청 · 만들 때의 전체 인원.
    events: item.events.map((e) => ((e.kind === "reported" && e.actorId !== me) || e.kind === "created" || (e.kind === "returned" && !toMe(e.note)) ? { ...e, note: null } : e)),
  };
}
