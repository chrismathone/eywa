/**
 * **메모 툴팁 = 카드** 배선 가드(원장 2026-09-15 *"왠만하면 모든 곳의 메모는 시간표에서 사진올린것처럼 생기면
 * 좋겠네. 그냥 메모처럼하니까 너무 보기가 불편하다랄까?"*).
 *
 * 문구가 아니라 **배선**을 잠근다: ① 옮긴 표면이 `data-tip`(카드)을 쓰는지 ② 그 자리에 브라우저 기본 툴팁이
 * 되살아나지 않았는지 ③ 카드 레이어가 문서마다 한 장 서 있는지 ④ 카드 껍데기가 시간표 카드와 같은 곳에서 오는지.
 *
 * ⚠️ 여기 목록은 **메모·사유**를 띄우던 자리다 — 잘린 글자를 펼쳐 보이는 `title`(이름·열 제목)은 대상이 아니다
 *    (그건 메모가 아니라 같은 글자의 전문이다).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
/** 주석은 규칙을 **설명**하는 자리라 검사에서 뺀다(경고 주석이 위반으로 걸리면 안 된다). */
/** 예외 표식(`tip-guard:allow`)만은 자리를 남긴다 — 그 아래 `title=`은 검사에서 빠진다. */
const ALLOW_MARK = "TIP_GUARD_ALLOW";
const strip = (s: string) =>
  s
    .replace(/^[ \t]*\/\/.*tip-guard:allow.*$/gm, ALLOW_MARK)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

/** 메모·사유를 카드로 띄우는 표면 — [파일, 그 파일에서 카드에 실리는 값]. */
const CARD_SURFACES: [string, string][] = [
  ["app/(shell)/attendance/_components/attendance-cell.tsx", "att.tip.memo"],
  ["app/(shell)/attendance/seat/[seat]/_components/seat-jj-table.tsx", "tipProps(noteTitle)"],
  ["app/(shell)/attendance/seat/[seat]/_components/seat-lab-grid.tsx", "tipProps(noteTitle)"],
  ["app/(shell)/timetable/_components/reserved-section.tsx", "reservationTipRows(r)"],
  ["app/(shell)/timetable/_components/rich-card-group.tsx", "tipProps(note)"],
  ["app/(shell)/timetable/_components/teacher-chip.tsx", "tipProps(offAxisNote)"],
  ["features/class-sheets/components/attendance-check.tsx", 'att.tip.reason"), note'],
  ["app/(shell)/billing/_components/billing-table.tsx", "tipProps(r.notes)"],
  ["app/(shell)/classes/page.tsx", "tipProps(c.notes)"],
  ["app/(shell)/inventory/_components/asset-columns.tsx", "tipProps(a.note)"],
  ["app/(shell)/inventory/_components/loans-face.tsx", "tipProps(l.note)"],
  ["app/(shell)/students/[id]/_tabs/attendance-panels.tsx", "record.note]"],
  ["app/(shell)/staff/leaves/_client.tsx", "tipProps(l.reason)"],
  ["features/integrations/components/makeedu-push-card.tsx", "tipProps(c.note)"],
  ["app/(shell)/withdrawal-reports/_components/report-list.tsx", "tipProps(r.reason.note)"],
  ["app/(shell)/lesson-reports/_components/rating-cell.tsx", "tipProps(ratingTipCard(rating))"],
  ["app/(shell)/withdrawals/_components/report-date-badge.tsx", 'title: "퇴원보고서 날짜"'],
  // 역할·권한 표 줄 설명(2026-11-12 — 줄 아래에 펼쳐 두던 것을 카드로)
  ["app/(shell)/owner/_components/role-matrix-table.tsx", "tipProps({ title: item.label, lines: [item.note]"],
];

