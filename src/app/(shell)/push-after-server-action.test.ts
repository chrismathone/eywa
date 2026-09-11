import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 구조 가드 — **서버 액션을 await한 뒤 같은 함수 안에서 `router.push`/`router.replace`로 이동하지 않는다**(#102).
 * 액션 응답은 그 액션을 부른 현재 페이지의 RSC 트리를 다시 적용하므로, 이어 부른 클라 이동이 덮여 삼켜진다
 * (목적지를 받아 놓고 화면이 안 넘어간다 — 타입체크·테스트·빌드 어느 것도 못 잡는다). 이동은
 * `window.location.assign/replace(inFrame ? withEmbed(href) : href)`.
 *
 * 범위 = 2026-09-11 메뉴·창 이동 전수검사가 짚은 파일(ratchet). 같은 자리를 고치면 FILES에 한 줄 더한다.
 * 판정 = `"@/…/server/…"`에서 가져온 이름(클라 파일에서 server 모듈 = 서버 액션)의 `await X(` 뒤부터
 *        그 호출을 품은 **함수**가 끝날 때까지 — 그 안에 `router.push(`·`router.replace(`가 있으면 위반.
 *        (블록 끝까지만 보면 `if (…) { await … }` 다음 줄의 push를 놓친다.)
 *        다른 함수의 순수 이동(링크성 push — 예: 통합뷰 '편집 끝내기')은 함수 밖이라 안 걸린다.
 *        await 없이 `.then(() => router.push(…))`로 잇는 체인은 then 콜백 안을 따로 본다.
 * ⚠️ 한계(알고 둔다): 별칭(`const go = router.push; go(…)`)·`for await`·JSX 텍스트의 따옴표(`'`가 문자열
 *    시작으로 읽혀 셈이 흔들린다)는 못 본다 — 이 파일 목록 한정 ratchet이라 넓히지 않았다.
 */
const ROOT = join(__dirname, "..", "..", "..");
// ⚠️ 체크아웃이 CRLF일 수 있다(Windows) — 줄바꿈을 정규화한다.
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

/**
 * 주석을 지운다. `maskStrings`면 문자열·템플릿 속 글자도 공백으로 가린다 — 괄호·중괄호 셈이 문자열에
 * 흔들리지 않게(줄바꿈은 남겨 위치가 원문과 같다).
 * 🔴 정규식 두 번(블록 → 줄)으로 지우면 안 된다 — 줄 주석 속 `audio/*`가 블록 주석 시작으로 읽혀
 *    다음 `*\/`까지 코드가 통째로 사라졌다(새 회의록 폼의 await 두 개가 안 보였다). 한 번 훑으며 상태를 든다.
 */
function scrub(src: string, maskStrings = false): string {
  let out = "";
  let quote: string | null = null; // 지금 문자열 안이면 그 따옴표(', ", `)
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") {
        out += maskStrings ? "  " : c + (src[i + 1] ?? "");
        i++;
      } else if (c === quote) {
        quote = null;
        out += c;
      } else {
        out += maskStrings && c !== "\n" ? " " : c;
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const end = src.indexOf("\n", i);
      i = (end < 0 ? src.length : end) - 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = (end < 0 ? src.length : end + 2) - 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    out += c;
  }
  return out;
}

/** 클라 파일이 가져온 서버 액션 이름(`type` import 제외, `a as b`는 b). */
function serverActionNames(code: string): string[] {
  const names: string[] = [];
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*"@\/[^"]*\/server\/[^"]*"/g)) {
    for (const raw of m[1].split(",")) {
      const part = raw.trim();
      if (!part || part.startsWith("type ")) continue;
      names.push(part.split(/\s+as\s+/).pop()!.trim());
    }
  }
  return names;
}

/** 블록(함수가 아님)을 여는 머리 — `if (…) {`·`for (…) {`·`catch (e) {` 등. */
const BLOCK_HEAD = /(?:^|[^\w$])(?:if|for|while|switch|catch|with)\s*$/;

/** `close` 자리의 `)`와 짝인 `(` 위치(없으면 -1). */
function openParenOf(code: string, close: number): number {
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (code[i] === ")") depth++;
    else if (code[i] === "(" && --depth === 0) return i;
  }
  return -1;
}

/** `at`을 품은 가장 가까운 **함수 몸통**의 `{` 위치 — if/for/try/else 같은 블록은 건너 바깥으로 간다. */
function enclosingFunctionOpen(code: string, at: number): number {
  let depth = 0;
  for (let i = at - 1; i >= 0; i--) {
    if (code[i] === "}") depth++;
    else if (code[i] === "{") {
      if (depth > 0) {
        depth--;
        continue;
      }
      // 반환 타입 꼬리(`): Promise<void>`)는 벗겨 본다 — 안 벗기면 그 함수를 경계로 못 보고 바깥으로 나가
      // **다른 함수의 push**까지 셈에 넣는다(오탐).
      const head = code
        .slice(0, i)
        .trimEnd()
        .replace(/\)\s*:\s*[^(){};=]+$/, ")");
      if (head.endsWith("=>")) return i;
      if (head.endsWith(")")) {
        const open = openParenOf(head, head.length - 1);
        if (open >= 0 && !BLOCK_HEAD.test(head.slice(0, open))) return i;
      }
    }
  }
  return -1;
}

/** `open` 자리의 `{`와 짝인 `}` 위치. */
function closeBraceOf(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth === 0) return i;
  }
  return code.length;
}

/** `open` 자리의 `(`와 짝인 `)` 위치. */
function closeParenOf(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")" && --depth === 0) return i;
  }
  return code.length;
}

