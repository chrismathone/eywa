import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **쓰기 = 감사로그** 전수 가드 — 원장 2026-09-09 *"기능 추가·변동은 모두 감사로그"* · 2026-10-15 *"감사로그 빈틈 확인하고 추가할것"*.
 *
 * 배경: 원스크린 일괄 입력이 다른 반 16행의 진도·과제를 채웠는데(10/15 PS3A ← MS1A) 어디에도 기록이 없었다. 전수 점검에서
 * DB에 쓰는데 감사로그를 안 남기는 서버 액션이 92개 나왔다(보기 설정 · 칸 자동저장처럼 일부러 안 남기는 것 포함).
 *
 * 규칙: `"use server"` 파일의 **내보낸 함수가 DB에 직접 쓰면**(`.insert`·`.update`·`.upsert`·`.delete`·`.rpc` · 템플릿 SQL
 * `insert into`·`update … set`·`delete from`) 그 함수 안에서 감사로그를 남겨야 한다 — 기록 함수(`logAction` 등)를 부르거나,
 * 그것을 (몇 단계든) 부르는 도우미를 부르거나, `audit_logs`에 넣는다.
 * 남기지 않을 이유가 있으면 아래 `EXEMPT`에 **이유와 함께** 올린다(목록에 이유가 없는 줄은 실패).
 *
 * ⚠️ 한계: 도우미 함수 안에서만 쓰는 액션(본문에 직접 쓰기가 없는 것)은 이 가드가 못 본다 — 도우미가 쓰는 곳에서 기록할 것.
 * ⚠️ RPC가 읽기만 해도 `.rpc(`라 걸린다 — 그런 것은 EXEMPT에 '읽기'로 올린다.
 */

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

const VIEW = "보기 설정 — 계정 귀속 화면 상태(정렬·필터·글씨·접기)는 감사 대상이 아니다";
const PERSONAL = "개인 상태 — 내 알림·즐겨찾기·내 템플릿·보기 전환처럼 남에게 영향이 없는 내 것";
const CELL = "칸 자동저장 — 입력할 때마다 저장되는 작업 칸이라 건마다 남기면 감사로그가 묻힌다(일괄 동작·삭제는 따로 남긴다)";
const AI_CACHE = "AI 결과 캐시 — 버튼이 다시 만드는 요약 저장(사람이 바꾼 값이 아니다)";
const OWN_LOG = "자체 기록 — RPC나 그 행 자체가 누가·언제를 남긴다";
const READ = "읽기 — 쓰기가 없는 RPC";

