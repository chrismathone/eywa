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

/** 한 학생이 **배정이 확인된** 반 보드 하나(반 + 보드 이름). */
export type CnOkBoard = { classId: string; boardName: string };

/**
 * 이 줄(반, 학생)의 표시 재료.
 *  · `ok` = 이 반 보드에 배정이 확인됐다(체크).
 *  · `elsewhere` = 이 반은 아닌데 **다른 반 보드에는 배정이 확인된** 반 보드 이름들 — ClassNote 연결은 돼 있고 반 배정만
 *    지금 반과 다르다는 뜻이다(원장 2026-10-06 *"연결은 되어있지만 반 배정이 현재반과 다를 때 ? 표시"*).
 */
export type CnLabel = { ok: boolean; match: CnMatch | null; elsewhere?: string[] };

/** 그림 셋 — 체크(배정됨) · 물음표(연결은 됐는데 이 반 배정이 아님) · 회색(연결 자체가 확인 안 됨). */
export type CnLabelState = "ok" | "mismatch" | "none";

/**
 * 🔴 '연결은 돼 있다'의 근거는 **원아가 확인됐다**는 기록뿐이다 — 다른 반 보드에 배정이 확인됐거나, 이 반 줄에 원아 이름이
 *    적혀 있다(원아는 찾았는데 배정이 보류). 둘 다 없으면 연결 자체를 모르는 것이라 물음표가 아니라 회색이다.
 */
export function cnLabelState(label: CnLabel): CnLabelState {
  if (label.ok) return "ok";
  return (label.elsewhere?.length ?? 0) > 0 || (label.match?.childNames.length ?? 0) > 0 ? "mismatch" : "none";
}

/** 원스크린에 내려가는 모양. `available=false`면 라벨을 그리지 않는다. */
export type CnMatchMap = {
  available: boolean;
  byKey: Record<string, CnMatch>;
  /** 학생별 **배정이 확인된** 반 보드(반마다 하나 · 그날 다니는 반은 뺀다 — `buildCnMatchMap`의 `current`) — 이 반이 아닌 다른 반 보드에 있는지를 읽는 재료. 사유는 싣지 않는다. */
  okBoards?: Record<string, CnOkBoard[]>;
  /** 반 보드 대상 반(수학·활성·보고서 발송 · 종강 전 또는 연결이 남은 종강 · 특강 포함 2026-09-30) — 이 밖의 반 행엔 라벨을 달지 않는다.
   *  보고서 미발송(JJ) 반은 대상이 아니다(원장 2026-11-04 *"JJ 미발송반은 클래스노트 반배정도 할 필요없음"*). */
  eligibleClassIds: string[];
  /** 매칭 표 버전(`cnMatchVersion`) — 새로고침 없이 갱신할 때 '바뀌었나'만 가른다(원장 2026-11-04). 표를 못 읽었으면 없다. */
  version?: string;
};

export const CN_UNAVAILABLE: CnMatchMap = { available: false, byKey: {}, eligibleClassIds: [] };

/** 반 보드 매칭 대상 과목 — 수학(math·subject_1)만. 영어는 그룹 반 레일이 따로다. */
export const CN_SUBJECT_KEYS: ReadonlySet<string> = new Set(["math", "subject_1"]);

export const cnKey = (classId: string, studentId: string) => `${classId}|${studentId}`;

/**
 * 표 행 → 원스크린 지도. 한 (반, 학생)에 원아가 둘(학부모·학생 두 계정)이면 **전부 ok여야 ok**,
 * 하나라도 보류면 보류(한쪽만 받는 상태를 초록으로 보이면 안 된다).
 *
 * `current` = 로스터 날짜에 다니는 (반, 학생). 주면 물음표의 근거(`okBoards`)에서 **그날도 다니는 반**의 보드를 뺀다(원장 2026-11-04
 * *"근본으로 해결해"*). 물음표는 '이 반 대신 **그날은 안 다니는 반**의 보드에 배정이 남았다'(반 이동 직후)는 뜻이다 — 두 반을
 * 함께 다니는 학생(예: 이연아 = JJ1G + BS1D)의 다른 반 배정은 이 반 배정이 틀렸다는 증거가 아니다(그 줄에 "배정된 반 보드: BS1D"가 떴다).
 * 안 주면 종전대로 전부.
 */
