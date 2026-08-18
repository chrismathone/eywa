/**
 * 폼 로컬 초안 자동저장 — 입력 중 폼 값을 브라우저(IndexedDB)에 디바운스 저장하고, 다시 열면 복구한다.
 * "실제 저장"(서버 커밋)은 기존 그대로 — 초안은 유실 방지/이어쓰기용일 뿐(서버에 안 보냄).
 *
 * 녹음 복구([recording-recovery.ts])와 같은 IDB 패턴. 스코프 문자열(예 "consultation:new",
 * "consultation:<id>", "student:<id>")로 폼마다 독립 보관. 성공 저장 시 호출부가 clearDraft로 비운다.
 *
 * 값 캡처/복원은 **DOM 기반**(name 가진 input/textarea/select/checkbox 일괄)이라 폼별 매핑 불필요.
 * 단, React state로만 사는 컨트롤드 필드(예: 과목점수 jsonb hidden input)는 hook의 onRestore로 별도 rehydrate.
 */

const DB_NAME = "form-draft";
const DB_VERSION = 1;
const STORE = "drafts";
/** 언로드 순간(pagehide) 동기 백스톱의 localStorage 키 접두사 — IDB가 못 미치는 찰나를 메운다. */
const BACKSTOP_PREFIX = "form-draft:hide:";
/** 백스톱 1건 크기 상한 — 넘으면 IDB에만 남긴다(공용 localStorage 통을 한 초안이 먹지 않게). */
const BACKSTOP_MAX_BYTES = 256 * 1024;
/** 백스톱 보관 기간 — 저장 없이 떠난 초안이 영원히 눌러앉지 않게 읽기 경로에서 정리한다. */
const BACKSTOP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** 정리는 세션당 한 번(용량 초과 시에만 강제 재실행). */
let swept = false;

/** 입력 멈춤 후 저장까지 디바운스(ms). */
export const DRAFT_DEBOUNCE_MS = 700;
/**
 * 연속 타이핑 중에도 이 간격(ms)마다 강제 저장 — 디바운스는 타이핑이 이어지는 동안 계속 뒤로 밀려
 * **한 번도 저장이 안 될 수 있다**(배포 스큐 강제 리로드·크래시가 그 사이에 오면 전부 유실).
 */
export const DRAFT_MAX_PENDING_MS = 2000;

export type FormDraft = {
  scope: string;
  savedAt: number;
  values: Record<string, string>;
};

// 연결 캐시 — 매 저장마다 open/close 왕복을 없앤다(리로드 직전 플러시가 microtask 안에 put까지
// 도달하려면 open 왕복이 없어야 한다). 브라우저/버전 교체로 닫히면 다음 호출이 다시 연다.
let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      // 다른 탭이 버전업하거나 브라우저가 닫으면 캐시를 버려 다음 호출이 재연결하게.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      reject(req.error);
    };
  });
  dbPromise = p;
  // 실패한 연결을 영구 캐시하지 않는다 — executor 동기 throw(사생활 모드 등) 포함 모든 거부에서
  // 캐시를 비워 다음 호출이 재시도할 수 있게(적대 리뷰 경-2).
  p.catch(() => {
    if (dbPromise === p) dbPromise = null;
  });
  return p;
}

/**
 * name 있는 폼 컨트롤을 일괄 캡처(checkbox→"true"/"" , radio→선택값, 그 외→value).
 * `exclude`에 든 name은 캡처 안 함(비밀번호·서버 prop·봇 트랩 등 IDB에 남으면 안 되는 값).
 */
export function readFormValues(form: HTMLFormElement, exclude: string[] = []): Record<string, string> {
  const skip = new Set(exclude);
  const out: Record<string, string> = {};
  for (const el of Array.from(form.elements) as HTMLElement[]) {
    const input = el as HTMLInputElement;
    const name = input.name;
    if (!name || input.disabled || skip.has(name)) continue;
    const type = (input.type || "").toLowerCase();
    if (type === "checkbox") out[name] = input.checked ? "true" : "";
    else if (type === "radio") {
      if (input.checked) out[name] = input.value;
    } else if (type === "file" || type === "submit" || type === "button") {
      continue;
    } else {
      out[name] = input.value;
    }
  }
  return out;
}

