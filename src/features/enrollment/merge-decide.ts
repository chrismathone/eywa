// 등록상담 병합 — **컬럼(또는 세트) 하나를 어떻게 정할지**. 각 함수는 행들을 받아 결정 하나를 돌려준다.
// 🔑 원칙: 사람에게는 사람이 판단할 수 있는 것만 묻는다(기술 키·시각 차이·전화 형식은 규칙으로).
import {
  ATOMIC_SETS,
  type AtomicSetName,
  OUTCOME_RANK,
  TERMINAL_OUTCOMES,
} from "./merge-policy";
import { isSchoolLikeKey, normalizeSchoolName } from "@/features/schools/school-name";
import type { ConsultRow, FieldDecision, FieldStatus } from "./merge-types";
import { distinctBy, hasAtomic, isEmpty, isSubset, looksLikePhone, nameSet, sameValue, timeOf } from "./merge-values";

// ── 컬럼별 결정 ────────────────────────────────────────────────────────────────

export const decision = (
  key: string,
  kind: FieldDecision["kind"],
  status: FieldStatus,
  proposed: unknown,
  discarded: unknown[] = [],
  reason?: string,
): FieldDecision => ({ key, kind, status, proposed, discarded, reason, needsHuman: status === "conflict" });

/** 가장 이른 시각이 사실 — 늦은 값은 같은 사건을 옮겨 적은 그림자다. */
export function decideEarliest(key: string, all: ConsultRow[]): FieldDecision {
  const values = all.map((r) => r[key]).filter((v) => !isEmpty(v));
  if (values.length === 0) return decision(key, "scalar", "same", null);
  const distinct = distinctBy(values, key);
  if (distinct.length === 1) return decision(key, "scalar", "same", distinct[0]);
  const sorted = [...distinct].sort((a, b) => (timeOf(a) ?? Infinity) - (timeOf(b) ?? Infinity));
  return decision(key, "scalar", "resolved", sorted[0], sorted.slice(1), "가장 이른 시점을 남깁니다");
}

/** 진행 중 상태끼리는 더 나아간 쪽. 결말(등록/미등록)이 둘 다면 사람이 고른다. */
export function decideOutcome(all: ConsultRow[]): FieldDecision {
  const values = all.map((r) => String(r.outcome)).filter((v) => v && v !== "undefined");
  const distinct = [...new Set(values)];
  if (distinct.length <= 1) return decision("outcome", "scalar", "same", distinct[0] ?? null);
  const terminals = distinct.filter((v) => TERMINAL_OUTCOMES.includes(v));
  if (terminals.length > 1) {
    // ⚠️ 버려지는 목록에 **결말만** 넣으면 그 사이의 진행 상태(consulted 등)가 기록 없이 사라진다
    //    (무손실 검증이 김연우 3건에서 이걸 잡았다). 채택하지 않는 값은 전부 남긴다.
    return decision(
      "outcome",
      "scalar",
      "conflict",
      terminals[0],
      distinct.filter((v) => v !== terminals[0]),
      "등록과 미등록이 함께 있습니다 — 자동으로 정하지 않습니다",
    );
  }
  const best = [...distinct].sort((a, b) => (OUTCOME_RANK[b] ?? -1) - (OUTCOME_RANK[a] ?? -1))[0]!;
  return decision(
    "outcome",
    "scalar",
    "resolved",
    best,
    distinct.filter((v) => v !== best),
    "더 진행된 상태를 남깁니다",
  );
}

/**
 * 전화 — **전화 모양인 값만 후보**. 암호문·이름은 판독 불가라 사람에게 묻지 않고 버린다(감사로그 보존).
 * 진짜로 서로 다른 번호가 둘이면 그때만 사람이 고른다.
 */
export function decidePhone(key: string, winner: ConsultRow, losers: ConsultRow[]): FieldDecision {
  const all = [winner, ...losers].map((r) => r[key]).filter((v) => !isEmpty(v));
  const usable = distinctBy(all.filter(looksLikePhone), key);
  const junk = all.filter((v) => !looksLikePhone(v));

  if (usable.length === 0) {
    // 전부 판독 불가 — 승자 것을 그대로 둔다(값을 새로 만들지 않는다).
    // ⚠️ 그래도 패자 쪽 값은 **감사 보존 목록에 넣는다.** 안 넣으면 암호문·이름이 흔적 없이 사라져
    //    나중에 "그 칸에 뭐가 있었나"를 되짚을 방법이 없다(무손실 검증이 이 누락을 잡았다).
    const dropped = junk.filter((v) => !sameValue(v, winner[key], key));
    return decision(key, "scalar", dropped.length ? "resolved" : "same", winner[key], dropped, dropped.length ? "읽을 수 있는 번호가 없습니다" : undefined);
  }
  // 승자 값이 쓸 만하면 그대로, 아니면 쓸 만한 값으로 교체.
  const wUsable = looksLikePhone(winner[key]) ? winner[key] : null;
  if (usable.length === 1) {
    const only = usable[0];
    const status: FieldStatus = wUsable !== null ? (junk.length ? "resolved" : "same") : "filled";
    return decision(
      key,
      "scalar",
      status,
      only,
      junk,
      junk.length ? "전화번호 형식이 아닌 값은 남기지 않습니다" : undefined,
    );
  }
  return decision(key, "scalar", "conflict", wUsable ?? usable[0], [...usable.filter((v) => !sameValue(v, wUsable ?? usable[0], key)), ...junk]);
}