/** `상대경로#함수` → 이유. 이유 없는 줄·사라진 함수는 실패한다. */
const EXEMPT: Record<string, string> = {
  // 내가 마지막에 쓴 보고서 템플릿 기억(반마다) — 내 계정 ui_prefs만 바꾼다(원장 2026-10-29 점검).
  "src/features/onescreen/server/actions.ts#setMyLastReportTemplate": PERSONAL,
  // 보기 설정
  "src/features/attendance/seat/server/monthly-prefs.ts#saveSeatMonthlyCollapsed": VIEW,
  "src/features/class-review/server/actions.ts#setMyClassReviewFilter": VIEW,
  "src/features/class-sheets/server/actions.ts#setMyEcsMonthDisplay": VIEW,
  "src/features/classes/server/list-prefs.ts#saveClassListPrefs": VIEW,
  "src/features/enrollment/server/school-prefs-actions.ts#saveSchoolStatsPrefs": VIEW,
  "src/features/grades/server/list-prefs.ts#saveGradeSortPref": VIEW,
  "src/features/inventory/server/prefs.ts#saveInventoryPrefs": VIEW,
  "src/features/onboarding/server/prefs.ts#setOnboardingDismissed": VIEW,
  "src/features/onescreen/server/actions.ts#setMyNoticeMode": VIEW,
  "src/features/onescreen/server/write-timing-actions.ts#recordReportWriteTimings": OWN_LOG, // 작성 시간 측정값 — 행에 누가·언제가 있다
  "src/features/onescreen/server/actions.ts#setMyOnescreenFontSize": VIEW,
  // 탑승 학생 시간표 "수정된 내용" 확인 — 내 계정 ui_prefs에 확인한 열쇠만 더한다(경고 접기 · 데이터 무변경, 원장 2026-10-30).
  "src/features/shuttle/server/conflict-acks.ts#ackRideConflicts": VIEW,
  "src/features/shuttle/today/server/today-prefs.ts#saveShuttleTodayPrefs": VIEW,
  "src/features/staff/list/server/list-prefs.ts#saveStaffListPrefs": VIEW,
  "src/features/students/list/server/list-prefs.ts#saveStudentListPrefs": VIEW,
  "src/features/timetable/server/view-prefs-actions.ts#saveTimetableViewPrefs": VIEW,
  // 시간표 칸 메모 상자 크기 — 내용 수정이 아니라 보는 크기(version·수정자·시각도 안 바꾼다). 내용 추가·수정·삭제는 따로 남긴다.
  "src/features/timetable-cell-memo/server/actions.ts#resizeCellMemo": VIEW,
  // 개인 상태
  "src/features/notifications/server/actions.ts#markNotificationsRead": PERSONAL,
  "src/features/notifications/server/actions.ts#archiveNotification": PERSONAL,
  "src/features/notifications/server/actions.ts#unarchiveNotification": PERSONAL,
  "src/features/notifications/server/actions.ts#deleteNotification": PERSONAL,
  "src/features/notifications/server/actions.ts#deleteAllNotifications": PERSONAL,
  "src/features/notices/server/dismiss-actions.ts#dismissNoticePopup": PERSONAL,
  "src/features/notices/server/dismiss-actions.ts#undismissNoticePopup": PERSONAL,
  "src/features/documents/server/favorite-actions.ts#setDocumentFolderFavorite": PERSONAL,
  "src/features/report-templates/server/actions.ts#saveMyReportTemplate": PERSONAL,
  "src/features/report-templates/server/actions.ts#deleteMyReportTemplate": PERSONAL,
  "src/features/onescreen/server/order-actions.ts#saveStudentOrder": PERSONAL,
  "src/features/shell/view-actions.ts#switchToTeacherView": PERSONAL,
  "src/features/shell/view-actions.ts#switchToAdminView": PERSONAL,
  "src/features/billing/server/textbook-notice-actions.ts#saveMyTextbookMent": PERSONAL,
  // 결재선 템플릿 = 본인만 읽고 쓰는 개인 메모(0213a) — 실제 결재선은 기안할 때 approval_submit에 남는다.
  "src/features/approvals/server/actions.ts#saveLineTemplate": PERSONAL,
  "src/features/approvals/server/actions.ts#deleteLineTemplate": PERSONAL,
  // 칸 자동저장 — 일괄 동작은 따로 남긴다(원스크린 = onescreen_bulk_apply · ECS 주간 복사 등)
  "src/features/onescreen/server/actions.ts#saveOnescreenSession": CELL,
  "src/features/class-sheets/server/actions.ts#upsertGoal": CELL,
  "src/features/class-sheets/server/actions.ts#upsertStudentMark": CELL,
  "src/features/class-sheets/server/actions.ts#saveMemo": CELL,
  "src/features/class-sheets/server/month-memo-actions.ts#saveMonthMemo": CELL,
  "src/features/attendance/seat/server/mark-actions.ts#setSeatJjField": CELL,
  "src/features/before-class/server/actions.ts#saveBeforeClassCheck": CELL, // 체크 칸 하나 — 누가 체크했는지는 행의 checked_by·updated_at
  "src/features/math-sheets/server/actions.ts#upsertStudentGoal": CELL,
  "src/features/meetings/server/actions.ts#updateMeetingNotepad": CELL,
  // AI 결과 캐시
  "src/features/attendance/recap/server/actions.ts#generateRecapSummary": AI_CACHE,
  // 사랑의 한마디 초안 기록(다음 초안이 고친 방식을 배우는 재료) — 강사가 실제로 저장한 보고서는 그쪽에서 남는다(원장 2026-10-29 점검).
  "src/features/onescreen/server/love-note-actions.ts#suggestLoveNote": AI_CACHE,
  "src/features/enrollment/server/prep-actions.ts#generatePrepBrief": AI_CACHE,
  // 자체 기록
  // 90일 관리: 운영 DB의 audit_onboarding_followup 트리거가 같은 트랜잭션에서
  // 학생·과목·변경된 값·updated_by를 student_onboarding_followup_events에 남긴다.
  "src/features/newcomers/server/followup-actions.ts#assignNewcomerManager": `${OWN_LOG} (onboarding_subject_audit 트리거)`,
  "src/features/newcomers/server/followup-actions.ts#submitNewcomerFeedback": `${OWN_LOG} (onboarding_feedback_audit 트리거)`,
  "src/features/newcomers/server/followup-actions.ts#reviewNewcomerFeedback": `${OWN_LOG} (onboarding_feedback_audit 트리거)`,
  // 과목 기본 담당(2026-11-11): s2_0066 onboarding_default_manager_audit 트리거가 같은 거래에서 audit_logs에
  // 실행자(updated_by)·과목·이전/새 담당자를 남긴다(newcomer_default_manager_update) — logAction은 실패를 삼킨다.
  "src/features/newcomers/server/manager-defaults-actions.ts#saveNewcomerDefaultManager": `${OWN_LOG} (onboarding_default_manager_audit 트리거가 audit_logs에 쓴다)`,
  "src/features/billing/session-terms/server/receipt-allocation-actions.ts#mergeReceiptItems": `${OWN_LOG} (edit_receipt_merge_group이 audit_logs에 쓴다)`,
  "src/features/enrollments/server/actions.ts#deleteEnrollment": `${OWN_LOG} (delete_enrollment_history가 audit_logs에 쓴다)`,
  "src/features/shuttle/parent/server/parent-departure-actions.ts#ackParentNotice": `${OWN_LOG} (확인 행 자체가 누가·언제)`,
  // 차량 위치(0383a) — 운행 중 기사 폰이 몇 초마다 회차별 최신 한 줄을 덮어쓴다(위치 기록이지 사람이 바꾼 값이 아니다).
  "src/features/shuttle/map/server/vehicle-position-actions.ts#reportVehiclePosition": CELL,
  // 이미 기록된 요청의 자동 마무리 — 해제 요청(sync_agent_manage로 남는다)을 임대가 끝난 뒤 대시보드를 열 때 확정한다.
  "src/features/sync-agent/server/actions.ts#getAgentDashboard": "자동 정리 — 이미 기록된 연동 PC 해제 요청을 임대가 끝난 뒤 확정한다",
  // 읽기
  "src/features/onescreen/server/calendar-actions.ts#getMySendCalendar": READ,
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * 주석을 지운다 — 주석 속 `insert into`·`logAction(` 같은 글이 쓰기·기록으로 읽히지 않게. **문자열·템플릿 안은 건드리지 않는다.**
 * 🔴 정규식으로 지우면 문자열 속 `"image/*"`를 주석 시작으로 읽어 다음 `*` + `/`까지 코드를 통째로 지운다 — 그 안의 쓰기가
 *    조용히 안 보인다(적대적 재리뷰 2026-10-15).
 */
function stripComments(src: string): string {
  const out: string[] = [];
  let last = 0;
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && (d === "/" || d === "*")) {
      out.push(src.slice(last, i));
      if (d === "/") while (i < n && src[i] !== "\n") i++;
      else {
        const e = src.indexOf("*/", i + 2);
        i = e < 0 ? n : e + 2;
      }
      last = i;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n && src[j] !== c && (c === "`" || src[j] !== "\n")) j += src[j] === "\\" ? 2 : 1;
      i = j + 1;
      continue;
    }
    i++;
  }
  out.push(src.slice(last));
  return out.join("");
}

