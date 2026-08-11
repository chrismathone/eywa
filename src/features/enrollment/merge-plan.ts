// 등록상담 병합 — **계획 조립**. 차단 판정 → 승자 선택 → 컬럼별 결정 → 경고·집계.
// 값 판단은 merge-decide.ts, 값 비교는 merge-values.ts, 컬럼 정책은 merge-policy.ts.
//
// 설계 원칙(2026-08-11 실데이터 드라이런에서 도출):
//   🔑 **사람에게는 사람이 판단할 수 있는 것만 묻는다.** 기술 키·시각 차이·전화 형식은 규칙으로 푼다.
//      1차 시안은 이걸 안 지켜 "어느 시트 탭 키를 남길까요?"까지 물었고 무충돌 그룹이 0%였다.
//   🔴 **규칙으로 푼다 ≠ 조용히 버린다.** 자동 해결분도 무엇을 택했는지 계획에 남기고,
//      버려지는 값은 전부 감사로그 보존 대상으로 계상한다.
import {
  APPEND_COLUMNS,
  ATOMIC_SETS,
  type AtomicSetName,
  BOOLEAN_OR_COLUMNS,
  EARLIEST_WINS_COLUMNS,
  KEY_SETS,
  NAME_LIST_COLUMNS,
  OUTCOME_RANK,
  PHONE_COLUMNS,
  SCALAR_COLUMNS,
  SCHOOL_COLUMNS,
} from "./merge-policy";
import { isSchoolLikeKey, normalizeSchoolName } from "@/features/schools/school-name";
import { outcomePill } from "./outcome-meta";
import {
  decideAppend,
  decideAtomic,
  decideBooleanOr,
  decideEarliest,
  decideKeySet,
  decideNameList,
  decideOutcome,
  decidePhone,
  decideScalar,
  decideSchool,
} from "./merge-decide";
import {
  dayOf,
  filledCount,
  hasAtomic,
  humanize,
  isEmpty,
  memoDates,
  previewOf,
  timeOf,
} from "./merge-values";
import type { ChildCounts, ConsultRow, FieldDecision, MergePlan, PlanOptions, WinnerStrategy } from "./merge-types";

// 소비처가 한 곳에서 가져다 쓰도록 재수출(테스트·서버 액션의 import 경로 불변).
export { looksLikePhone, memoDates, normalizePhone, filledCount } from "./merge-values";
export type { ChildCounts, ConsultRow, FieldDecision, FieldStatus, MergePlan, PlanOptions, WinnerStrategy } from "./merge-types";

export function pickWinner(
  rows: ConsultRow[],
  strategy: WinnerStrategy = "composite",
  children: Record<string, ChildCounts> = {},
): ConsultRow {
  const kid = (r: ConsultRow) => {
    const c = children[r.id];
    return c ? c.ai + c.rec + c.push : 0;
  };
  const rank = (r: ConsultRow) => OUTCOME_RANK[String(r.outcome)] ?? -1;
  const created = (r: ConsultRow) => timeOf(r.created_at) ?? 0;

  const sorted = [...rows].sort((a, b) => {
    switch (strategy) {
      case "latest":
        return created(b) - created(a);
      case "richest":
        return filledCount(b) - filledCount(a) || created(b) - created(a);
      case "outcome":
        return rank(b) - rank(a) || created(b) - created(a);
      case "composite":
      default:
        // 자식 데이터(녹음·AI분석) > 진행 상태 > 채움수 > 최신.
        // 자식을 최우선에 두는 이유: 패자 삭제 시 cascade로 함께 사라지는 유일한 자산이라
        // 승자로 두면 이관 자체가 필요 없어져 실패 지점이 하나 줄어든다.
        return (
          kid(b) - kid(a) || rank(b) - rank(a) || filledCount(b) - filledCount(a) || created(b) - created(a)
        );
    }
  });
  return sorted[0]!;
}

const nameNorm = (v: unknown): string => String(v ?? "").toLowerCase().replace(/\s+/g, "");

