/**
 * 결석 위험 14일 창의 **기준일이 미래로 밀리지 않게** 지키는 회귀 가드(0220a).
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
import { describe, expect, it } from "vitest";
import { migrationFiles } from "@/lib/db/migrations-corpus.mjs";

/** 오늘(KST) 상한 — 마이그레이션에 이 모양 그대로 들어 있어야 한다. */
const KST_CAP = /session_date\s*<=\s*\(now\(\) at time zone 'Asia\/Seoul'\)::date/;

/**
 * 그 함수를 정의하는 마이그레이션 중 **번호가 가장 큰** 파일(= 현재 유효한 정의).
 *
 * 🔴 **주석을 걷어내고 돌려준다.** 이 파일들은 배경 설명이 길어 산문에 적힌 `max(session_date)`까지
 *    검사 대상이 된다(이 가드를 처음 짤 때 실제로 자기 설명문에 걸렸다). 봐야 할 건 실행되는 SQL뿐이다.
 */
function newestDefining(fnSignature: string): { file: string; sql: string } {
  // 적용 순서(시즌1 합본 구역 → 시즌2 파일) — 마지막이 현재 유효한 정의.
  const hits = migrationFiles().filter((f) => stripComments(f.sql).includes(fnSignature));
  const hit = hits[hits.length - 1];
  expect(hit, `${fnSignature} 를 정의하는 마이그레이션이 없다`).toBeTruthy();
  return { file: hit!.name, sql: stripComments(hit!.sql) };
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

    /**
     * 세는 단위 = **반·하루**(0221a, 원장 선택 'B'). 0196a 이후 영어는 교시마다 행이 남아서 그냥 세면
     * 같은 하루가 2~3회가 된다(실측 배수 2.19 — 수학은 1.00). 그 탓에 **하루 결석 1회인 학생 9명이
     * "반복 결석 위험"으로 원장 대시보드·강사 알림에 올라와 있었다.**
     *
     * ⚠️ `effective`의 `distinct on (…, slot_start)`는 세는 단위가 아니라 "교시별 최신 정정 1건"을
     *    고르는 장치다 — 그건 그대로 두고 **집계만** 반·하루로 센다.
     */
    it(`${name} — 결석 횟수를 교시가 아니라 반·하루로 센다`, () => {
      const { file, sql } = newestDefining(sig);
      const perClassDay = /count\(distinct \(a\.class_id, a\.session_date\)\)/;
      expect(sql, `${file}: 집계가 반·하루 단위가 아니다 — 영어만 2.19배로 부푼다`).toMatch(perClassDay);
      // having까지 같은 셈법이어야 한다(select만 바꾸면 문턱은 여전히 교시 수로 걸린다).
      expect(sql, `${file}: having이 count(*) 그대로다 — 문턱이 교시 수로 걸린다`).not.toMatch(
        /having\s+count\(\*\)/,
      );
    });
  }
});
