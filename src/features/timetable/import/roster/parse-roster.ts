// **통합 영어시간표 탭의 반별 학생 명단 파서** — 순수 함수(Vitest).
//
// 배경(원장 2026-08-28~29): 마스터 시트의 `강사별` 탭엔 명단이 없어서 컷오버가 **배치만** 옮겼다.
// 원장 확인 *"통합영어시간표(9월)에 학생 명단이 있음. 학생 명단을 보고 학생도 전부 이동시켜야함."*
//
// 시트 모양(실측 2026-08-29, 44반·237명):
//   · 반 블록은 **5열 폭**(월화수목금)이고 한 밴드에 여러 블록이 가로로 늘어선다.
//   · 블록 머리 = 그 블록 첫 열의 `반이름 요일 시각 (강사)` 한 칸(병합이라 앵커에만 글자가 있다).
//   · 머리 아래 교시 행(강사·강의실) → **학생 명단** → `정원` 행 → `인원` 행 순.
//   · 명단 줄은 첫 열에 이름, **네 번째 열(+3)** 에 `침산초1` 같은 학교+학년.
//
// 🔴 교시 행을 학생으로 읽지 말 것 — 교시 행도 B열에 번호(1·2·3·4)가 있어서 번호만 보면 `Anna 605`가
//    학생이 된다. **A열에 시각이 있으면 교시 행**이다(명단 줄의 A열은 비어 있다).
// 🔴 검산이 안전벨트다 — 파싱 인원이 시트의 `인원` 칸과 다르면 **적용을 중단**해야 한다.
//    computeImportDiff는 시트를 그 과목 전 수강의 진실로 보므로(diff.ts), 한 반을 놓치면
//    **그 반 전원이 종료 후보**가 된다. 숫자가 맞는지는 시트 자신이 알려 준다.

/** 명단 한 줄. `school`·`grade`는 DB 표기로 갈라 둔다(시트는 `침산초1`처럼 붙어 있다). */
export interface RosterEntry {
  /** 시트에 적힌 그대로(영어 닉네임 괄호는 제거). */
  name: string;
  school: string | null;
  grade: string | null;
  /** 원본 셀 — 보고서에서 사람이 되짚을 때 쓴다. */
  raw: string;
}

export interface RosterBlock {
  className: string;
  /** 시트 `인원` 칸의 숫자(시트가 스스로 센 값). */
  declared: number;
  entries: RosterEntry[];
}

export interface RosterParseResult {
  blocks: RosterBlock[];
  /** 파싱 인원 ≠ `인원` 칸. **비어 있지 않으면 적용하지 말 것.** */
  mismatches: { className: string; parsed: number; declared: number }[];
}

/** 블록 폭(월화수목금). 명단의 학교 칸은 이 안에서 `+3`(목요일 자리)에 적힌다. */
const BLOCK_WIDTH = 5;
const SCHOOL_COL_OFFSET = 3;

/** 셀 정리 — 줄바꿈·연속 공백을 한 칸으로. */
const clean = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();

/**
 * `침산초1` → `{ school: "침산초", grade: "초1" }`.
 * DB는 학교와 학년을 나눠 갖고 학년은 `초3`·`중1`·`고2` 꼴이다(실측). 시트는 붙여 쓴다.
 * ⚠️ 학교 이름 끝 글자(초·중·고)가 곧 학년 접두사다 — `경명여중1`은 `경명여중`+`중1`.
 * 모양이 아니면 **school만** 돌려준다(억지로 가르면 없는 학년을 만든다).
 */