export function buildCnMatchMap(
  members: readonly CnMemberRow[],
  boards: readonly { class_id: string; board_name: string }[],
  eligibleClassIds: readonly string[],
  current?: readonly { class_id: string; student_id: string }[],
): CnMatchMap {
  const attending = current ? new Set(current.map((e) => cnKey(e.class_id, e.student_id))) : null;
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
  // 학생별 배정이 확인된 반 보드 — (반, 학생) 줄이 전부 ok인 것만(위 규칙 그대로) · 지금도 다니는 반은 빼고(위 `current`).
  const okBoards: Record<string, CnOkBoard[]> = {};
  for (const [k, v] of Object.entries(byKey)) {
    if (v.status !== "ok") continue;
    if (attending?.has(k)) continue;
    const [classId, studentId] = k.split("|") as [string, string];
    (okBoards[studentId] ??= []).push({ classId, boardName: v.boardName ?? "" });
  }
  return { available: true, byKey, okBoards, eligibleClassIds: [...eligibleClassIds] };
}

/**
 * 매칭 표 버전 — 두 표의 (행 수, 가장 큰 번호 · 가장 늦은 연결 시각)으로 만든 짧은 문자열(순수).
 * 서버의 두 경로(전체 조회 `loadClassnoteMatch` · 가벼운 확인 `getClassnoteMatchVersion`)가 **같은 값**을 내야 한다 —
 * 그래서 시각은 밀리초 숫자로 맞춘다(문자열 모양에 기대지 않는다).
 * 동기화는 반을 볼 때마다 그 반의 배정 행을 지우고 다시 넣고(새 번호) 연결 행의 시각을 고친다(scripts/_classnote/math-class-boards-db.mjs) —
 * 지우기만 한 것(대상에서 빠진 반)은 행 수가 잡는다. 🔴 값의 뜻은 '같은가/다른가'뿐이다(크기를 비교하지 말 것).
 */
export function cnMatchVersion(v: { memberCount: number; maxMemberId: number | null; boardCount: number; maxSyncedAt: number | null }): string {
  return `${v.memberCount}.${v.maxMemberId ?? 0}.${v.boardCount}.${v.maxSyncedAt ?? 0}`;
}

/** 전체로 읽은 두 표에서 같은 버전을 만든다(가벼운 확인은 행 수 + 맨 위 한 줄로 같은 값을 만든다). */
export function cnMatchVersionOf(
  members: readonly { id: number | string | null }[],
  boards: readonly { synced_at: string | null }[],
): string {
  let maxMemberId: number | null = null;
  for (const m of members) {
    const id = Number(m.id);
    if (Number.isFinite(id) && (maxMemberId === null || id > maxMemberId)) maxMemberId = id;
  }
  let maxSyncedAt: number | null = null;
  for (const b of boards) {
    const at = b.synced_at ? Date.parse(b.synced_at) : NaN;
    if (Number.isFinite(at) && (maxSyncedAt === null || at > maxSyncedAt)) maxSyncedAt = at;
  }
  return cnMatchVersion({ memberCount: members.length, maxMemberId, boardCount: boards.length, maxSyncedAt });
}

/**
 * 이 화면(강사 로스터)의 반만 남긴다 — 다른 강사 반 학생의 보류 사유가 클라이언트로 내려가지 않게.
 * 반 목록이 비면(수업 없는 날) 빈 지도(available 유지 — 라벨 대상 행도 없다).
 */
export function pickCnForClasses(map: CnMatchMap, classIds: Iterable<string>, studentIds: Iterable<string> = []): CnMatchMap {
  if (!map.available) return map;
  const keep = new Set(classIds);
  const byKey: Record<string, CnMatch> = {};
  for (const [k, v] of Object.entries(map.byKey)) if (keep.has(k.split("|")[0]!)) byKey[k] = v;
  // 다른 반 보드 배정은 **이 로스터의 학생 것만**, 반 보드 이름만 내려보낸다(다른 반의 보류 사유·원아 이름은 싣지 않는다).
  const okBoards: Record<string, CnOkBoard[]> = {};
  for (const id of new Set(studentIds)) {
    const boards = map.okBoards && Object.hasOwn(map.okBoards, id) ? map.okBoards[id] : undefined;
    if (boards?.length) okBoards[id] = boards;
  }
  return {
    available: true,
    byKey,
    okBoards,
    eligibleClassIds: map.eligibleClassIds.filter((id) => keep.has(id)),
    ...(map.version !== undefined ? { version: map.version } : {}),
  };
}

/** 로스터 날짜에 다니는 (반, 학생) — 서버 전용 판정 재료(클라이언트로 내려가지 않는다). */
export type CnAttending = { class_id: string; student_id: string };
/** 서버 조회 한 벌 — 지점 전체 매칭 지도 + 그날 다니는 (반, 학생). */
export type CnMatchLoad = { map: CnMatchMap; attending: readonly CnAttending[] };