/**
 * 메모를 **브라우저 기본 툴팁**으로 되돌린 자리를 찾는다 — 목록 검사와 전수 검사가 **같은 판정**을 쓴다
 * (재리뷰 2026-09-15: 둘이 규칙을 따로 들고 있어 한쪽이 정상이라고 본 패턴을 다른 쪽이 위반으로 잡았다).
 *
 * 🔑 가르는 기준은 **메모가 어느 자리에 있나**다:
 *   · `title={noteTitle ? undefined : s.name}` = 메모는 **조건**, 값은 이름 → 정상(카드가 없을 때만 기본 툴팁).
 *   · `title={r.note}` · `` title={`할인 사유: ${r.discountReason}`} `` = 메모가 **값** → 위반(카드로 옮길 것).
 * 🔴 `??`·`?.`를 삼항 물음표로 오인하지 말 것(3차 재리뷰) — `title={noteTitle ?? undefined}`가 통째로 새어
 *    나갔다. 마스킹은 **길이를 보존**해야 원본 인덱스가 맞는다.
 * 🔴 중첩 삼항의 **값 쪽도 다시 벗긴다** — `a ? b : note ? x : y`에서 `note`는 조건이라 정상이다.
 * ⚠️ 글자 리터럴은 판정에서 뺀다 — `"우클릭: 특이사항·사유 입력"` 같은 **안내문**은 메모가 아니다(템플릿의
 *    `${…}` 안 표현식은 남긴다 — 거기 메모가 들어온다).
 * ⚠️ `title={ … }`는 **중괄호 균형**으로 끊는다(`[^}]*`는 `${…}`·객체 리터럴의 첫 `}`에서 멈춰 그 뒤를 못 봤다).
 * ⚠️ **예외**: 바로 위 줄에 `// tip-guard:allow`를 적으면 건너뛴다 — **잘린 같은 글자**의 전문을 펼치는
 *    `title`(화면에 이미 보이는 이름·라벨)은 메모가 아니다. 그 한 줄이 곧 "왜 카드가 아닌지"의 기록이다.
 * ⚠️ **범위는 `tipProps(`를 쓰는 파일뿐**이다(전수 스캔) — 카드를 한 번도 안 쓰는 새 화면이 메모 `title`을 달면
 *    여기선 안 걸린다. 그 화면을 카드로 옮길 때 `CARD_SURFACES`에 한 줄 더하는 것이 이 가드의 사용법이다.
 */
const MEMO_TOKEN = /(note|memo|reason|사유|메모|특이사항)/i;

/** `title={` 뒤부터 **중괄호 균형**이 맞는 곳까지 — 여러 줄·중첩 중괄호를 그대로 담는다. */
function titleExpressions(src: string): { expr: string; at: number }[] {
  const key = "title={";
  const out: { expr: string; at: number }[] = [];
  for (let i = src.indexOf(key); i !== -1; i = src.indexOf(key, i + key.length)) {
    let depth = 1;
    let j = i + key.length;
    while (j < src.length && depth > 0) {
      const c = src[j];
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      j += 1;
    }
    out.push({ expr: src.slice(i + key.length, depth === 0 ? j - 1 : j), at: i });
  }
  return out;
}

/** 삼항을 벗겨 **값이 되는 조각들**만 남긴다(조건은 버린다). 중첩 삼항이면 그 값도 다시 벗긴다. */
function valueParts(expr: string): string[] {
  // 🔴 `??`·`?.`를 같은 길이 공백으로 가려 삼항 물음표만 남긴다(인덱스가 원본과 맞아야 한다).
  const masked = expr.replace(/\?\?|\?\./g, "  ");
  const q = masked.indexOf("?");
  if (q === -1) return [expr];
  let depth = 0;
  let colon = -1;
  for (let i = q + 1; i < masked.length; i += 1) {
    const c = masked[i];
    if (c === "?") depth += 1;
    else if (c === ":") {
      if (depth === 0) {
        colon = i;
        break;
      }
      depth -= 1;
    }
  }
  const whenTrue = colon === -1 ? expr.slice(q + 1) : expr.slice(q + 1, colon);
  const whenFalse = colon === -1 ? "" : expr.slice(colon + 1);
  return [...valueParts(whenTrue), ...valueParts(whenFalse)];
}