/** 캡처된 값을 폼 DOM에 되적용(언컨트롤드 input/textarea/select/checkbox). 컨트롤드 필드는 onRestore로 별도 처리. */
export function applyFormValues(
  form: HTMLFormElement,
  values: Record<string, string>,
  exclude: string[] = [],
): void {
  const skip = new Set(exclude);
  for (const el of Array.from(form.elements) as HTMLElement[]) {
    const input = el as HTMLInputElement;
    const name = input.name;
    if (!name || skip.has(name) || !(name in values)) continue;
    const type = (input.type || "").toLowerCase();
    if (type === "checkbox") input.checked = values[name] === "true";
    else if (type === "radio") input.checked = input.value === values[name];
    else if (type === "file" || type === "submit" || type === "button") continue;
    else {
      input.value = values[name]!;
      // 네이티브 change/input을 발화해 (혹시) 의존하는 리스너에 반영(언컨트롤드엔 무해).
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
}

/** JSON 문자열 안에 실제 내용(비어있지 않은 문자열·숫자·true)이 하나라도 있는지 딥스캔. */
function jsonHasContent(raw: string): boolean {
  if (!raw || raw === "{}" || raw === "[]") return false;
  const walk = (v: unknown): boolean => {
    if (v == null) return false;
    if (typeof v === "string") return v.trim() !== "";
    if (typeof v === "number") return true;
    if (typeof v === "boolean") return v;
    if (Array.isArray(v)) return v.some(walk);
    if (typeof v === "object") return Object.values(v).some(walk);
    return false;
  };
  try {
    return walk(JSON.parse(raw));
  } catch {
    return false;
  }
}

/** 의미 있는 값(빈 문자열 외)이 하나라도 있으면 true — 빈 폼은 저장 안 함. */
export function hasMeaningfulValues(values: Record<string, string>, ignore: string[] = []): boolean {
  const skip = new Set(["id", ...ignore]);
  return Object.entries(values).some(([k, v]) => {
    if (skip.has(k)) return false;
    // 과목별 상담 등 hidden JSON 필드 — 통째 제외하면 "과목 탭만 입력한 신규 등록상담"이 초안 저장
    // 자체가 안 된다(실버그, 2026-08-18). 내용을 딥스캔해 있는 경우에만 의미 있다고 판정.
    if (k === "subjectDetails") return jsonHasContent(v);
    return v.trim() !== "" && v !== "{}";
  });
}

export async function saveDraft(scope: string, values: Record<string, string>): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, "readwrite");
    const draft: FormDraft = { scope, savedAt: Date.now(), values };
    tx.objectStore(STORE).put(draft, scope);
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* 저장 실패는 무시(초안은 best-effort) */
  }
}

/**
 * 언로드 순간(pagehide/숨김) 전용 플러시 — **localStorage에 동기로** 먼저 적고(페이지가 죽어도 남는
 * 유일한 동기 저장소), IDB에도 best-effort로 얹는다. 로드는 `loadDraft`가 둘 중 최신을 고른다.
 * ⚠️ 평상시 디바운스 저장에 쓰지 말 것(localStorage는 용량이 작고 동기라 타이핑 프레임을 막는다).
 */
