/**
 * 결석 위험 14일 창의 **기준일이 미래로 밀리지 않게** 지키는 회귀 가드(0219a).
 *
 * 배경(원장 2026-08-18 제보로 발견): 출석부는 미래 날짜 입력을 **의도적으로 허용**한다("여행" 결석을
 * 미리 찍는 운영). 그런데 `dashboard_absence_risk*`의 anchor가 `max(session_date)`라 오늘 상한이 없었고,
 * 미리 찍은 8/21 한 줄이 14일 창을 통째로 앞으로 밀어 **결석 위험 31명 → 13명**이 됐다(실측).
 * 그 함수를 대시보드 위젯·일일 브리핑·**결석 마일스톤 알림**이 함께 쓰므로, 진짜 위험한 학생이 조용히
 * 사라지고 여행 가는 학생에게 "반복 결석 위험" 알림이 나간다.
 *
 * 🔑 이 가드가 보는 건 **가장 최근 정의**뿐이다 — 옛 마이그레이션(0039a·0110a·0114a·0198a)은 역사라
 *    고치지 않는다. 나중에 누가 이 함수를 다시 정의하면서 상한을 빠뜨리면 여기서 걸려야 한다.
 * ⚠️ `current_date`는 답이 아니다 — 이 DB의 timezone은 UTC라 KST 00~09시에 하루 어긋난다(0124a 선례).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "supabase/migrations");

/** 오늘(KST) 상한 — 마이그레이션에 이 모양 그대로 들어 있어야 한다. */
const KST_CAP = /session_date\s*<=\s*\(now\(\) at time zone 'Asia\/Seoul'\)::date/;

/**
 * 그 함수를 정의하는 마이그레이션 중 **번호가 가장 큰** 파일(= 현재 유효한 정의).
 *
 * 🔴 **주석을 걷어내고 돌려준다.** 이 파일들은 배경 설명이 길어 산문에 적힌 `max(session_date)`까지
 *    검사 대상이 된다(이 가드를 처음 짤 때 실제로 자기 설명문에 걸렸다). 봐야 할 건 실행되는 SQL뿐이다.
 */
function newestDefining(fnSignature: string): { file: string; sql: string } {
  const hits = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => stripComments(readFileSync(join(DIR, f), "utf8")).includes(fnSignature))
    .sort(); // 파일명이 0000-패딩이라 사전순 = 번호순
  const file = hits[hits.length - 1];
  expect(file, `${fnSignature} 를 정의하는 마이그레이션이 없다`).toBeTruthy();
  return { file: file!, sql: stripComments(readFileSync(join(DIR, file!), "utf8")) };
}

/** `--` 줄 주석 제거(문자열 안의 `--`는 이 파일들에 없다 — 있으면 그때 파서를 쓸 것). */
function stripComments(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

const FNS = [
  {
    sig: "create or replace function public.dashboard_absence_risk(p_min int default 3)",
    name: "dashboard_absence_risk",
  },
  {
    sig: "create or replace function public.dashboard_absence_risk_admin(p_min int, p_tenant uuid)",
    name: "dashboard_absence_risk_admin",
  },
];

describe("결석 위험 anchor", () => {
  for (const { sig, name } of FNS) {
    it(`${name} — 현재 정의의 anchor에 오늘(KST) 상한이 있다`, () => {
      const { file, sql } = newestDefining(sig);
      // anchor의 `max(session_date)`마다 **그 뒤 300자 안**에 상한이 있어야 한다.
      // ⚠️ 정규식으로 괄호 균형을 맞추려다 첫 `)`에서 끊겨 헛통과한 적이 있다 → 고정 길이로 자른다.
      const spots: number[] = [];
      for (let i = sql.indexOf("max(session_date)"); i >= 0; i = sql.indexOf("max(session_date)", i + 1)) {
        spots.push(i);
      }
      expect(spots.length, `${file}: anchor 블록을 못 찾았다`).toBeGreaterThan(0);
      for (const at of spots) {
        expect(
          sql.slice(at, at + 300),
          `${file}: anchor에 오늘 상한이 없다 — 미리 찍은 미래 결석이 14일 창을 민다`,
        ).toMatch(KST_CAP);
      }
    });

    it(`${name} — current_date로 오늘을 잡지 않는다(DB timezone이 UTC라 KST 00~09시에 어긋난다)`, () => {
      const { file, sql } = newestDefining(sig);
      const at = sql.indexOf("max(session_date)");
      expect(sql.slice(at, at + 300), `${file}: anchor에 current_date를 쓰면 안 된다`).not.toMatch(
        /session_date\s*<=\s*current_date/,
      );
    });
  }
});
