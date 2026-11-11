import type { Entity } from "./catalog";
import type { Node } from "./graph";
import type { NetEdge, NetNode } from "@/features/explore/components/network/types";
import { studentStatusLabel } from "@/features/students/status/status-labels";

/**
 * 날짜 없는 기록의 분류 묶음(원장 2026-11-11 *"외~로 표현하니까 좀 그렇긴하네. 학교 -> 초,중,고 -> 학년 이렇게 뿌려줘"* ·
 * *"학생도 마찬가지"* · *"강사/직원도 과목,기타 -> 이렇게"* · *"반 강좌도 그렇게"*) — 순수 함수.
 *  · 학교·학년 / 원생 = 초등·중등·고등·기타 → 학년(학원 설정 학년 순서) → 기록
 *  · 강사·직원 / 반·강좌 = 과목(학원 설정 과목 순서 · 이름 = 설정 이름) · 기타 → 기록
 * 🔴 과목·학년 이름과 순서는 학원 설정에서 받는다(코드에 적지 않는다 — CLAUDE.md 운영 enum). 초·중·고는 학년 값의 첫 글자로 가른다.
 * 기록은 늘 마지막 단계 묶음 아래에만 선다(단계 `year` = 아래 묶음이 있는 것 · `month` = 기록을 담는 것 — 점 크기만 가른다 · 개별 기록 판은 kg-net.ts가 모두 펼친다).
 * 학년 모르는 원생·학교 = '기타 → 학년 모름' · 설정에 없는 과목 키·과목 이름이 '기타'인 과목 = '기타'(묶음 하나).
 * '관계 없음' 묶음 안도 같은 분류로 나눈다(`at.parent` = 그 묶음 · id 앞머리 `none/`).
 * 재료 칸: 원생 `attributes.grade` · 학교 `attributes.grade`·`school` · 직원 `attributes.subjects`(키 배열 · 첫 과목) · 반 `attributes.subject`(server.ts·server-core.ts가 싣는다).
 */
export type KgCategoryCtx = { subjectLabel: (key: string) => string; subjectOrder: readonly string[]; gradeOrder: readonly string[] };

export const KG_OTHER = "기타";
const NO_GRADE = "학년 모름";
const LEVELS = [["초", "초등"], ["중", "중등"], ["고", "고등"]] as const;
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const levelOf = (grade: string | null) => LEVELS.find(([c]) => grade?.startsWith(c))?.[1] ?? KG_OTHER;

type Step = { key: string; title: string; unit: string };
/** 기록 → 분류 단계(위에서 아래로). 이 유형을 가르지 않으면 null. */
function pathOf(type: Entity, n: Node, ctx: KgCategoryCtx): Step[] | null {
  if (type === "Student" || type === "School") {
    const grade = text(n.attributes?.grade);
    // 학년을 모르면 '기타 → 학년 모름' — 기록은 늘 둘째 단계(접힌 학년 묶음) 아래에 선다(첫 단계가 데이터 따라 펼쳐지지 않게).
    return [{ key: levelOf(grade), title: levelOf(grade), unit: "학교급" }, grade ? { key: grade, title: grade, unit: "학년" } : { key: NO_GRADE, title: NO_GRADE, unit: "학년" }];
  }
  if (type === "Staff" || type === "Course") {
    const raw = type === "Staff" ? n.attributes?.subjects : n.attributes?.subject;
    // 🔴 학원 설정에 있는 과목 키만 — 설정 밖 키는 이름을 모르니(원문 키 노출 금지) '기타'. 직원은 자기 담당 과목 중 설정에 있는 첫 과목.
    const key = (Array.isArray(raw) ? raw : [raw]).map(text).find((k) => k && ctx.subjectOrder.includes(k));
    const title = key ? ctx.subjectLabel(key) : KG_OTHER;
    return [title === KG_OTHER || !key ? { key: KG_OTHER, title: KG_OTHER, unit: "과목" } : { key, title, unit: "과목" }];
  }
  return null;
}
export const kgCategorized = (type: Entity) => type === "Student" || type === "School" || type === "Staff" || type === "Course";

const rank = (list: readonly string[], key: string) => {
  const i = list.indexOf(key);
  return key === KG_OTHER ? 1e6 : i < 0 ? 1e5 : i;
};
const order = (type: Entity, depth: number, ctx: KgCategoryCtx) => (a: string, b: string) => {
  const list = type === "Staff" || type === "Course" ? ctx.subjectOrder : depth === 0 ? LEVELS.map(([, l]) => l) : ctx.gradeOrder;
  return rank(list, a) - rank(list, b) || a.localeCompare(b, "ko");
};