type Chunk = { name: string; body: string; exportedAsync: boolean };

/**
 * 최상위 선언 조각 — 줄 맨 앞(들여쓰기 없음)의 선언 하나에서 다음 최상위 선언 직전까지. 함수 안쪽의 작은 화살표는 끊지 않는다.
 * 🔴 다음 `export async function`까지 자르면 뒤에 붙은 비공개 함수의 쓰기·기록이 앞 함수 몫이 된다(적대적 리뷰 2026-10-15).
 */
function chunksOf(src: string): Chunk[] {
  const re = /^(export\s+)?(?:default\s+)?(async\s+)?(?:function\*?\s+|const\s+|let\s+|var\s+|type\s+|interface\s+|class\s+|enum\s+)([A-Za-z0-9_$]+)/gm;
  const marks: { name: string; at: number; exportedAsync: boolean }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const head = src.slice(m.index, m.index + 200);
    const exportedAsync = !!m[1] && (!!m[2] || /^export\s+const\s+[A-Za-z0-9_$]+\s*=\s*async\b/.test(head));
    marks.push({ name: m[3], at: m.index, exportedAsync });
  }
  return marks.map((x, i) => ({ name: x.name, exportedAsync: x.exportedAsync, body: src.slice(x.at, i + 1 < marks.length ? marks[i + 1].at : src.length) }));
}

/** import한 이름 → 원래 이름(`{ a as b }`면 b → a). */
function importsOf(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from/g)) {
    for (const part of m[1].split(",")) {
      const [orig, local] = part.replace(/^\s*type\s+/, "").split(/\s+as\s+/).map((s) => s.trim());
      if (orig) out.set(local || orig, orig);
    }
  }
  return out;
}

