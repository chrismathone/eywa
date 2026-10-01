/**
 * **반 이름 충돌 판정 단일 소스** (순수 · Vitest) — 원장 2026-10-01.
 *
 * 반 이름 유니크 인덱스 `classes_tenant_name_subject_idx (tenant_id, class_name, subject)`엔 `WHERE is_active`가
 * 없어서 **종강·폐지된 반도 이름 한 칸을 쥔다**([[#120]]). 그래서 `PL4 → PL5` 같은 개명이 7월에 종강한 `PL5` 때문에
 * 23505로 거절되는데, 화면은 "저장에 실패했습니다"만 보여 원장이 이유를 몰랐다(2026-10-01 실제 사례).
 *
 * 원장 지시: *"이런 오류를 명확히 알 수 있게 '중복되는 반이름이 있습니다. (종강처리된 반)' 같은 식으로"* —
 * 🔴 **말없이 자동으로 남의 반 이름을 바꾸지 않는다.** 저장은 실패로 돌려주고 ① 무엇과 겹쳤는지(그 반의 상태)를
 * 반 이름 칸에 적고 ② 겹친 반이 **운영 중이 아닐 때만** "그 반 이름을 '<이름> (~YYYY-MM)'로 바꾸고 저장" 버튼을
 * 준다. 버튼을 눌러 온 요청(플래그)만 서버가 그 반을 다시 확인하고 비운다(class-name-guard.ts).
 *
 * 같은 판정을 반 수정·반 생성·레벨 변경이 함께 쓴다 — 경로마다 문구·상태 판정이 갈리지 않게.
 */
import { normalizeClassName } from "./class-name";
import { closedClassNameBase } from "./closed-name";

/** 이름을 쥐고 있는 반 — 판정에 필요한 칸만. */
export type ClassNameHolder = { id: string; isActive: boolean; closedAt: string | null };

/** operating = 운영 중 · closed = 종강 처리됨(종강일이 오늘 이전·당일) · archived = 폐지(종강일 없음). */
export type ClassNameHolderStatus = "operating" | "closed" | "archived";

const STATUS_LABEL: Record<ClassNameHolderStatus, string> = {
  operating: "운영 중인 반",
  closed: "종강 처리된 반",
  archived: "폐지된 반",
};

/** 여러 반이 걸리면 **가장 강한 것**으로 말한다(운영 중 > 종강 > 폐지) — 운영 중인 반을 가리면 안 된다. */
const STATUS_RANK: Record<ClassNameHolderStatus, number> = { operating: 2, closed: 1, archived: 0 };

/**
 * 그 반의 상태.
 * - 종강일(`closed_at`)이 오늘 이전·당일 → 종강 처리된 반(종강은 `is_active`를 켠 채로 둔다 — endClassTerm 주석)
 * - 폐지(`is_active=false`)인데 종강일이 없거나 아직 안 왔으면 → 폐지된 반
 * - 나머지 → 운영 중인 반(종강 **예정**인 반 포함 — 아직 수업한다)
 */
export function classNameHolderStatus(holder: ClassNameHolder, today: string): ClassNameHolderStatus {
  const closed = holder.closedAt ? holder.closedAt.slice(0, 10) : null;
  if (closed && closed <= today) return "closed";
  if (!holder.isActive) return "archived";
  return "operating";
}

export function classNameHolderStatusLabel(status: ClassNameHolderStatus): string {
  return STATUS_LABEL[status];
}

/** 겹친 반이 여럿이면 가장 강한 상태의 반(운영 중 > 종강 > 폐지). 없으면 null. */
export function strongestClassNameHolder(
  holders: readonly ClassNameHolder[],
  today: string,
): { holder: ClassNameHolder; status: ClassNameHolderStatus } | null {
  let best: { holder: ClassNameHolder; status: ClassNameHolderStatus } | null = null;
  for (const holder of holders) {
    const status = classNameHolderStatus(holder, today);
    if (!best || STATUS_RANK[status] > STATUS_RANK[best.status]) best = { holder, status };
  }
  return best;
}

/**
 * 반 이름 칸에 붙는 문구. "같은 과목에"를 넣는다 — 유니크 인덱스는 과목별이라 다른 과목의 같은 이름은 겹치지 않는다
 * (그걸 빼면 "수학에 PL5가 없는데?"라는 오해가 생긴다).
 */
export function duplicateClassNameMessage(status: ClassNameHolderStatus): string {
  return `같은 과목에 중복되는 반 이름이 있습니다. (${STATUS_LABEL[status]})`;
}

/** 운영 중인 반의 이름은 비워 주지 않는다 — 그 반은 지금 수업한다(버튼 없이 문구만). */
export function canFreeClassName(status: ClassNameHolderStatus): boolean {
  return status !== "operating";
}