/**
 * 학교명 — 정규화해서 같으면 같은 값이고, **급만 남은 값("초"·"중")은 학교가 아니라 잔해**라 버린다.
 * 표기가 갈리는 건 이미 알려진 문제(같은 학교가 "일중"/"대구일중" 두 표기로 들어와 있다).
 */
export function decideSchool(key: string, winner: ConsultRow, losers: ConsultRow[]): FieldDecision {
  const all = [winner, ...losers].map((r) => r[key]).filter((v) => !isEmpty(v));
  // ⚠️ `isSchoolLikeKey`는 **학교 꼴이면 true**다(급으로 끝나고 급만 있지 않은 것). 뒤집어 쓰면
  //    멀쩡한 학교를 버리고 잔해를 남긴다 — 단위 테스트가 실제로 이 실수를 잡았다.
  const usable = all.filter((v) => isSchoolLikeKey(normalizeSchoolName(String(v))));
  const junk = all.filter((v) => !isSchoolLikeKey(normalizeSchoolName(String(v))));
  if (usable.length === 0) return decision(key, "scalar", "same", winner[key]);

  // 정규화 키가 하나면 표기만 다른 것 — 더 긴(구체적인) 표기를 남긴다.
  const keys = new Set(usable.map((v) => normalizeSchoolName(String(v))));
  if (keys.size === 1) {
    const best = [...usable].sort((a, b) => String(b).length - String(a).length)[0];
    const wSame = !isEmpty(winner[key]) && sameValue(winner[key], best, key);
    return decision(
      key,
      "scalar",
      junk.length || !wSame ? "resolved" : "same",
      best,
      [...usable.filter((v) => !sameValue(v, best, key)), ...junk],
      "같은 학교의 다른 표기입니다",
    );
  }
  return decision(key, "scalar", "conflict", winner[key] ?? usable[0], [
    ...usable.filter((v) => !sameValue(v, winner[key], key)),
    ...junk,
  ]);
}

/** 이름 나열 — 어순 차이는 같은 값, 부분집합이면 더 많은 쪽이 다 담는다. */
export function decideNameList(key: string, winner: ConsultRow, losers: ConsultRow[]): FieldDecision {
  const all = [winner, ...losers].map((r) => r[key]).filter((v) => !isEmpty(v));
  if (all.length === 0) return decision(key, "scalar", "same", null);

  // 어순 무시 중복 제거.
  const uniq: unknown[] = [];
  for (const v of all) {
    const s = nameSet(v);
    if (!uniq.some((u) => isSubset(s, nameSet(u)) && isSubset(nameSet(u), s))) uniq.push(v);
  }
  if (uniq.length === 1) {
    const wEmpty = isEmpty(winner[key]);
    return decision(key, "scalar", wEmpty ? "filled" : "same", uniq[0]);
  }
  // 하나가 나머지 전부를 포함하면 그걸 쓴다(정보 손실 없음).
  const covering = uniq.find((cand) => uniq.every((o) => isSubset(nameSet(o), nameSet(cand))));
  if (covering !== undefined) {
    return decision(key, "scalar", "resolved", covering, [], "이름이 더 많이 적힌 쪽이 나머지를 포함합니다");
  }
  return decision(key, "scalar", "conflict", winner[key] ?? uniq[0], uniq.filter((v) => !sameValue(v, winner[key], key)));
}

/** 동의·신청 플래그 — 한 번이라도 true면 true(동의한 기록이 실제로 있었다). */
export function decideBooleanOr(key: string, all: ConsultRow[]): FieldDecision {
  const values = all.map((r) => r[key]).filter((v) => typeof v === "boolean") as boolean[];
  if (values.length === 0) return decision(key, "scalar", "same", null);
  const any = values.some(Boolean);
  const mixed = new Set(values).size > 1;
  return mixed
    ? decision(key, "scalar", "resolved", any, [], "한쪽에 기록이 있어 '예'로 남깁니다")
    : decision(key, "scalar", "same", any);
}

/** 기술 키 — 사람에게 묻지 않는다. 승자 것 유지, 나머지는 감사로그 보존 + 부활 경고. */
export function decideKeySet(name: AtomicSetName, winner: ConsultRow, losers: ConsultRow[]): FieldDecision {
  const set = ATOMIC_SETS[name];
  const winnerHas = hasAtomic(winner, set);
  const holders = losers.filter((l) => hasAtomic(l, set));
  if (holders.length === 0) return decision(name, "key", "same", winner.id);
  if (!winnerHas) {
    // 승자에 키가 없으면 패자 키를 **가져온다** — 이래야 삭제 후 부활을 막는다.
    return decision(
      name,
      "key",
      holders.length > 1 ? "resolved" : "filled",
      holders[0]!.id,
      holders.slice(1).map((h) => h.id),
      "연동 키를 남기는 상담으로 옮깁니다",
    );
  }
  return decision(name, "key", "resolved", winner.id, holders.map((h) => h.id), "승자 키를 유지합니다");
}

