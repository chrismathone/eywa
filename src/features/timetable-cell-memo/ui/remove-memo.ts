import { toast } from "sonner";
import type { CellMemo } from "../rules";
import { deleteCellMemo } from "../server/actions";
import { upsertMemo } from "./use-week-memos";

/**
 * 우클릭 '메모 삭제' — 엑셀처럼 바로 지운다(이전 내용은 감사로그에 남는다).
 * 🔴 그사이 다른 사람이 고쳤으면(version 불일치) 지우지 않고 최신을 보여 준다.
 */
export async function removeCellMemo(memo: CellMemo, col: string, apply: (update: (memos: CellMemo[]) => CellMemo[]) => void) {
  const res = await deleteCellMemo({ id: memo.id, baseVersion: memo.version, col }).catch(() => ({
    ok: false as const,
    error: "메모를 지우지 못했습니다. 인터넷 연결을 확인해 주세요.",
  }));
  if (res.ok) return apply((l) => l.filter((m) => m.id !== memo.id));
  if (!("conflict" in res) || !res.conflict) return void toast.error(res.error);
  const latest = res.latest;
  apply((l) => (latest ? upsertMemo(l, latest) : l.filter((m) => m.id !== memo.id)));
  if (latest) toast.error("다른 분이 먼저 고친 메모라 지우지 않았습니다. 최신 내용을 확인해 주세요.");
}