function withoutText(expr: string): string {
  return expr
    .replace(/`[^`]*`/g, (lit) => [...lit.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]).join(" "))
    .replace(/"[^"]*"/g, '""')
    .replace(/'[^']*'/g, "''");
}

export function memoTitleOffenders(src: string): string[] {
  const out: string[] = [];
  for (const { expr, at } of titleExpressions(src)) {
    const values = valueParts(expr).join(" ");
    // This formatter translates system-generated timetable copy; its arguments still need the memo check.
    if (!MEMO_TOKEN.test(withoutText(values).replace(/\bdisplay\.note(?=\s*\()/g, "generatedCopy"))) continue;
    // 🔴 예외 표식은 **바로 위**에서만 유효하다 — 사이에 다른 `title=`이 끼면 그 표식은 이 줄의 것이 아니다.
    const before = src.slice(Math.max(0, at - 200), at);
    const mark = before.lastIndexOf(ALLOW_MARK);
    if (mark !== -1 && !before.slice(mark).includes("title={")) continue;
    out.push(expr.replace(/\s+/g, " ").trim());
  }
  return out;
}

/**
 * 판정 자체를 잠근다 — 이 함수가 헐거우면 위의 두 검사가 **조용히 아무것도 안 잡는다**(재리뷰가 두 번 잡은 자리).
 */
describe("memoTitleOffenders — 메모가 값이면 위반, 조건이면 정상", () => {
  const flag = (src: string) => memoTitleOffenders(src).length > 0;
  /** 테스트 입력의 줄바꿈 — 소스에 진짜 개행을 적으면 문자열이 끊긴다. */
  const NL = String.fromCharCode(10);

  it("값이 메모면 잡는다", () => {
    expect(flag("title={r.note}")).toBe(true);
    expect(flag("title={`할인 사유: ${r.discountReason}`}")).toBe(true);
    expect(flag("title={cond && note}")).toBe(true);
    expect(flag("title={makeTitle(note)}")).toBe(true);
    expect(flag("title={display.note(r.note)}")).toBe(true);
  });

  it("🔴 `??`·`?.`를 삼항으로 오인하지 않는다(3차 재리뷰가 잡은 새는 구멍)", () => {
    expect(flag("title={noteTitle ?? undefined}")).toBe(true);
    expect(flag("title={note ?? fallback}")).toBe(true);
    expect(flag("title={r?.note ? undefined : s.name}")).toBe(false);
  });

  it("조건에만 있으면 정상 — 중첩 삼항의 조건도 마찬가지", () => {
    expect(flag("title={noteTitle ? undefined : s.name}")).toBe(false);
    expect(flag("title={a ? b : note ? x : y}")).toBe(false);
    expect(flag("title={moveTitle ? display.note(moveTitle) : shownName}")).toBe(false);
    expect(flag('title={showReason && !readOnly ? "우클릭: 특이사항·사유 입력" : undefined}')).toBe(false);
  });

  it("예외 표식이 바로 위에 있으면 건너뛴다 — 잘린 글자의 전문은 메모가 아니다", () => {
    expect(flag(strip("// tip-guard:allow" + NL + "title={`${a} ${item.reason}`}"))).toBe(false);
    expect(flag(strip("// tip-guard:allow" + NL + "title={x}" + NL + "title={item.reason}"))).toBe(true);
  });

  it("🔴 값 앞에 중괄호가 있어도 그 뒤를 본다(`[^}]*`는 첫 `}`에서 끊겼다)", () => {
    expect(flag("title={fmt({ a: 1 }) + note}")).toBe(true);
    expect(flag("title={`${row.label} ${r.note}`}")).toBe(true);
    expect(flag("title={" + NL + "  cond ? undefined : note" + NL + "}")).toBe(true);
  });
});

describe("메모는 카드로 뜬다 — 브라우저 기본 툴팁으로 되돌리지 않는다", () => {
  it.each(CARD_SURFACES)("%s", (rel, needle) => {
    const src = strip(read(rel));
    expect(src, rel).toContain(needle);
    // 🔴 같은 값에 `title`을 함께 달면 카드 옆에 회색 메모 상자가 겹쳐 뜬다 — 고치려던 그 모양이다.
    expect(memoTitleOffenders(src), rel).toEqual([]);
  });

  it("🔴 카드를 쓰는 파일엔 메모 `title`이 남아 있지 않다 — **목록 밖까지 전수**(목록은 사람이 빠뜨린다)", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".tsx") || entry.name.endsWith(".test.tsx")) continue;
        const src = strip(readFileSync(full, "utf8"));
        if (!src.includes("tipProps(")) continue;
        for (const hit of memoTitleOffenders(src)) offenders.push(`${full.slice(SRC.length + 1)}: ${hit}`);
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });

  it("카드 레이어는 **문서마다 한 장**(루트 프로바이더) — 창=iframe이라 창마다 한 장이 된다", () => {
    const providers = strip(read("lib/providers/app-providers.tsx"));
    expect(providers).toContain("<HoverTipLayer />");
    expect(providers).toContain("@/components/hover-tip/hover-tip-layer");
  });

  it("카드 껍데기는 시간표 hover 카드와 **같은 곳**에서 온다(둘이 갈리면 같은 화면에 두 모양이 뜬다)", () => {
    const layer = strip(read("components/hover-tip/hover-tip-layer.tsx"));
    const timetable = strip(read("app/(shell)/timetable/_components/hover-cards.tsx"));
    for (const src of [layer, timetable]) {
      expect(src).toContain("HOVER_CARD_SHELL");
      // 레이어는 같은 폴더라 상대 경로, 화면은 별칭 — 경로 모양이 아니라 **같은 모듈**인지를 본다.
      expect(src).toContain("card-style");
    }
    // 껍데기 클래스를 화면 파일에 손으로 다시 적지 않는다.
    expect(timetable).not.toContain("shadow-modal rounded-lg border p-3");
  });

  it("🔴 학생 줄의 자리 고정은 **카드 줄**이다 — 줄이 이미 카드를 띄우므로 표식에 툴팁을 달면 겹친다", () => {
    const rows = strip(read("app/(shell)/timetable/_components/student-rows.tsx"));
    const rich = strip(read("app/(shell)/timetable/_components/rich-card-group.tsx"));
    expect(rows).toContain("pinNote={student.seatPinNote}");
    expect(rich).toContain("pinNote={s.seatPinNote}");
    expect(rows).not.toContain("title={pinNote}");
    expect(rich).not.toContain("title={s.seatPinNote");
    expect(strip(read("app/(shell)/timetable/_components/hover-cards.tsx"))).toContain('<Row label={tt("자리")} value={display.note(pinNote)} />');
  });
});