function detectBlockers(rows: ConsultRow[], maxDayGap: number): string[] {
  const out: string[] = [];

  // 서로 다른 학생에 연결된 건 = 다른 사람이다. 이름이 같아도 병합 금지.
  const students = new Set(rows.map((r) => r.student_id).filter((v) => !isEmpty(v)).map(String));
  if (students.size > 1) out.push("서로 다른 학생에 연결된 상담입니다");

  // 🔴 **동일인 검증** — 이게 없으면 김철수와 박영희를 합치라고 해도 계획이 통과한다.
  //    화면은 '같은 학생의 다른 상담' 목록에서만 부르지만 서버 액션은 id 두 개로 직접 호출할 수 있어,
  //    "화면에서만 잠갔다"가 되지 않도록 계획 자체가 막는다(#77).
  //    같은 학생에 연결돼 있으면 표기 차이(이름 접미사·개명)는 눈감는다 — 연결이 더 강한 근거다.
  const linked = students.size === 1 && rows.every((r) => !isEmpty(r.student_id));
  if (!linked) {
    if (new Set(rows.map((r) => nameNorm(r.prospect_name))).size > 1) {
      out.push("이름이 서로 다른 상담입니다(다른 사람)");
    }
    // 학교는 표기가 갈린다("일중"/"대구일중") → 정규화 후 비교하고, 급만 남은 잔해("초")는 근거로 안 쓴다.
    const schools = new Set(
      rows
        .map((r) => r.prospect_school)
        .filter((v) => !isEmpty(v))
        .map((v) => normalizeSchoolName(String(v)))
        .filter((k) => isSchoolLikeKey(k)),
    );
    if (schools.size > 1) out.push("학교가 서로 다른 상담입니다(다른 사람)");
  }

  // 과목이 다르면 별건 — 영어 상담과 수학 상담을 합치면 두 지표가 다 망가진다(교차과목 오매몰 금지).
  const subjects = new Set(rows.map((r) => r.subject).filter((v) => !isEmpty(v)).map(String));
  if (subjects.size > 1) out.push("과목이 서로 다른 상담입니다(별건)");

  // 날짜가 멀면 재방문 = 의도적 별건.
  const days = rows.map((r) => dayOf(r.consulted_at)).filter((d): d is number => d !== null);
  if (days.length > 1) {
    const gap = Math.max(...days) - Math.min(...days);
    if (gap > maxDayGap) out.push(`상담일이 ${gap}일 떨어져 있습니다(재방문으로 보임)`);
  }

  if (rows.length < 2) out.push("병합할 상대가 없습니다");
  return out;
}