export function decideScalar(key: string, winner: ConsultRow, losers: ConsultRow[]): FieldDecision {
  const wv = winner[key];
  const others = losers.map((l) => l[key]).filter((v) => !isEmpty(v));

  if (isEmpty(wv)) {
    if (others.length === 0) return decision(key, "scalar", "same", wv);
    const distinct = distinctBy(others, key);
    if (distinct.length === 1) return decision(key, "scalar", "filled", distinct[0]);
    return decision(key, "scalar", "conflict", distinct[0], distinct.slice(1));
  }
  const conflicting = distinctBy(others.filter((v) => !sameValue(v, wv, key)), key);
  if (conflicting.length === 0) return decision(key, "scalar", "same", wv);
  return decision(key, "scalar", "conflict", wv, conflicting);
}

/**
 * 자유 서술 — **이어붙이기 전에 "이미 들어 있는지"를 먼저 본다.**
 *
 * 🔴 옛 시트는 다음 달 탭에 **이전 메모를 통째로 옮겨 적고 새 내용을 덧붙이는** 방식이었다
 * (실측: 메모가 둘 이상인 64그룹 중 29그룹이 완전 동일, **18그룹이 한쪽이 다른 쪽을 포함**).
 * 이걸 모르고 이어붙이면 같은 상담 내용이 화면에 두 번 찍힌다 — 병합해서 더 지저분해지는 꼴이다.
 * 포함 관계면 **누적본만 남긴다**(짧은 쪽은 이미 그 안에 있으므로 손실이 아니다).
 */
export function decideAppend(
  key: string,
  winner: ConsultRow,
  losers: ConsultRow[],
  appendFreeText: boolean,
): FieldDecision {
  const wv = winner[key];
  const all = [wv, ...losers.map((l) => l[key])].filter((v) => !isEmpty(v));
  if (all.length === 0) return decision(key, "append", "same", wv);

  // 1) 공백 차이는 같은 글로 본다. 같은 글이면 원문이 더 긴 쪽(줄바꿈이 살아 있는 쪽)을 남긴다.
  const squash = (v: unknown) => String(v).replace(/\s+/g, "");
  const byText = new Map<string, unknown>();
  for (const v of all) {
    const k = squash(v);
    const prev = byText.get(k);
    if (prev === undefined || String(v).length > String(prev).length) byText.set(k, v);
  }
  const uniq = [...byText.values()];

  // 2) 다른 글에 이미 통째로 들어 있는 글은 뺀다(누적본이 있으면 그것만 남는다).
  const kept = uniq.filter(
    (c) => !uniq.some((o) => o !== c && squash(o).length > squash(c).length && squash(o).includes(squash(c))),
  );

  if (kept.length === 1) {
    const only = kept[0];
    if (isEmpty(wv)) return decision(key, "append", "filled", only);
    if (sameValue(wv, only, key)) return decision(key, "append", "same", only);
    // 승자 메모가 패자의 누적본 안에 이미 들어 있다 — 누적본으로 바꾼다(버리는 내용 없음).
    return decision(key, "append", "resolved", only, [], "한쪽 기록이 다른 쪽에 이미 포함돼 있습니다");
  }
  if (!appendFreeText) {
    return decision(key, "append", "conflict", wv, kept.filter((v) => !sameValue(v, wv, key)));
  }
  // 서로 겹치지 않는 별개 기록 — 둘 다 남긴다. 순서는 `all`(승자 먼저) 그대로.
  // ⚠️ 여기서 길이로 재정렬하지 말 것 — 비교자가 비일관(비대칭·비추이)이면 엔진마다 순서가 달라진다.
  return decision(
    key,
    "append",
    "appended",
    kept.map((v) => String(v).trim()).join("\n\n──────────\n"),
    [],
    "겹치지 않는 두 기록을 모두 남깁니다",
  );
}

export function decideAtomic(name: AtomicSetName, winner: ConsultRow, losers: ConsultRow[]): FieldDecision {
  const set = ATOMIC_SETS[name];
  const winnerHas = hasAtomic(winner, set);
  const holders = losers.filter((l) => hasAtomic(l, set));

  if (holders.length === 0) return decision(name, "atomic", "same", winner.id);
  if (!winnerHas) {
    if (holders.length === 1) return decision(name, "atomic", "filled", holders[0]!.id);
    return decision(name, "atomic", "conflict", holders[0]!.id, holders.slice(1).map((h) => h.id));
  }
  // 양쪽 다 세트를 갖고 있다 — 하나만 남길 수 있으므로 사람이 고른다.
  return decision(name, "atomic", "conflict", winner.id, holders.map((h) => h.id));
}

/** 병합 계획을 만든다. DB 접근 없음 — 같은 입력이면 항상 같은 계획(테스트 가능). */
