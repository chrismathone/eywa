/**
 * 영어 보고서 템플릿의 **내 기본값 = 내가 마지막으로 고른 템플릿** — 원장 2026-10-27 *"템플릿은 사용자 별 자기가 최근 사용한걸
 * 디폴트로 지정되게"*. 순수 모듈(Vitest).
 *
 * 🔑 저장 자리 = 선생님 계정 `users.ui_prefs.onescreen`(계정 귀속 — 다른 PC에서도 같다). 드롭다운에서 고를 때 적는다.
 *    `lastTemplateByClass[반]` = 그 반에서 마지막으로 고른 것 · `lastTemplateId` = 어느 반에서든 마지막으로 고른 것.
 * 🔴 **반이 먼저다** — 계정 하나로만 기억하면 JJ 반에서 JJ를 한 번 고른 순간 일반 영어 반의 빈 행까지 JJ로 시작해,
 *    숙제 완성도 줄이 빠지고 '사랑의 한마디 필수'가 조용히 풀린다(적대 리뷰 2026-10-27). 그래서 반에 기록이 없을 때만 계정 값을
 *    쓰고, 그 값이 **JJ 수업보고서면 쓰지 않는다**(JJ는 그 반을 위한 양식이다).
 * 🔴 **아직 글이 없는 행에만** 붙인다 — 옛 기본 템플릿으로 이미 쓴 글(templateId가 비어 있다)에 붙이면 저장 직전 재조립이 그 글을
 *    다른 템플릿으로 다시 짠다. 붙인 값은 **표시만**(`templateImplicit`) — 세션에 저장하지 않는다(저장하면 기본값을 바꿔도 그 행이 옛
 *    기본값에 묶인다). 강사가 고르거나 글을 짜는 순간 진짜 선택이 된다.
 */
import { BUILTIN_ENGLISH_TEMPLATES, BUILTIN_JJ_SHEET_TEMPLATE_ID, isHiddenBuiltinTemplate } from "@/features/report-templates/defaults";

export const LAST_TEMPLATE_PREF = "lastTemplateId";
export const LAST_TEMPLATE_BY_CLASS_PREF = "lastTemplateByClass";
/** 반별 기록 상한 — 오래 쓴 계정의 ui_prefs가 끝없이 크지 않게(넘치면 오래된 것부터 버린다). */
export const LAST_TEMPLATE_BY_CLASS_MAX = 200;
/** 템플릿 id·반 id 모양 — 기본 템플릿(`builtin:…`)·DB uuid. 그 밖의 값은 저장도 읽기도 안 한다. */
const ID_RE = /^[\w:-]{1,80}$/;

export type TemplatePrefs = { last: string | null; byClass: Readonly<Record<string, string>> };
export const EMPTY_TEMPLATE_PREFS: TemplatePrefs = { last: null, byClass: {} };

export function isTemplateIdShape(v: unknown): v is string {
  return typeof v === "string" && ID_RE.test(v);
}

function onescreenNs(uiPrefs: unknown): Record<string, unknown> | null {
  if (!uiPrefs || typeof uiPrefs !== "object" || Array.isArray(uiPrefs)) return null;
  const ns = (uiPrefs as Record<string, unknown>).onescreen;
  return ns && typeof ns === "object" && !Array.isArray(ns) ? (ns as Record<string, unknown>) : null;
}

/** `users.ui_prefs` → 템플릿 기본값(깨진 값은 버린다). */
export function readTemplatePrefs(uiPrefs: unknown): TemplatePrefs {
  const ns = onescreenNs(uiPrefs);
  if (!ns) return EMPTY_TEMPLATE_PREFS;
  const last = isTemplateIdShape(ns[LAST_TEMPLATE_PREF]) ? (ns[LAST_TEMPLATE_PREF] as string) : null;
  const raw = ns[LAST_TEMPLATE_BY_CLASS_PREF];
  const byClass: Record<string, string> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (isTemplateIdShape(k) && isTemplateIdShape(v)) byClass[k] = v;
  }
  return { last, byClass };
}

/** 고른 것을 기본값에 적는다 — 반 기록은 가장 최근 것이 맨 뒤(상한을 넘으면 앞에서 버린다). */
export function rememberTemplate(prefs: TemplatePrefs, templateId: string, classId: string | null | undefined): TemplatePrefs {
  const byClass = { ...prefs.byClass };
  if (classId && isTemplateIdShape(classId)) {
    delete byClass[classId];
    byClass[classId] = templateId;
    const keys = Object.keys(byClass);
    for (const k of keys.slice(0, Math.max(0, keys.length - LAST_TEMPLATE_BY_CLASS_MAX))) delete byClass[k];
  }
  return { last: templateId, byClass };
}

