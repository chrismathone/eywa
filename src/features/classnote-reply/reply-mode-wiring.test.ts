import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classnoteReplyMode } from "@/features/owner/classnote-gate";
import { diffSettingsSection, formatSettingChange } from "@/features/owner/settings-diff";
import { DEFAULT_SETTINGS } from "@/features/owner/defaults";
import { isClassnoteReportTab, lessonReportFaces } from "@/features/report-admin/lesson-report-faces";
import { REACTION_LABELS, REACTION_TYPES, canPressReaction, canRemoveReaction, isReactionType, reactionStatusView } from "./reaction-policy";

/**
 * 학부모 글 **답글·공감** 설정(끔·시험·전체, `report.classnoteParentReplyMode`)의 배선 가드.
 * 🔴 끔이면 "있었는지조차 모르게"(원장 2026-09-30) — 버튼·면·서버 액션이 전부 같은 한 곳(`classnoteReplyMode`)을 읽고,
 *    서버 액션은 예외 없이 첫 문(`replyGate`)을 지난다. 새 액션을 더하고 그 문을 빼먹으면 이 테스트가 잡는다.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("classnoteReplyMode — 모드를 읽는 한 곳", () => {
  const s = (mode: unknown, disabled: string[] = []) => ({ modules: { disabled: disabled as never[] }, report: { classnoteParentReplyMode: mode } });

  it("끔·시험·전체만 — 모르는 값·빈 값은 끔", () => {
    expect(classnoteReplyMode(s("off"))).toBe("off");
    expect(classnoteReplyMode(s("test"))).toBe("test");
    expect(classnoteReplyMode(s("on"))).toBe("on");
    for (const bad of ["pilot", "", undefined, null, true, "ON"]) expect(classnoteReplyMode(s(bad))).toBe("off");
  });

  it("ClassNote 모듈이 꺼진 학원은 설정값이 전체로 남아 있어도 끔", () => {
    expect(classnoteReplyMode(s("on", ["classnote"]))).toBe("off");
    expect(classnoteReplyMode(s("test", ["classnote"]))).toBe("off");
    expect(classnoteReplyMode(s("on", ["eie"]))).toBe("on");
  });

  it("기본값은 끔이다(설정을 저장한 적 없는 지점엔 없는 기능)", () => {
    expect(classnoteReplyMode(DEFAULT_SETTINGS)).toBe("off");
  });

  it("설정 원시값을 읽는 곳은 게이트 한 곳뿐이다(다른 파일이 따로 읽어 모듈 꺼짐을 놓치지 않게)", () => {
    const offenders = walk(path.join(ROOT, "src"))
      .filter((f) => !f.endsWith(path.join("owner", "classnote-gate.ts")))
      .filter((f) => /report\.classnoteParentReplyMode/.test(readFileSync(f, "utf8").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")))
      .map((f) => path.relative(ROOT, f).replaceAll("\\", "/"));
    expect(offenders).toEqual([]);
  });
});

describe("끔이면 흔적이 없다", () => {
  it("수업보고서 '학부모 글·답글' 면은 모드가 시험·전체일 때만 선다", () => {
    const keys = (replyOn: boolean, classnoteOn = true, canSend = true) => lessonReportFaces({ canOwner: true, canSend, classnoteOn, replyOn }).map((f) => f.key);
    expect(keys(true)).toContain("parent_replies");
    expect(keys(false)).not.toContain("parent_replies");
    expect(keys(true, false)).not.toContain("parent_replies"); // 모듈 꺼짐
    expect(keys(true, true, false)).not.toContain("parent_replies"); // 쓰기 권한 없음
    expect(lessonReportFaces({ canOwner: true, canSend: true, classnoteOn: true }).map((f) => f.key)).not.toContain("parent_replies"); // 안 넘기면 끔
    expect(isClassnoteReportTab("parent_replies")).toBe(true);
  });

  it("페이지는 끔이면 그 면의 주소를 직접 쳐도 첫 면으로 보내고, 조회도 하지 않는다", () => {
    const page = read("src/app/(shell)/lesson-reports/page.tsx");
    expect(page).toMatch(/if \(!replyOn && t === "parent_replies"\) return "writing";/);
    expect(page).toMatch(/const replyMode = classnoteReplyMode\(tenantSettings\);/);
    expect(page).toMatch(/replyOn: replyMode !== "off"/);
    expect(page).toMatch(/listParentThreads\(\{ mode: replyMode, user: viewer \}\)/);
    expect(read("src/app/(shell)/lesson-reports/video-homework/page.tsx")).toMatch(/replyOn: classnoteReplyMode\(settings\) !== "off"/);
  });

  it("서버 액션은 전부 첫 문(replyGate)을 지난다 — 첫 문은 끔이면 '없는 기능'으로 답한다", () => {
    for (const file of ["reply-actions.ts", "reaction-actions.ts"]) {
      const src = read(`src/features/classnote-reply/server/${file}`);
      const fns = [...src.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]!);
      expect(fns.length, file).toBeGreaterThan(0);
      for (const fn of fns) {
        const body = src.slice(src.indexOf(`export async function ${fn}(`));
        const first = body.slice(body.indexOf("{\n") + 2).trimStart();
        const lines = first.split("\n").slice(0, 3).join("\n");
        expect(lines, `${file} ${fn}`).toMatch(/const g = await replyGate\((false)?\);/);
      }
    }
    const gate = read("src/features/classnote-reply/server/reply-gate.ts");
    expect(gate).toMatch(/const mode = classnoteReplyMode\(settings\);\s*if \(mode === "off"\) return \{ ok: false, error: UNAVAILABLE \};/);
    expect(gate).toMatch(/const UNAVAILABLE = "사용할 수 없는 기능입니다";/);
    // 기능 파일에 모드 상수·글자 값으로 모드를 정하는 자리가 없다(전부 첫 문이 읽은 값을 넘겨받는다).
    for (const f of walk(path.join(ROOT, "src/features/classnote-reply"))) {
      const code = readFileSync(f, "utf8").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(code, path.basename(f)).not.toMatch(/\bREPLY_MODE\b/);
      expect(code, path.basename(f)).not.toMatch(/\bmode:\s*["'](test|on)["']/);
    }
  });

  it("벨의 버튼 조회는 끔·발송 꺼짐이면 서버에서 빈 값을 돌려준다(버튼·공감 둘 다 없다)", () => {
    const src = read("src/features/classnote-reply/server/reply-actions.ts");
    expect(src).toMatch(/const none: ReplyTargets = \{ targets: \{\}, reactions: null, vague: \[\] \};/);
    expect(src).toMatch(/if \(!g\.ok \|\| !g\.sendOn \|\|[^\n]*\) return none;/);
  });
});

describe("설정 변경 감사로그 — 값을 한글로", () => {
  const before = { ...DEFAULT_SETTINGS.report };
  it("끔 → 시험 → 전체가 한글로 남는다(영문 코드를 싣지 않는다)", () => {
    const d = diffSettingsSection("report", before, { ...before, classnoteParentReplyMode: "on" });
    expect(d.changes.map(formatSettingChange)).toEqual(["학부모 글 답글·공감 끔 → 전체"]);
    const t = diffSettingsSection("report", { ...before, classnoteParentReplyMode: "on" }, { ...before, classnoteParentReplyMode: "test" });
    expect(t.changes.map(formatSettingChange)).toEqual(["학부모 글 답글·공감 전체 → 시험(학원이만)"]);
  });

  it("옛 저장분(칸 없음)에 기본값 끔이 처음 실리는 것은 변경이 아니다 · 칸 없음 → 전체는 끔 → 전체", () => {
    const { classnoteParentReplyMode: _omit, ...legacy } = before;
    void _omit;
    expect(diffSettingsSection("report", legacy, before)).toEqual({ changes: [], others: 0 });
    expect(diffSettingsSection("report", legacy, { ...before, classnoteParentReplyMode: "on" }).changes.map(formatSettingChange)).toEqual(["학부모 글 답글·공감 끔 → 전체"]);
  });
});

describe("공감 정책(순수)", () => {
  it("종류 여섯 — 한글 라벨, 모르는 종류는 받지 않는다", () => {
    expect(REACTION_TYPES).toHaveLength(6);
    for (const t of REACTION_TYPES) expect(REACTION_LABELS[t]).toMatch(/^[가-힣]+$/);
    expect(isReactionType("check")).toBe(true);
    for (const bad of ["love", "", null, 1]) expect(isReactionType(bad)).toBe(false);
  });

  it("상태는 한글 라벨 + 의미색 tone — 풀기 실패는 '눌려 있음'으로 남는다", () => {
    expect(reactionStatusView({ status: "queued" })).toMatchObject({ label: "공감 누르는 중", busy: true, pressed: false });
    expect(reactionStatusView({ status: "processing", processingAction: "remove" })).toMatchObject({ label: "공감 푸는 중", busy: true, pressed: true });
    expect(reactionStatusView({ status: "success" })).toMatchObject({ label: "공감함", tone: "positive", pressed: true, busy: false });
    expect(reactionStatusView({ status: "success", error: "x", failedAction: "remove" })).toMatchObject({ label: "공감함 · 풀기 실패", tone: "caution", pressed: true });
    expect(reactionStatusView({ status: "failed" })).toMatchObject({ tone: "critical", pressed: false });
    expect(reactionStatusView({ status: "removed" })).toMatchObject({ tone: "inert", pressed: false });
  });

  it("누르기는 기록이 없거나 못 눌렀거나 풀었을 때만 · 풀기는 누른 사람 본인·관리자급", () => {
    expect([null, "failed", "removed"].map((s) => canPressReaction(s as never))).toEqual([true, true, true]);
    expect(["queued", "processing", "success", "remove_requested"].map((s) => canPressReaction(s as never))).toEqual([false, false, false, false]);
    const base = { userId: "u1", role: "teacher", authorUserId: "u1", status: "success" as const };
    expect(canRemoveReaction(base)).toBe(true);
    expect(canRemoveReaction({ ...base, authorUserId: "u2" })).toBe(false);
    expect(canRemoveReaction({ ...base, authorUserId: "u2", role: "manager" })).toBe(true);
    expect(canRemoveReaction({ ...base, authorUserId: "u2", manager: true })).toBe(true);
    expect(canRemoveReaction({ ...base, status: "queued" })).toBe(true);
    for (const status of ["processing", "failed", "remove_requested", "removed"] as const) expect(canRemoveReaction({ ...base, status })).toBe(false);
  });

  it("🔴 '확인 필요'(요청은 나갔는데 결과를 모른다) — 실패·풀림이어도 못 눌렀다고 단정하지 않고, 대기 중엔 바로 취소하지 않는다", () => {
    expect(reactionStatusView({ status: "failed", unconfirmed: true })).toMatchObject({ label: "공감 확인 필요", tone: "caution", pressed: false, busy: false });
    expect(reactionStatusView({ status: "failed", unconfirmed: false }).label).toBe("공감하지 못함");
    expect(reactionStatusView({ status: "queued", unconfirmed: true })).toMatchObject({ label: "공감 확인 중", busy: true });
    const base = { userId: "u1", role: "teacher", authorUserId: "u1" };
    expect(canRemoveReaction({ ...base, status: "queued", unconfirmed: true })).toBe(false);
    expect(canRemoveReaction({ ...base, status: "queued", unconfirmed: true, manager: true })).toBe(false);
    expect(canRemoveReaction({ ...base, status: "success", unconfirmed: false })).toBe(true);
    // 서버 액션은 '확인 필요' 행을 다른 명의·종류로 덮어쓰지 않고 그 공감부터 다시 확인시킨다.
    const src = read("src/features/classnote-reply/server/reaction-actions.ts");
    const recheck = src.slice(src.indexOf("if (existing?.unconfirmed) {"), src.indexOf("const fields = {"));
    expect(recheck).toMatch(/status: "queued"/);
    expect(recheck).not.toMatch(/reaction_type|author_label:|author_user_id/);
    // 재확인은 요청 시각을 갱신하지 않는다(묵은 요청을 워커가 뒤늦게 누르지 않게) · 지금 누른 사람의 선택은 반영되지 않으니 성공으로 답하지 않는다.
    expect(recheck).not.toMatch(/requested_at/);
    expect(recheck).not.toMatch(/ok: true/);
    expect(recheck).toMatch(/return \{ ok: false, error: `앞서 요청한 공감/);
    // 벨의 모호한 알림에서 연 창은 서버가 공감 상태를 싣지 않는다(화면에서 숨기기만 하는 게 아니다).
    const dialog = read("src/features/classnote-reply/components/parent-reply-dialog.tsx");
    expect(dialog).toMatch(/getParentReplyContext\(id, \{ noReaction: hideReaction \}\)/);
    expect(read("src/features/classnote-reply/server/reply-actions.ts")).toMatch(/opts\?\.noReaction === true \? Promise\.resolve\(false\)/);
    expect(read("src/features/notifications/components/notification-bell.tsx")).toMatch(/hideReaction=\{replyVague\.includes\(replyMessageId\)\}/);
    // 답글: 연동 PC가 집은 적 있는 대기 행은 조건부 쓰기에서도 막는다.
    expect(read("src/features/classnote-reply/server/reply-change.ts")).toMatch(/write = write\.eq\("retry_count", 0\)\.is\("worker_host", null\)/);
    expect(src).toMatch(/if \(row\.status === "queued" && row\.unconfirmed\)\s*return \{ ok: false/);
  });
});
