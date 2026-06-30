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

export type FormDraft = {
  scope: string;
  savedAt: number;
  values: Record<string, string>;
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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

/** 의미 있는 값(빈 문자열 외)이 하나라도 있으면 true — 빈 폼은 저장 안 함. */
export function hasMeaningfulValues(values: Record<string, string>, ignore: string[] = []): boolean {
  const skip = new Set(["id", "subjectDetails", ...ignore]);
  return Object.entries(values).some(([k, v]) => !skip.has(k) && v.trim() !== "" && v !== "{}");
}

export async function saveDraft(scope: string, values: Record<string, string>): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, "readwrite");
    const draft: FormDraft = { scope, savedAt: Date.now(), values };
    tx.objectStore(STORE).put(draft, scope);
    return new Promise((resolve) => {
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    });
  } catch {
    /* 저장 실패는 무시(초안은 best-effort) */
  }
}

export async function loadDraft(scope: string): Promise<FormDraft | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(scope);
    return new Promise((resolve) => {
      req.onsuccess = () => { db.close(); resolve((req.result as FormDraft | undefined) ?? null); };
      req.onerror = () => { db.close(); resolve(null); };
    });
  } catch {
    return null;
  }
}

export async function clearDraft(scope: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(scope);
    return new Promise((resolve) => {
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    });
  } catch {
    /* ignore */
  }
}