export function planMerge(
  rows: ConsultRow[],
  opts: PlanOptions = {},
  strategy: WinnerStrategy = "composite",
): MergePlan {
  const { appendFreeText = true, maxDayGap = 7, children = {}, forceWinnerId } = opts;
  const blockers = detectBlockers(rows, maxDayGap);
  const winner = rows.find((r) => r.id === forceWinnerId) ?? pickWinner(rows, strategy, children);
  const losers = rows.filter((r) => r.id !== winner.id);

  const special = new Set<string>([
    ...EARLIEST_WINS_COLUMNS,
    ...BOOLEAN_OR_COLUMNS,
    ...PHONE_COLUMNS,
    ...NAME_LIST_COLUMNS,
    ...SCHOOL_COLUMNS,
    "outcome",
  ]);

  const decisions: FieldDecision[] = [
    ...SCALAR_COLUMNS.filter((c) => !special.has(c)).map((c) => decideScalar(c, winner, losers)),
    ...EARLIEST_WINS_COLUMNS.map((c) => decideEarliest(c, rows)),
    ...BOOLEAN_OR_COLUMNS.map((c) => decideBooleanOr(c, rows)),
    ...PHONE_COLUMNS.map((c) => decidePhone(c, winner, losers)),
    ...NAME_LIST_COLUMNS.map((c) => decideNameList(c, winner, losers)),
    ...SCHOOL_COLUMNS.map((c) => decideSchool(c, winner, losers)),
    decideOutcome(rows),
    ...APPEND_COLUMNS.map((c) => decideAppend(c, winner, losers, appendFreeText)),
    ...(Object.keys(ATOMIC_SETS) as AtomicSetName[]).map((n) =>
      KEY_SETS.includes(n) ? decideKeySet(n, winner, losers) : decideAtomic(n, winner, losers),
    ),
  ];

  const warnings: string[] = [];
  for (const name of KEY_SETS) {
    const d = decisions.find((x) => x.key === name);
    if (d && d.discarded.length > 0) {
      warnings.push(
        name === "makeedu"
          ? "makeedu 연동 키가 여러 개라 하나만 남습니다 — 남지 않은 쪽은 다음 동기화에 다시 추가될 수 있습니다"
          : "옛 시트 이관 키가 여러 개라 하나만 남습니다 — 시트를 재이관하면 다시 추가될 수 있습니다",
      );
    }
  }
  const intake = decisions.find((x) => x.key === "intake");
  if (intake && intake.status !== "same") {
    warnings.push("학부모 QR 접수 원본이 포함되어 있습니다 — 제출 시점 기록이 하나로 합쳐집니다");
  }
  const kidLosers = losers.filter((l) => {
    const c = children[l.id];
    return c && c.ai + c.rec + c.push > 0;
  });
  if (kidLosers.length > 0) warnings.push(`녹음·AI분석 ${kidLosers.length}건이 남기는 상담으로 옮겨집니다`);

  const outcomes = new Set(rows.map((r) => String(r.outcome)));
  if (outcomes.size > 1) {
    const labels = [...outcomes].map((o) => outcomePill(o).label).join(", ");
    warnings.push(`진행 상태가 갈립니다(${labels}) — 하나만 남습니다`);
  }

  // 메모에 적힌 상담일이 서로 겹치지 않으면 **다른 날 만난 별개 상담**일 수 있다.
  // 차단은 하지 않는다 — 이 표기는 관행일 뿐 필수가 아니라, 없다고 별건이 아니고 있다고 확정도 아니다.
  const memoSets = rows.map((r) => memoDates(r.parent_request)).filter((s) => s.size > 0);
  if (memoSets.length > 1) {
    const overlap = memoSets.every((s) => [...s].some((d) => memoSets.every((o) => o.has(d))));
    if (!overlap) {
      const all = [...new Set(memoSets.flatMap((s) => [...s]))].sort();
      warnings.push(`메모에 적힌 상담일이 서로 다릅니다(${all.join(", ")}) — 별개 상담일 수 있습니다`);
    }
  }

  // 사람이 골라야 하는 항목에 **선택지**를 붙인다 — 어느 행의 어떤 값인지 화면이 보여줄 수 있도록.
  for (const d of decisions) {
    if (!d.needsHuman) continue;
    if (d.kind === "atomic" || d.kind === "key") {
      const set = ATOMIC_SETS[d.key as AtomicSetName];
      d.options = rows
        .filter((r) => hasAtomic(r, set))
        .map((r) => ({
          rowId: r.id,
          // 세트는 대표 컬럼 하나로 요약한다(오디오=파일, 결제=금액 …). 전부 나열하면 읽히지 않는다.
          preview: previewOf(set.map((c) => r[c]).find((v) => !isEmpty(v))),
        }));
    } else {
      const seen = new Set<string>();
      d.options = rows
        .filter((r) => !isEmpty(r[d.key]))
        .filter((r) => {
          const k = humanize(d.key, r[d.key]);
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .map((r) => ({ rowId: r.id, preview: humanize(d.key, r[d.key]) }));
    }
  }

  const conflictCount = decisions.filter((d) => d.needsHuman).length;
  const sum = (pred: (d: FieldDecision) => boolean) =>
    decisions.filter(pred).reduce((n, d) => n + d.discarded.length, 0);
  const lossCount = sum((d) => d.kind !== "key" && d.status === "conflict");
  const shadowCount = sum((d) => d.kind !== "key" && d.status === "resolved");
  const keyLossCount = sum((d) => d.kind === "key");

  return {
    winnerId: winner.id,
    loserIds: losers.map((l) => l.id),
    decisions,
    blockers,
    warnings,
    conflictCount,
    lossCount,
    shadowCount,
    keyLossCount,
  };
}

/**
 * 계획 + 사람의 선택 → **DB에 넣을 patch**. 순수 함수라 실행 전에 무엇이 저장될지 그대로 검사할 수 있다.
 *
 * 🔴 서버 액션 안에 두면 "실제로 저장되는 값"을 테스트할 방법이 없어진다 — 병합은 되돌릴 수 없으므로
 *    저장 직전의 모양이 가장 중요한 검사 대상이다. `choices`는 값이 아니라 **행 id만** 받는다(임의 값 주입 차단).
 */
export function buildMergePatch(
  plan: MergePlan,
  rows: ConsultRow[],
  winnerId: string,
  choices: Record<string, string> = {},
):
  | { error: string; patch?: undefined; discarded?: undefined }
  | { error?: undefined; patch: Record<string, unknown>; discarded: { key: string; values: unknown[] }[] } {
  const byId = new Map(rows.map((r) => [r.id, r]));
  if (!byId.has(winnerId)) return { error: "남길 상담을 찾을 수 없습니다" };

  const patch: Record<string, unknown> = {};
  const discarded: { key: string; values: unknown[] }[] = [];

  for (const d of plan.decisions) {
    const pickId = choices[d.key];
    if (d.needsHuman && !pickId) return { error: `MISSING_CHOICE:${d.key}` };
    if (d.discarded.length > 0) discarded.push({ key: d.key, values: d.discarded });

    if (d.kind === "atomic" || d.kind === "key") {
      // 세트는 **통째로** 한 행에서 가져온다 — 섞으면 "A의 오디오에 B의 전사"가 된다.
      const srcId = pickId ?? String(d.proposed);
      const src = byId.get(srcId);
      if (!src) return { error: "선택한 상담을 찾을 수 없습니다" };
      if (srcId === winnerId) continue; // 승자 것 그대로 — patch에 넣을 필요 없다
      for (const col of ATOMIC_SETS[d.key as AtomicSetName]) patch[col] = src[col] ?? null;
      continue;
    }
    if (d.needsHuman) {
      const src = byId.get(pickId!);
      if (!src) return { error: "선택한 상담을 찾을 수 없습니다" };
      patch[d.key] = src[d.key] ?? null;
      continue;
    }
    // 규칙이 정한 값(채움/자동해결/이어붙임). 승자 값과 같으면(same) 굳이 쓰지 않는다.
    if (d.status !== "same") patch[d.key] = d.proposed ?? null;
  }
  return { patch, discarded };
}