/**
 * 한 영역의 기록 → 분류 묶음 점·선. `records`의 `parent`(+ 학교는 짧은 이름 `label` = 학교 이름)를 채운다. 묶음 id = `grp:<유형>:cat:<앞머리><단계…>`.
 */
export type KgCategoryAt = { parent: string; prefix: string; title: string };
export function categoryTree(hub: NetNode, type: Entity, records: NetNode[], byId: ReadonlyMap<string, Node>, ctx: KgCategoryCtx, at: KgCategoryAt): { groups: NetNode[]; edges: NetEdge[] } {
  const groups: NetNode[] = [];
  const edges: NetEdge[] = [];
  type Bucket = { title: string; unit: string; recs: NetNode[]; kids: Map<string, Bucket> };
  const root: Bucket = { title: "", unit: "", recs: [], kids: new Map() };
  for (const r of records) {
    const n = byId.get(r.id);
    const path = n ? pathOf(type, n, ctx) : null;
    let b = root;
    for (const step of path ?? [{ key: KG_OTHER, title: KG_OTHER, unit: "분류" }]) {
      const next = b.kids.get(step.key) ?? { title: step.title, unit: step.unit, recs: [], kids: new Map() };
      b.kids.set(step.key, next);
      b = next;
    }
    b.recs.push(r);
    if (type === "School" && text(n?.attributes?.school)) r.label = text(n?.attributes?.school)!;
  }
  const count = (b: Bucket): number => b.recs.length + [...b.kids.values()].reduce((t, k) => t + count(k), 0);
  const walk = (b: Bucket, parent: string, prefix: string, depth: number) => {
    for (const key of [...b.kids.keys()].sort(order(type, depth, ctx))) {
      const k = b.kids.get(key)!;
      const id = `grp:${type}:cat:${prefix}${key}`;
      const tally = count(k);
      groups.push({ id, title: depth === 0 ? `${at.title} · ${k.title}` : k.title, label: `${k.title} · ${tally.toLocaleString()}건`, kind: "group", level: k.kids.size > 0 ? "year" : "month", unit: k.unit, tone: hub.tone, hub: hub.id, parent, sectorKey: hub.sectorKey, date: null, tally });
      edges.push({ from: parent, to: id, rel: depth === 0 ? "분류" : "학년" });
      walk(k, id, `${prefix}${key}/`, depth + 1);
      for (const r of [...k.recs].sort((x, y) => (x.label ?? x.title).localeCompare(y.label ?? y.title, "ko"))) {
        r.parent = id;
        edges.push({ from: id, to: r.id, rel: "기록" });
      }
    }
  };
  walk(root, at.parent, at.prefix, 0);
  return { groups, edges };
}

/**
 * 원생 상태 묶음(원장 2026-11-11 *"왜 관계없음이 생기는거지? 학생에서 500여건이나"*) — 지식그래프 바탕이 그 달의 수강 관계라 재원이 아닌 원생(휴원·예비·퇴원)은
 * 선이 없다. 그래서 **선이 하나도 없는 원생만** 지금 상태로 묶는다(그 안은 초·중·고 → 학년 · 🔴 `students.status`는 오늘 값이라 지난 달 판에서 그 달 연결이 있는 원생은
 * kg-net.ts가 여기 넣지 않는다). 재원·상태 모름 = 본 분류(`rest` → '관계 없음'). 이름 = `studentStatusLabel`(원문 코드 노출 금지).
 */
const STATUS_ORDER = ["on_hold", "prospect", "consulted", "withdrawn"];
export function studentStatusBuckets(records: NetNode[], byId: ReadonlyMap<string, Node>): { rest: NetNode[]; buckets: { key: string; label: string; recs: NetNode[] }[] } {
  const rest: NetNode[] = [];
  const by = new Map<string, NetNode[]>();
  for (const r of records) {
    const st = text(byId.get(r.id)?.attributes?.status);
    if (!st || st === "enrolled") rest.push(r);
    else by.set(st, [...(by.get(st) ?? []), r]);
  }
  const buckets = [...by].sort(([a], [b]) => rank(STATUS_ORDER, a) - rank(STATUS_ORDER, b) || a.localeCompare(b)).map(([key, recs]) => ({ key, label: studentStatusLabel(key) ?? "상태 모름", recs }));
  return { rest, buckets };
}
