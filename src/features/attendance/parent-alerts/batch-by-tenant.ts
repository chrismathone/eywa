/**
 * 미분류 학부모 연락을 **지점별로** 끊어 배치로 만든다(순수).
 *
 * 왜(감사 2026-09-21, 원장 "AI 및 워커도 지점 분리"): 분류기는 admin 클라이언트로 전 지점의 미분류 행을 한 번에 읽는다.
 * 그대로 N개씩 자르면 한 배치(= AI 프롬프트 한 장)에 두 지점의 학부모 글이 섞이고, 사용량은 **첫 행의 지점**으로만 찍힌다
 * (`ai_usage_logs.tenant_id`). 배치를 지점 경계에서 끊으면 프롬프트도, 비용 귀속도 지점마다 따로 선다.
 * 순서는 지점 안에서 입력 순서 그대로(오래된 글 먼저) · 지점이 없는 행(null)은 자기들끼리 한 묶음.
 */
export function batchesByTenant<T extends { tenant_id: string | null }>(rows: readonly T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const key = r.tenant_id ?? "";
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  const out: T[][] = [];
  for (const g of groups.values()) {
    for (let i = 0; i < g.length; i += n) out.push(g.slice(i, i + n));
  }
  return out;
}