/** 이 반의 빈 행이 시작할 템플릿 — 반 기록 → (JJ가 아니면) 계정의 마지막 선택 → 없음(코드 기본 템플릿). */
export function preferredTemplateFor(prefs: TemplatePrefs, classId: string | null | undefined): string | null {
  // 숨긴 기본 템플릿(ECS 자동 둘, 2026-11-06)이 기록돼 있으면 없는 것으로 본다 — 새 행은 기본 템플릿으로.
  const byClass = classId ? prefs.byClass[classId] : undefined;
  if (byClass && !isHiddenBuiltinTemplate(byClass)) return byClass;
  return prefs.last && prefs.last !== BUILTIN_JJ_SHEET_TEMPLATE_ID && !isHiddenBuiltinTemplate(prefs.last) ? prefs.last : null;
}

export function isBuiltinTemplateId(id: string): boolean {
  return BUILTIN_ENGLISH_TEMPLATES.some((t) => t.id === id);
}

/** 행을 처음 세울 때 붙일 기본값 — **글이 없고 안 보낸, 템플릿을 고른 적 없는 영어 행**만. 아니면 null. */
export function implicitTemplateFor(
  row: { subjectKey?: string | null; classId?: string | null; templateId?: string; draft?: string | null; reportSent?: boolean | null },
  prefs: TemplatePrefs,
): string | null {
  if (row.templateId || row.subjectKey !== "english" || row.reportSent || (row.draft ?? "").trim()) return null;
  return preferredTemplateFor(prefs, row.classId);
}

/**
 * 글이 생긴 행의 기본값은 **강사의 템플릿으로 굳힌다** — 직접 타이핑·사진 넣기·보강 합치기처럼 고르기·자동작성을 거치지 않고
 * 글이 생겨도 그 행은 그 템플릿으로 쓴 것이다(안 굳히면 새로고침 뒤 다른 템플릿으로 돌아가 한마디 필수·교재 칸이 바뀐다, 적대 재리뷰).
 * 바뀐 게 없으면 같은 객체.
 */
export function settleImplicit<R extends { templateImplicit?: boolean; draft?: string }>(r: R): R {
  return r.templateImplicit && (r.draft ?? "").trim() ? { ...r, templateImplicit: undefined } : r;
}

type ImplicitRow = { templateId?: string; templateImplicit?: boolean; draft?: string; sent?: boolean };

/**
 * 기본값이 바뀌었을 때 **화면에 이미 선** 같은 반의 빈 영어 행도 따라오게 한다(안 그러면 다시 열 때까지 옛 기본값이다).
 * 대상 = `englishClassOf`가 그 반을 돌려주는 행 중 글이 없고 안 보냈고, 템플릿을 고른 적 없거나 기본값으로 붙어 있던 행.
 */
export function retargetImplicit<R extends ImplicitRow>(
  reports: Record<string, Record<string, R>>,
  englishClassOf: (studentId: string, subjectName: string) => string | null,
  classId: string,
  templateId: string,
): Record<string, Record<string, R>> {
  let changed = false;
  const out: Record<string, Record<string, R>> = {};
  for (const [sid, bySubject] of Object.entries(reports)) {
    let rowChanged = false;
    const next: Record<string, R> = {};
    for (const [name, r] of Object.entries(bySubject)) {
      const free = r.templateImplicit || !r.templateId;
      if (free && !r.sent && !(r.draft ?? "").trim() && r.templateId !== templateId && englishClassOf(sid, name) === classId) {
        next[name] = { ...r, templateId, templateImplicit: true };
        rowChanged = true;
      } else next[name] = r;
    }
    out[sid] = rowChanged ? next : bySubject;
    changed ||= rowChanged;
  }
  return changed ? out : reports;
}

/**
 * 기본값으로 붙여 둔(`templateImplicit`) 빈 행 중 `drop(templateId)`가 참인 것을 되돌린다 — 지운 사용자 템플릿·목록을 못 받은 경우.
 * 바뀐 게 없으면 **같은 객체**(리렌더 없음). 진짜 선택·글이 생긴 행은 손대지 않는다.
 */
export function revertImplicit<R extends ImplicitRow>(
  reports: Record<string, Record<string, R>>,
  drop: (templateId: string) => boolean,
): Record<string, Record<string, R>> {
  let changed = false;
  const out: Record<string, Record<string, R>> = {};
  for (const [sid, bySubject] of Object.entries(reports)) {
    let rowChanged = false;
    const next: Record<string, R> = {};
    for (const [name, r] of Object.entries(bySubject)) {
      if (r.templateImplicit && r.templateId && !(r.draft ?? "").trim() && drop(r.templateId)) {
        next[name] = { ...r, templateId: undefined, templateImplicit: undefined };
        rowChanged = true;
      } else next[name] = r;
    }
    out[sid] = rowChanged ? next : bySubject;
    changed ||= rowChanged;
  }
  return changed ? out : reports;
}
