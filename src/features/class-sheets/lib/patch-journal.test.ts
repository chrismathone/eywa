import { describe, expect, it } from "vitest";
import {
  claimJournal,
  EcsPatchJournal,
  journalKeyOf,
  listRecoverableJournals,
  type JournalMutation,
  type JournalRecord,
  type JournalStorage,
} from "./patch-journal";
import { buildSaveKey } from "./save-keys";

const LINE = "11111111-2222-4333-8444-555555555555";

function mut(over: Partial<JournalMutation> & { mutationId: string; clientRev: number }): JournalMutation {
  return {
    mutationId: over.mutationId,
    clientRev: over.clientRev,
    patch: over.patch ?? {
      saveKey: buildSaveKey(LINE, "textbook"),
      lineId: LINE,
      field: "textbook",
      expectedValue: null,
      newValue: `v${over.clientRev}`,
      clientRev: over.clientRev,
    },
  };
}

/** fake IDB — 지연 주입으로 순서 역전을 재현할 수 있는 in-memory 어댑터. */
function fakeStorage(opts?: { delayMs?: (op: string) => number }) {
  const map = new Map<string, JournalRecord>();
  const ops: string[] = [];
  const delay = (op: string) =>
    new Promise<void>((r) => setTimeout(r, opts?.delayMs ? opts.delayMs(op) : 0));
  const storage: JournalStorage = {
    async get(key) {
      await delay("get");
      return map.get(key) ?? null;
    },
    async put(record) {
      await delay("put");
      ops.push(`put:${record.mutations.length}`);
      map.set(record.key, structuredClone(record));
    },
    async delete(key) {
      await delay("delete");
      ops.push("delete");
      map.delete(key);
    },
    async listByPrefix(prefix) {
      await delay("list");
      return [...map.values()].filter((r) => r.key.startsWith(prefix));
    },
  };
  return { storage, map, ops };
}

const ID = { tenantId: "t1", userId: "u1", classId: "c1", week: "2026-07-20", instanceId: "i1" };

describe("EcsPatchJournal — writer chain 직렬화", () => {
  it("enqueue가 몰려도 커밋 순서가 보존된다(느린 첫 쓰기가 나중 쓰기를 덮지 않음)", async () => {
    // 첫 put만 40ms 느리게 — 체인이 없으면 두 번째 put(2건)이 먼저 커밋되고 첫 put(1건)이 덮어써
    // pending 1건으로 역전된다.
    let first = true;
    const { storage, map } = fakeStorage({
      delayMs: (op) => (op === "put" && first ? ((first = false), 40) : 0),
    });
    const j = new EcsPatchJournal(storage, ID);
    void j.enqueue(mut({ mutationId: "m1", clientRev: 1 }));
    void j.enqueue(
      mut({
        mutationId: "m2",
        clientRev: 2,
        patch: {
          saveKey: buildSaveKey(LINE, "homework"),
          lineId: LINE,
          field: "homework",
          expectedValue: null,
          newValue: "hw",
          clientRev: 2,
        },
      }),
    );
    await j.flushPersist();
    expect(map.get(journalKeyOf(ID))?.mutations).toHaveLength(2);
  });

  it("ack는 (mutationId, clientRev) 둘 다 일치할 때만 삭제 — 그 사이 새 입력(rev 증가)은 보존", async () => {
    const { storage, map } = fakeStorage();
    const j = new EcsPatchJournal(storage, ID);
    await j.enqueue(mut({ mutationId: "m1", clientRev: 1 }));
    // 같은 saveKey에 새 입력 — mutationId 유지·rev 증가(교체)
    await j.enqueue(mut({ mutationId: "m1", clientRev: 2 }));
    await j.ack("m1", 1); // 옛 rev 응답 — 삭제하면 안 됨
    expect(j.pendingCount).toBe(1);
    expect(map.get(journalKeyOf(ID))?.mutations[0].clientRev).toBe(2);
    await j.ack("m1", 2); // 현 rev 확정 — 삭제 + 빈 저널은 레코드 제거
    expect(j.pendingCount).toBe(0);
    await j.flushPersist();
    expect(map.has(journalKeyOf(ID))).toBe(false);
  });

  it("flushPersist는 IDB 커밋까지 대기하고, 스토리지 실패 시 ok:false(저널 보존 신호)", async () => {
    const { storage } = fakeStorage();
    const failing: JournalStorage = {
      ...storage,
      put: async () => {
        throw new Error("idb fail");
      },
    };
    const j = new EcsPatchJournal(failing, ID);
    void j.enqueue(mut({ mutationId: "m1", clientRev: 1 }));
    const r = await j.flushPersist();
    expect(r.ok).toBe(false);
    expect(j.pendingCount).toBe(1); // 메모리 pending은 보존 — 이동 중단 근거
  });
});

describe("두 인스턴스 격리 + 죽은 저널 회수(claim)", () => {
  it("같은 (반,주)의 두 인스턴스는 키가 달라 서로 덮지 않는다", async () => {
    const { storage, map } = fakeStorage();
    const a = new EcsPatchJournal(storage, ID);
    const b = new EcsPatchJournal(storage, { ...ID, instanceId: "i2" });
    await a.enqueue(mut({ mutationId: "a1", clientRev: 1 }));
    await b.enqueue(mut({ mutationId: "b1", clientRev: 1 }));
    expect(map.size).toBe(2);
  });

  it("listRecoverableJournals — 산 인스턴스(Web Locks/ping 응답)는 회수 대상이 아니다", async () => {
    const { storage } = fakeStorage();
    const dead = new EcsPatchJournal(storage, { ...ID, instanceId: "dead" });
    const alive = new EcsPatchJournal(storage, { ...ID, instanceId: "alive" });
    await dead.enqueue(mut({ mutationId: "d1", clientRev: 1 }));
    await alive.enqueue(mut({ mutationId: "a1", clientRev: 1 }));
    const recoverable = await listRecoverableJournals(storage, ID, async (i) => i === "alive");
    expect(recoverable.map((r) => r.instanceId)).toEqual(["dead"]);
    // claim = 레코드 삭제 + mutation 반환(재적용은 flush 경로)
    const muts = await claimJournal(storage, recoverable[0]);
    expect(muts).toHaveLength(1);
    expect(await storage.get(recoverable[0].key)).toBeNull();
  });

  it("자기 자신·빈 저널은 회수 대상에서 제외", async () => {
    const { storage } = fakeStorage();
    const self = new EcsPatchJournal(storage, ID);
    await self.enqueue(mut({ mutationId: "s1", clientRev: 1 }));
    const empty = new EcsPatchJournal(storage, { ...ID, instanceId: "empty" });
    await empty.enqueue(mut({ mutationId: "e1", clientRev: 1 }));
    await empty.ack("e1", 1);
    const recoverable = await listRecoverableJournals(storage, ID, async () => false);
    expect(recoverable).toEqual([]);
  });
});