const NAV = /router\.(push|replace)\(/;

type Hit = { action: string; navigates: boolean };

/** 서버 액션 await마다(그리고 await 없는 `.then` 체인마다) — 그 뒤에 router.push/replace가 있는가. */
function scanAwaits(src: string): Hit[] {
  const code = scrub(src, true);
  const hits: Hit[] = [];
  for (const action of serverActionNames(scrub(src))) {
    for (const m of code.matchAll(new RegExp(`await\\s+${action}\\(`, "g"))) {
      const at = m.index!;
      const open = enclosingFunctionOpen(code, at);
      const end = open < 0 ? code.length : closeBraceOf(code, open);
      hits.push({ action, navigates: NAV.test(code.slice(at, end)) });
    }
    // await 없이 `.then(() => router.push(…))`로 잇는 같은 함정 — then 콜백 안만 본다.
    for (const m of code.matchAll(new RegExp(`(?<![\\w$.])${action}\\(`, "g"))) {
      const callEnd = closeParenOf(code, m.index! + m[0].length - 1);
      const then = /^\s*\.then\(/.exec(code.slice(callEnd + 1));
      if (!then) continue;
      const thenOpen = callEnd + then[0].length;
      hits.push({ action, navigates: NAV.test(code.slice(thenOpen, closeParenOf(code, thenOpen))) });
    }
  }
  return hits;
}

const FILES: { file: string; awaits: string[] }[] = [
  { file: "src/app/(shell)/billing/refunds/_components/refund-buttons.tsx", awaits: ["deleteRefundRequest"] },
  { file: "src/app/(shell)/staff/resumes/_components/resume-buttons.tsx", awaits: ["deleteStaffResume"] },
  {
    file: "src/app/(shell)/enrollment/_components/consultation-full-form.tsx",
    awaits: ["issueAudioUploadTicket", "createEnrollmentConsultation", "updateEnrollmentConsultation"],
  },
  {
    file: "src/app/(shell)/meetings/new/new-meeting-form.tsx",
    awaits: ["issueAudioUploadTicket", "createTextMeeting", "startMeetingFromAudio"],
  },
  {
    file: "src/app/(shell)/timetable/_components/integrated-edit-board.tsx",
    awaits: ["saveIntegrationGroups", "saveTimetableViewPrefs"],
  },
];

describe("서버 액션 뒤 router.push/replace 금지(#102)", () => {
  it.each(FILES)("$file", ({ file, awaits }) => {
    const src = read(file);
    const hits = scanAwaits(src);
    // 판정기가 살아 있는지 — 찾아야 할 await를 못 찾으면 아래 '위반 0'은 아무 뜻이 없다.
    expect(hits.map((h) => h.action)).toEqual(expect.arrayContaining(awaits));
    expect(
      hits.filter((h) => h.navigates).map((h) => h.action),
      `${file}: 서버 액션 뒤 같은 함수에서 router.push/replace — window.location.assign/replace로(#102)`,
    ).toEqual([]);
    // 대신 쓰는 이동은 창 안이면 embed를 유지한다(빠뜨리면 그 이동만 풀 셸로 서버 렌더된다). 주석은 빼고 본다.
    const code = scrub(src);
    expect(code).toMatch(/window\.location\.(assign|replace)\(/);
    expect(code).toContain("inFrame ? withEmbed(");
  });

  it("판정기 자체 — 옛 모양·블록 밖 push·replace·then 체인은 잡고, 다른 함수의 순수 이동·주석·문자열은 안 잡는다", () => {
    // 반환 타입이 붙은 함수도 함수 경계다 — 못 보면 바깥으로 나가 다른 함수의 push를 오탐한다.
    const typed = `import { saveX } from "@/features/x/server/actions";
      async function onSave(): Promise<void> {
        await saveX();
        window.location.assign("/x");
      }
      function other() { router.push("/y"); }`;
    expect(scanAwaits(typed)).toEqual([{ action: "saveX", navigates: false }]);

    // await 없는 then 체인도 같은 함정이다.
    const chained = `import { saveX } from "@/features/x/server/actions";
      function onClick() { saveX().then(() => router.push("/x")); }`;
    expect(scanAwaits(chained)).toEqual([{ action: "saveX", navigates: true }]);

    const old = `import { deleteRefundRequest } from "@/features/billing/server/refund-actions";
      const onClick = async () => {
        const res = await deleteRefundRequest(id);
        if (res.error) { toast.error(res.error); return; }
        router.push("/billing?tab=refunds");
      };`;
    expect(scanAwaits(old)).toEqual([{ action: "deleteRefundRequest", navigates: true }]);

    // 블록 끝까지만 보면 놓치는 모양 — await는 if 안, 이동은 그 밖(같은 함수). replace도 같은 함정이다.
    const afterBlock = `import { createTextMeeting } from "@/features/meetings/server/actions";
      async function submit() {
        if (ok) {
          await createTextMeeting(undefined, fd);
        }
        router.replace("/meetings");
      }`;
    expect(scanAwaits(afterBlock)).toEqual([{ action: "createTextMeeting", navigates: true }]);

    const fine = `import { saveIntegrationGroups } from "@/features/owner/server/subject-actions";
      function save() {
        // 서버 allowCT(audio/*)에 막힘 — 줄 주석 속 '/*'가 블록 주석으로 읽히면 아래 await가 사라진다
        startSave(async () => {
          const res = await saveIntegrationGroups({ subject, url: "https://x.test//y /* 주석 아님 */ {" });
          // router.push(doneHref) 는 삼켜진다
          window.location.assign(inFrame ? withEmbed(doneHref) : doneHref);
        });
      }
      function leave() { router.push(doneHref, { scroll: false }); }`;
    expect(scanAwaits(fine)).toEqual([{ action: "saveIntegrationGroups", navigates: false }]);
  });
});
