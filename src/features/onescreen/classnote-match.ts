/**
 * 원스크린 'C.N' 라벨 — ClassNote **반 보드 매칭** 상태(순수 · Vitest).
 *
 * 원장 2026-09-29: *"수학 강사뷰에서 클래스노트 반매핑 완료되었는지 c.n 라벨 하나 만들어서 · 초록불이면 매칭,
 * 빨간불이면 매칭실패 · 마우스오버시 정보확인가능하게 · 표모드에서도 마찬가지"*.
 *
 * 재료 = 0302a `classnote_class_boards`·`classnote_class_board_members`(연동 PC 스크립트·워커가 적는다 —
 * ClassNote에서 **실제로 배정이 확인된 원아만** ok). 원스크린은 이 표를 읽기만 한다.
 * 🔴 라벨 단위는 (반, 학생)이다 — 같은 학생도 반마다 보드가 따로다(반 2~3개면 각각).
 * 🔴 표를 못 읽었으면(0302a 미적용·조회 실패) **라벨 자체를 안 그린다** — 빨간불로 떨어지면 거짓 경보다.
 * ⚠️ 사유 문구는 스크립트가 한글로 적는다(보호자 전화 **값**은 들어 있지 않다 — 일치 여부만).
 */

export type CnMemberRow = {
  class_id: string;
  student_id: string;
  status: "ok" | "hold";
  child_name: string | null;
  reason: string | null;
};

export type CnMatch = {
  status: "ok" | "hold";
  boardName: string | null;
  childNames: string[];
  reasons: string[];
};

/** 원스크린에 내려가는 모양. `available=false`면 라벨을 그리지 않는다. */
export type CnMatchMap = {
  available: boolean;
  byKey: Record<string, CnMatch>;
  /** 반 보드 대상 반(수학·활성·보고서 발송·특강 아님·종강 전) — 이 밖의 반 행엔 라벨을 달지 않는다(특강 행 가짜 빨간불 방지). */
  eligibleClassIds: string[];
};

export const CN_UNAVAILABLE: CnMatchMap = { available: false, byKey: {}, eligibleClassIds: [] };

/** 반 보드 매칭 대상 과목 — 수학(math·subject_1)만. 영어는 그룹 반 레일이 따로다. */
export const CN_SUBJECT_KEYS: ReadonlySet<string> = new Set(["math", "subject_1"]);

export const cnKey = (classId: string, studentId: string) => `${classId}|${studentId}`;

/**
 * 표 행 → 원스크린 지도. 한 (반, 학생)에 원아가 둘(학부모·학생 두 계정)이면 **전부 ok여야 ok**,
 * 하나라도 보류면 보류(한쪽만 받는 상태를 초록으로 보이면 안 된다).
 */
export function buildCnMatchMap(
  members: readonly CnMemberRow[],
  boards: readonly { class_id: string; board_name: string }[],
  eligibleClassIds: readonly string[],
): CnMatchMap {
  const boardBy = new Map(boards.map((b) => [b.class_id, b.board_name]));
  const byKey: Record<string, CnMatch> = {};
  for (const m of members) {
    const k = cnKey(m.class_id, m.student_id);
    const cur = byKey[k] ?? { status: "ok", boardName: boardBy.get(m.class_id) ?? null, childNames: [], reasons: [] };
    if (m.status !== "ok") cur.status = "hold";
    if (m.child_name && !cur.childNames.includes(m.child_name)) cur.childNames.push(m.child_name);
    if (m.reason && !cur.reasons.includes(m.reason)) cur.reasons.push(m.reason);
    byKey[k] = cur;
  }
  return { available: true, byKey, eligibleClassIds: [...eligibleClassIds] };
}

/**
 * 이 화면(강사 로스터)의 반만 남긴다 — 다른 강사 반 학생의 보류 사유가 클라이언트로 내려가지 않게.
 * 반 목록이 비면(수업 없는 날) 빈 지도(available 유지 — 라벨 대상 행도 없다).
 */
export function pickCnForClasses(map: CnMatchMap, classIds: Iterable<string>): CnMatchMap {
  if (!map.available) return map;
  const keep = new Set(classIds);
  const byKey: Record<string, CnMatch> = {};
  for (const [k, v] of Object.entries(map.byKey)) if (keep.has(k.split("|")[0]!)) byKey[k] = v;
  return { available: true, byKey, eligibleClassIds: map.eligibleClassIds.filter((id) => keep.has(id)) };
}

/** 이 행에 라벨을 다는가 + 무슨 색인가. null = 라벨 없음(수학 아님·보강 행·표 못 읽음). */
export function cnLabelFor(
  map: CnMatchMap | undefined,
  row: { classId?: string | null; subjectKey?: string | null; studentId: string },
): { ok: boolean; match: CnMatch | null } | null {
  if (!map?.available) return null;
  if (!row.classId || !row.subjectKey || !CN_SUBJECT_KEYS.has(row.subjectKey)) return null;
  if (!map.eligibleClassIds.includes(row.classId)) return null; // 특강·종강·미발송 반 — 반 보드 대상이 아니다
  const match = map.byKey[cnKey(row.classId, row.studentId)] ?? null;
  return { ok: match?.status === "ok", match };
}

/** 마우스오버 카드 재료(hover-tip `TipCard` 모양). */
export function cnTipCard(label: { ok: boolean; match: CnMatch | null }, className: string | null | undefined) {
  const m = label.match;
  return {
    title: "ClassNote 반 매칭",
    meta: label.ok ? "매칭됨" : "매칭 실패",
    rows: [
      ["반", className ?? ""] as const,
      ["반 보드", m?.boardName ?? ""] as const,
      ["원아", m?.childNames.join(", ") ?? ""] as const,
    ],
    lines: m
      ? m.reasons
      : ["이 반의 ClassNote 반 보드 연결 기록이 없습니다 — 다음 동기화 뒤에도 그대로면 관리자에게 알려 주세요"],
  };
}