export function saveDraftOnHide(scope: string, values: Record<string, string>): void {
  const draft: FormDraft = { scope, savedAt: Date.now(), values };
  try {
    const raw = JSON.stringify(draft);
    // 🔴 큰 초안은 백스톱에 싣지 않는다 — localStorage는 **origin 공용 5MB 한 통**이고(gotcha #90)
    //    거기엔 창 배치·사용자 설정(zustand persist)도 함께 산다. 그 통이 차면 조용히 degrade하는 건
    //    초안이 아니라 **창 시스템**이다(persist는 setItem을 감싸지 않아 창을 열 때마다 throw).
    //    한도를 넘는 초안은 IDB 사본만 남긴다 — 언로드 찰나를 놓칠 순 있어도 남의 저장을 깨진 않는다.
    if (raw.length <= BACKSTOP_MAX_BYTES) {
      try {
        localStorage.setItem(BACKSTOP_PREFIX + scope, raw);
      } catch {
        // 용량 초과 — 오래된 백스톱을 걷어내고 한 번만 재시도(내 초안 하나 때문에 통을 못 쓰는 상황 방지).
        sweepBackstops(true);
        try {
          localStorage.setItem(BACKSTOP_PREFIX + scope, raw);
        } catch {
          /* 그래도 안 되면 IDB만 — 조용히 포기 */
        }
      }
    }
  } catch {
    /* 사생활 모드·직렬화 실패 — IDB 쪽만 시도 */
  }
  void saveDraft(scope, values);
}

/**
 * 오래된 백스톱 키 정리 — 백스톱은 `clearDraft`(서버 저장·폐기)로만 사라지므로, 저장하지 않고 떠난
 * 초안은 그대로 눌러앉는다. 스코프가 **레코드마다 하나**라(학생 메모·회의·상담) 시간이 지나면 수백 개가
 * 된다. 읽기 경로에서 세션당 한 번만 훑는다(언로드 순간에 돌리면 그 프레임을 잡아먹는다).
 */
function sweepBackstops(force = false): void {
  if (swept && !force) return;
  swept = true;
  try {
    const now = Date.now();
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(BACKSTOP_PREFIX)) continue;
      let savedAt = 0;
      try {
        savedAt = (JSON.parse(localStorage.getItem(key) ?? "{}") as FormDraft).savedAt ?? 0;
      } catch {
        savedAt = 0; // 손상 항목도 정리 대상
      }
      if (!savedAt || now - savedAt > BACKSTOP_MAX_AGE_MS) stale.push(key);
    }
    for (const k of stale) localStorage.removeItem(k);
  } catch {
    /* 사생활 모드 등 — 정리는 best-effort */
  }
}

function readBackstop(scope: string): FormDraft | null {
  try {
    const raw = localStorage.getItem(BACKSTOP_PREFIX + scope);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FormDraft;
    if (typeof parsed?.savedAt !== "number" || typeof parsed?.values !== "object" || !parsed.values)
      return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 두 초안 중 최신을 고른다(동시각이면 IDB 쪽 우선). export는 단위테스트용. */
export function pickNewerDraft(fromDb: FormDraft | null, backstop: FormDraft | null): FormDraft | null {
  if (!fromDb) return backstop;
  if (!backstop) return fromDb;
  return backstop.savedAt > fromDb.savedAt ? backstop : fromDb;
}

export async function loadDraft(scope: string): Promise<FormDraft | null> {
  sweepBackstops(); // 세션 첫 조회에서만 — 오래된 백스톱이 공용 통에 쌓이지 않게
  const fromDb = await new Promise<FormDraft | null>((resolve) => {
    try {
      void openDB().then(
        (db) => {
          const tx = db.transaction(STORE, "readonly");
          const req = tx.objectStore(STORE).get(scope);
          req.onsuccess = () => resolve((req.result as FormDraft | undefined) ?? null);
          req.onerror = () => resolve(null);
        },
        () => resolve(null),
      );
    } catch {
      resolve(null);
    }
  });
  // 언로드 백스톱과 비교해 최신을 반환 — 백스톱은 지우지 않는다(다음 서버 저장 clearDraft가 함께 지운다.
  // 여기서 지우면 그 IDB 재기록이 실패했을 때 초안이 영영 사라진다).
  return pickNewerDraft(fromDb, readBackstop(scope));
}

export async function clearDraft(scope: string): Promise<void> {
  try {
    localStorage.removeItem(BACKSTOP_PREFIX + scope);
  } catch {
    /* ignore */
  }
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(scope);
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* ignore */
  }
}
