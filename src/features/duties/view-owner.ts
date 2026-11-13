import { isLate, type WorkItem } from "@/features/work-requests/model";
import { coversLate, coversSubject, openLateRequest } from "./late-request";
import { lateDays, type Cell, type LateItem } from "./view-admin";
import { judge, listedOwner, NO_OWNER, type TreeSubject, type Verdict } from "./view-admin-levels";

const NO_CELL: Cell = { total: 0, done: 0, due: 0, ontime: 0, lateDone: 0, late: 0, expired: 0, over7: 0, pct: null };
type Request = Pick<WorkItem, "id" | "source" | "status" | "createdAt" | "dueOn" | "steps">;
/**
 * 원장 첫 화면의 한 줄 — **과목(과목 관리자)마다** 그 과목이 어떻게 굴러가고, 관리자가 지연에 손을 댔는지.
 * late = 지금 열린 지연(이관 제외) · late3·late7 = 그중 3일·7일 이상 · lateTeachers = 지연이 있는 선생님 수 · requested = 그중 끝나지 않은 처리 요청이 나가 있는 선생님 수
 * · requestsOpen = 이 과목 선생님에게 나가 있는 처리 요청 수 · requestsLate = 그중 요청 기한이 지난 것 · bad·warn = 선생님 판정 분포 · inherited = 이관된 미확인.
 */
export type OwnerRow = {
  subject: string | null; label: string; /** 이 기간 트리에 있는 과목인가 — 아니면 지연만 있는 줄(내려갈 단계가 없다). */ inTree: boolean; managers: string[]; cell: Cell; verdict: Verdict;
  late: number; late3: number; late7: number; lateTeachers: number; requested: number;
  requestsOpen: number; requestsLate: number; bad: number; warn: number; /** 1~2등급 선생님 수. */ good: number; inherited: number;
};

/**
 * 과목 관리자별 현황(원장 구상 2026-11-09 *"원장급 — 각 관리자의 업무 완성도를 … 채워 가는 중인지 살핀다"* · 협의안 7번).
 * 재료는 관리자 화면과 같은 트리 · 같은 지연 목록 · 업무 요청 목록이다(새 집계를 만들지 않는다 — 숫자가 아래 단계와 어긋나지 않게).
 * 🔴 '손댔나'는 처리 요청으로만 센다 — 요청 없이 말로 재촉한 것은 기록이 없어 알 수 없다(화면 문구도 '처리 요청'이라고 적는다).
 * 🔴 요청은 **그 과목을 덮는 것만** 센다(`coversSubject`) — 두 과목을 가르치는 선생님에게 간 영어 요청이 수학 줄의 '요청함'이 되지 않게.
 * 🔴 지연은 고른 기간과 무관하다 — 이 기간 트리에 없는 과목에 지연이 남아 있으면 **지연만 있는 줄**(`inTree: false` · 누르지 않는다)로 덧붙인다(줄의 합 = 전체 '지금 열린 지연').
 * 손댈 것이 많은 순(7일 이상 → 지연 수 → 기한 준수율 낮은 순). 순수 함수(Vitest).
 */
export function ownerRows(tree: readonly TreeSubject[], late: readonly LateItem[], requests: readonly Request[], managers: Record<string, string[]>, labels: Record<string, string>, nowMs: number, today: string): OwnerRow[] {
  const known = new Set(tree.map((s) => s.subject));
  const extra = [...new Set(late.filter((it) => !it.inherited).map((it) => it.subject ?? null))].filter((k) => !known.has(k))
    .map((k): TreeSubject => ({ subject: k, label: k ? labels[k] ?? "기타 과목" : "과목 미정", cell: NO_CELL, cells: {}, owners: [] }));
  return [...tree, ...extra].map((s): OwnerRow => {
    const mine = late.filter((it) => (it.subject ?? null) === s.subject);
    const live = mine.filter((it) => !it.inherited);
    const days = live.map((it) => lateDays(it.dueAt, nowMs));
    const lateOwners = [...new Set(live.flatMap((it) => (it.ownerId ? [it.ownerId] : [])))];
    const owners = new Set([...s.owners.map((o) => o.ownerId), ...lateOwners]);
    const open = requests.filter((r) => coversSubject(r.source, s.subject) && (r.status === "working" || r.status === "review") && r.steps.some((st) => owners.has(st.user.id)));
    const grades = s.owners.filter((o) => o.ownerId !== NO_OWNER && listedOwner(o)).map((o) => judge(o.cell, { pct: s.cell.pct, label: "과목" }).grade);
    return {
      subject: s.subject, label: s.label, inTree: known.has(s.subject), managers: s.subject ? managers[s.subject] ?? [] : [], cell: s.cell, verdict: judge(s.cell),
      late: live.length, late3: days.filter((d) => d >= 3).length, late7: days.filter((d) => d >= 7).length,
      lateTeachers: lateOwners.length, requested: lateOwners.filter((id) => coversLate(openLateRequest(requests, id, s.subject), live.filter((it) => it.ownerId === id))).length,
      requestsOpen: open.length, requestsLate: open.filter((r) => isLate(r, today)).length,
      bad: grades.filter((g) => g === "bad").length, warn: grades.filter((g) => g === "warn").length, good: grades.filter((g) => g === "good").length, inherited: mine.length - live.length,
    };
  }).sort((a, b) => b.late7 - a.late7 || b.late - a.late || (a.cell.pct ?? 101) - (b.cell.pct ?? 101) || a.label.localeCompare(b.label, "ko"));
}