export function splitSchoolGrade(raw: string): { school: string | null; grade: string | null } {
  const s = clean(raw);
  if (!s) return { school: null, grade: null };
  // 끝의 숫자는 **언제나 학년**이다(학교 이름이 숫자로 끝나지 않는다) → 먼저 뗀다.
  const m = s.match(/^(.*?)\s*(\d{1,2})$/);
  if (!m) return { school: s, grade: null };
  const school = m[1]!.trim();
  if (!school) return { school: s, grade: null };
  // 학년 접두사는 학교 끝 글자에서 온다. 🔴 실업계(`경북여상2` → DB `경북여상`/`고2`)처럼 초·중·고가
  // 아니면 **학년은 비운다** — `상2` 같은 없는 학년을 지어내면 매칭이 오히려 틀어진다. 숫자는 뗀 채로
  // 학교만 돌려주는 것이 정직하고, 매칭은 이름+학교로 좁힌다.
  const kind = school.slice(-1);
  return { school, grade: "초중고".includes(kind) ? `${kind}${Number(m[2])}` : null };
}

/** 반 이름만 남긴다 — `PL1a 매일 2:20~3:40 (Anna)` → `PL1a`. */
export function classNameFromHeader(header: string): string {
  return clean(header)
    .replace(/\s*[(（].*$/, "")
    .replace(/\s+(매일|월|화|수|목|금|토|일)\S*.*$/, "")
    .trim();
}

/** 영어 닉네임 괄호 제거 — `김하윤C(Hanny)` → `김하윤C`. */
export function stripNickname(name: string): string {
  return clean(name).replace(/\s*[(（][^)）]*[)）]\s*/g, " ").trim();
}

/** 블록 머리인가 — 반 이름 + 시각이 한 칸에 적힌 앵커 셀. */
const isBlockHeader = (v: string): boolean => /\d\s*:\s*\d/.test(v) && clean(v).length > 3;

/**
 * 통합 탭 그리드 → 반별 명단.
 *
 * `cells`는 병합이 앵커에만 남은 형태를 전제한다(master-cutover의 그리드 빌더와 동일).
 * 열은 0부터. 블록 머리는 2번째 열부터 찾는다(0=시각·1=번호는 표의 축이다).
 */
export function parseIntegratedRoster(cells: readonly (readonly string[])[]): RosterParseResult {
  const at = (r: number, c: number): string => clean(cells[r]?.[c]);
  const blocks: RosterBlock[] = [];

  for (let r = 0; r < cells.length; r++) {
    const width = cells[r]?.length ?? 0;
    for (let c = 2; c < width; c++) {
      const head = at(r, c);
      if (!isBlockHeader(head)) continue;

      // `정원` 행이 명단의 끝. 못 찾으면 이 블록은 명단이 없는 것으로 본다(머리만 있는 칸).
      let capRow = -1;
      for (let i = r + 1; i < Math.min(r + 40, cells.length); i++) {
        if (at(i, 1) === "정원") {
          capRow = i;
          break;
        }
      }
      if (capRow < 0) continue;

      const entries: RosterEntry[] = [];
      for (let i = r + 1; i < capRow; i++) {
        // 🔴 A열에 시각이 있으면 교시 행(강사·강의실)이다 — 명단이 아니다.
        if (at(i, 0)) continue;
        // 명단 줄은 B열에 순번이 있다(빈 줄·구분선 제외).
        if (!/^\d+$/.test(at(i, 1))) continue;
        const raw = at(i, c);
        if (!raw) continue;
        entries.push({
          name: stripNickname(raw),
          raw,
          ...splitSchoolGrade(at(i, c + SCHOOL_COL_OFFSET)),
        });
      }

      blocks.push({
        className: classNameFromHeader(head),
        declared: Number(at(capRow + 1, c)) || 0,
        entries,
      });

      // 이 블록의 나머지 열은 건너뛴다(머리는 앵커에만 있으므로 실제로는 안 걸리지만, 명시적으로).
      c += BLOCK_WIDTH - 1;
    }
  }

  const mismatches = blocks
    .filter((b) => b.entries.length !== b.declared)
    .map((b) => ({ className: b.className, parsed: b.entries.length, declared: b.declared }));

  return { blocks, mismatches };
}