const BASE = ["logAction", "logActionAs", "logActionAtDoor", "logSuperAdminAction", "recordSuperAdminAction", "logTenantViewActivity"];
const baseRe = new RegExp(`\\b(${BASE.join("|")})\\s*\\(`);
/** `audit_logs`에 **넣는** 것만 기록이다(읽는 조회는 아니다). */
const AUDIT_INSERT = /from\(\s*["'`]audit_logs["'`]\s*\)\s*\.insert\s*\(|insert\s+into\s+(?:public\.)?audit_logs\b/i;
/** DB 쓰기 — supabase 빌더 · RPC · postgres.js 템플릿 SQL(`insert into` · `update … set` · `delete from`) · ui_prefs 쓰기 도우미(`writeUiPrefsNs`). */
const WRITE = /\.(insert|update|upsert|delete)\s*\(|\.rpc\(\s*["'`]|\bwriteUiPrefsNs\s*\(|\binsert\s+into\s|\bupdate\s+[\w."]+\s+set\s|\bdelete\s+from\s/i;

type SrcFile = { rel: string; chunks: Chunk[]; local: Set<string>; imports: Map<string, string>; useServer: boolean };
const files: SrcFile[] = walk(SRC).map((f) => {
  const raw = fs.readFileSync(f, "utf8");
  const src = stripComments(raw);
  const chunks = chunksOf(src);
  return {
    rel: path.relative(ROOT, f).split(path.sep).join("/"),
    chunks,
    local: new Set(chunks.map((c) => c.name)),
    imports: importsOf(src),
    useServer: /^\s*["']use server["'];?/m.test(raw.slice(0, 400)),
  };
});

/**
 * 감사로그를 남기는 도우미 — 기록 함수를 부르거나 `audit_logs`에 넣는 최상위 함수, 그리고 **그런 도우미를 부르는** 함수(여러 단계).
 * 이름 맞추기는 그 파일 안에서만: 같은 파일에 정의된 이름이면 그 정의를, 아니면 import한 이름일 때 그 이름의 내보낸 도우미를 본다
 * (다른 파일의 같은 이름 `finish`·`mutate`를 기록으로 오인하지 않게).
 */
const localHelper = new Set<string>(); // `${rel}#${name}`
const exportedHelper = new Set<string>(BASE);
const callsIn = (body: string) => [...new Set([...body.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)].map((x) => x[1]))];
function logsVia(f: SrcFile, self: string, body: string): boolean {
  if (baseRe.test(body) || AUDIT_INSERT.test(body)) return true;
  return callsIn(body).some((n) => {
    if (n === self) return false;
    if (f.local.has(n)) return localHelper.has(`${f.rel}#${n}`);
    const orig = f.imports.get(n);
    return orig !== undefined && exportedHelper.has(orig);
  });
}
for (let changed = true; changed; ) {
  changed = false;
  for (const f of files) {
    for (const c of f.chunks) {
      const key = `${f.rel}#${c.name}`;
      if (localHelper.has(key)) continue;
      if (logsVia(f, c.name, c.body.slice(c.body.indexOf(c.name) + c.name.length))) {
        localHelper.add(key);
        if (/^export\s/.test(c.body)) exportedHelper.add(c.name);
        changed = true;
      }
    }
  }
}

const writers: { key: string; logged: boolean }[] = [];
for (const f of files) {
  if (!f.useServer) continue;
  for (const c of f.chunks) {
    if (!c.exportedAsync || !WRITE.test(c.body)) continue;
    writers.push({ key: `${f.rel}#${c.name}`, logged: localHelper.has(`${f.rel}#${c.name}`) });
  }
}

describe("서버 액션의 쓰기 = 감사로그(전수)", () => {
  it("스캔이 살아 있다 — 쓰기 서버 액션을 충분히 찾는다", () => {
    expect(writers.length).toBeGreaterThan(300);
  });

  it("🔴 DB에 쓰는 서버 액션은 감사로그를 남기거나, 이유와 함께 예외 목록에 있다", () => {
    const missing = writers.filter((w) => !w.logged && !EXEMPT[w.key]).map((w) => w.key);
    expect(missing, "감사로그를 남기거나(logAction) EXEMPT에 이유와 함께 올리세요").toEqual([]);
  });

  it("예외 목록은 살아 있는 것만 — 사라졌거나 이제 기록하는 함수는 목록에서 뺀다", () => {
    const byKey = new Map(writers.map((w) => [w.key, w]));
    const stale = Object.keys(EXEMPT).filter((k) => !byKey.has(k) || byKey.get(k)!.logged);
    expect(stale).toEqual([]);
  });

  it("예외에는 이유가 있다", () => {
    expect(Object.entries(EXEMPT).filter(([, why]) => !why || why.trim().length < 8).map(([k]) => k)).toEqual([]);
  });
});