/**
 * 비울 때 붙이는 보관 접미사의 바탕 — `PL5` → `PL5 (~26.07.02)`(종강일).
 * 종강일이 없는 폐지 반은 손으로 하던 스크립트(`scripts/_english_sync/free-class-name.mts`)와 같이 `(~종강)`.
 */
export function archivedClassNameBase(name: string, closedAt: string | null): string {
  return closedClassNameBase(name, closedAt);
}

/** 접미사 이름까지 이미 있으면 ` 2`, ` 3` … 을 붙인다. 이 개수를 넘으면 사람이 정해야 한다(버튼을 안 준다). */
export const ARCHIVED_NAME_MAX_TRIES = 9;

export function archivedClassNameCandidates(name: string, closedAt: string | null): string[] {
  const base = archivedClassNameBase(name, closedAt);
  return Array.from({ length: ARCHIVED_NAME_MAX_TRIES }, (_, i) => (i === 0 ? base : `${base} ${i + 1}`));
}

/** 후보 중 아직 아무도 안 쓰는 첫 이름. 전부 쓰이고 있으면 null. */
export function pickArchivedClassName(
  name: string,
  closedAt: string | null,
  taken: Iterable<string>,
): string | null {
  const used = new Set(taken);
  return archivedClassNameCandidates(name, closedAt).find((c) => !used.has(c)) ?? null;
}

/** 유니크 위반(23505)인가 — **오류 코드로만** 판정한다(영문 문구 파싱 금지). */
export function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: unknown }).code === "23505";
}

/** 화면으로 돌려주는 충돌 정보 — 문구 + (비울 수 있으면) 버튼에 쓸 새 이름. */
export type ClassNameConflict = {
  /** 겹친 이름(정규화된 값). */
  name: string;
  status: ClassNameHolderStatus;
  message: string;
  /** 겹친 반 id — 버튼을 누른 요청이 **그 반**을 비우는 데 동의했는지 서버가 대조한다. */
  holderId: string;
  /** 비울 때 그 반에 붙일 이름. 운영 중이거나 권한이 없거나 후보가 바닥나면 null(버튼 없음). */
  freeTo: string | null;
  /** 저장하는 사람에게 남의 반 이름을 비울 권한이 있나(관리자) — `freeTo`가 null일 때 안내 문구를 가른다. */
  allowFree: boolean;
};

/**
 * 버튼이 없을 때 붙이는 안내 — 운영 중이면 없음(null). 권한이 없으면 관리자에게, 권한은 있는데 새 이름을 못 정했으면
 * (접미사 후보가 바닥남·조회 실패) 그 반 이름을 직접 바꾸라고.
 */
export function classNameConflictHint(c: Pick<ClassNameConflict, "status" | "freeTo" | "allowFree">): string | null {
  if (c.status === "operating" || c.freeTo) return null;
  return c.allowFree
    ? "그 반 이름에 붙일 새 이름을 정하지 못했습니다 — 그 반 상세에서 이름을 직접 바꾼 뒤 저장해 주세요."
    : "그 반 이름을 먼저 바꿔야 이 이름을 쓸 수 있습니다 — 관리자에게 요청해 주세요.";
}

/**
 * PostgREST `or=(...)` 안에 넣을 값 — 큰따옴표로 감싸고 `\`·`"`를 이스케이프한다.
 * 맨값으로 넣으면 `PL5 (~2026-07)`의 `)`·`,`에서 식이 끊겨 400이 난다(반 이름엔 괄호가 흔하다).
 */
export function postgrestQuoted(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** 버튼이 폼에 실어 보내는 칸 이름 — 클라·서버가 같은 상수를 쓴다. */
export const FREE_CLOSED_NAME_FIELDS = {
  flag: "freeClosedName",
  holderId: "freeClosedNameId",
  to: "freeClosedNameTo",
  name: "freeClosedNameFor",
} as const;

/** "그 반 이름을 비우고 저장" 요청 — 사용자가 동의한 (이름, 그 반, 새 이름) 세 가지가 함께 와야 한다. */
export type FreeClosedNameRequest = { name: string; holderId: string; to: string };

/**
 * 폼에서 비우기 요청을 읽는다. 플래그가 없거나 칸이 하나라도 비면 null — **명시적으로 누른 요청만** 인정한다.
 */
export function readFreeClosedNameRequest(formData: FormData): FreeClosedNameRequest | null {
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  if (get(FREE_CLOSED_NAME_FIELDS.flag) !== "1") return null;
  const name = normalizeClassName(get(FREE_CLOSED_NAME_FIELDS.name));
  const holderId = get(FREE_CLOSED_NAME_FIELDS.holderId);
  const to = normalizeClassName(get(FREE_CLOSED_NAME_FIELDS.to));
  if (!name || !holderId || !to) return null;
  return { name, holderId, to };
}