/**
 * 강사 로스터 화면 몫 — 페이지 첫 렌더와 새로고침 없는 갱신(`/api/onescreen/classnote-match`)이 **같은 함수**로 좁힌다
 * (같은 날짜·같은 반이면 같은 결과 — 원장 2026-10-14 *"같은 데이터는 같은 원본으로"*).
 * 학생 = 이 반들을 그날 다니는 학생(휴원 포함). 라벨이 붙는 줄(그 반 정규 줄)의 학생은 전부 여기 든다 — 로스터도 같은 날짜·같은
 * 수강 판정으로 줄을 세우고, 보강 줄은 반이 없어 라벨이 없다.
 */
export function pickCnForRoster(loaded: CnMatchLoad, classIds: Iterable<string>): CnMatchMap {
  const keep = new Set(classIds);
  const students = loaded.attending.filter((e) => keep.has(e.class_id)).map((e) => e.student_id);
  return pickCnForClasses(loaded.map, keep, students);
}

/** 이 행에 라벨을 다는가 + 무슨 색인가. null = 라벨 없음(수학 아님·보강 행·미발송 줄·표 못 읽음). */
export function cnLabelFor(
  map: CnMatchMap | undefined,
  row: { classId?: string | null; subjectKey?: string | null; studentId: string; reportOptout?: boolean | null },
): CnLabel | null {
  if (!map?.available) return null;
  if (!row.classId || !row.subjectKey || !CN_SUBJECT_KEYS.has(row.subjectKey)) return null;
  // 보고서 미발송 줄(미발송 반 · 수업 나누기로 온 줄) — 그 줄의 보고서는 ClassNote로 가지 않는다(원장 2026-11-04). 카드·표 같은 판정.
  if (row.reportOptout === true) return null;
  if (!map.eligibleClassIds.includes(row.classId)) return null; // 연결이 걷힌 종강·미발송 반 — 반 보드 대상이 아니다
  const match = map.byKey[cnKey(row.classId, row.studentId)] ?? null;
  const ok = match?.status === "ok";
  if (ok) return { ok, match };
  // 이 반은 아닌데 다른 반 보드에는 배정이 확인된 학생 — 반 배정이 지금 반과 다르다(반 이동 직후 등).
  const others = map.okBoards && Object.hasOwn(map.okBoards, row.studentId) ? map.okBoards[row.studentId]! : [];
  const elsewhere = others.filter((b) => b.classId !== row.classId).map((b) => b.boardName).filter(Boolean);
  return elsewhere.length ? { ok, match, elsewhere } : { ok, match };
}

/** 마우스오버 카드 재료(hover-tip `TipCard` 모양). */
/** 카드 문구 — 강사뷰 화면 언어(사전 `os.cn.*`)를 호출부가 넘긴다. 기본값은 한국어(테스트·서버용). */
export type CnTipLabels = {
  title: string;
  ok: string;
  fail: string;
  cls: string;
  board: string;
  child: string;
  none: string;
  /** 연결은 됐는데 이 반 배정이 아닐 때의 상태 글자. */
  mismatch?: string;
  /** 다른 반 보드 줄의 이름표(값 = 반 보드 이름들). */
  elsewhere?: string;
};
export const CN_TIP_KO: CnTipLabels = {
  title: "ClassNote 반 매칭",
  ok: "매칭됨",
  fail: "매칭 실패",
  cls: "반",
  board: "반 보드",
  child: "원아",
  none: "이 반의 ClassNote 반 보드 연결 기록이 없습니다 — 다음 동기화 뒤에도 그대로면 관리자에게 알려 주세요",
  mismatch: "반 배정 확인 필요",
  elsewhere: "배정된 반 보드",
};

export function cnTipCard(
  label: CnLabel,
  className: string | null | undefined,
  L: CnTipLabels = CN_TIP_KO,
) {
  const m = label.match;
  const state = cnLabelState(label);
  const elsewhere = label.elsewhere ?? [];
  return {
    title: L.title,
    meta: state === "ok" ? L.ok : state === "mismatch" ? (L.mismatch ?? CN_TIP_KO.mismatch!) : L.fail,
    rows: [
      [L.cls, className ?? ""] as const,
      [L.board, m?.boardName ?? ""] as const,
      [L.child, m?.childNames.join(", ") ?? ""] as const,
      // 지금 반이 아니라 어느 반 보드에 배정돼 있는가 — 반 이동 직후처럼 반 배정이 지금 반과 다를 때만.
      ...(elsewhere.length ? [[L.elsewhere ?? CN_TIP_KO.elsewhere!, elsewhere.join(", ")] as const] : []),
    ],
    // 사유 문장은 연동 PC가 적은 데이터(한국어) — 사전 밖.
    lines: m ? m.reasons : [L.none],
  };
}
