import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import postgres from "postgres";
import { expect, it } from "vitest";

import { readMigration } from "../../src/lib/db/migrations-corpus.mjs";
config({ path: ".env.local", quiet: true });

// 스키마 설치·자료 생성·삭제까지 마지막에 전부 롤백한다.
it.skipIf(!process.env.DATABASE_URL)("문서 폴더: 중첩·중복 이름·순환·테넌트 격리·원자적 삭제", async () => {
  const db = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, onnotice: () => {} });
  const rollback = new Error("rollback_document_folders");
  try {
    await expect(db.begin(async (tx) => {
      await tx.unsafe(readMigration("0286a_document_folder_tree.sql")
        .replace(/^begin;\r?$/m, "").replace(/^commit;\s*$/m, ""));
      const tag = randomUUID();
      const [tenant] = await tx`insert into tenants(slug, name) values (${`folders-${tag}`}, 'Folder test') returning id`;
      const [foreign] = await tx`insert into tenants(slug, name) values (${`foreign-${tag}`}, 'Foreign test') returning id`;
      const userId = randomUUID();
      await tx`insert into users(id, tenant_id, email, display_name, system_role) values (${userId}, ${tenant.id}, ${`${tag}@test.invalid`}, 'Folder test', 'master')`;
      await tx`insert into document_categories(tenant_id, key, label) values (${foreign.id}, 'foreign-only', 'Foreign')`;
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId })}, true)`;
      await tx.unsafe("set local role authenticated");
      const create = async (label: string, parent: string | null = null) => {
        const [r] = await tx`select mutate_document_folder('create', p_label => ${label}, p_parent_key => ${parent}) as result`;
        return r.result.key as string;
      };
      const root = await create('시험지', 'class');
      const child = await create('중등', root);
      const leaf = await create('1학년', child);
      const peer = await create('2학년', child);
      const [{ parent_key }] = await tx`select parent_key from document_categories where tenant_id = ${tenant.id} and key = ${leaf}`;
      expect(parent_key).toBe(child);
      await create('1학년', root); // 다른 부모 아래에는 같은 이름 허용
      await expect(tx.savepoint((s) => s`select mutate_document_folder('create', p_label => '1학년', p_parent_key => ${child})`)).rejects.toMatchObject({ code: '23505' });
      await expect(tx.savepoint((s) => s`select mutate_document_folder('reparent', p_key => ${root}, p_parent_key => ${leaf})`)).rejects.toThrow('folder_cycle');
      await expect(tx.savepoint((s) => s`update document_categories set parent_key = ${leaf} where tenant_id = ${tenant.id} and key = ${root}`)).rejects.toThrow('folder_cycle');
      await expect(tx.savepoint((s) => s`select mutate_document_folder('create', p_label => '격리', p_parent_key => 'foreign-only')`)).rejects.toThrow('folder_parent_missing');
      await expect(tx.savepoint((s) => s`select mutate_document_folder('rename', p_key => 'foreign-only', p_label => '격리')`)).rejects.toThrow('folder_missing');
      await tx`select mutate_document_folder('reorder', p_key => ${peer}, p_direction => 'up')`;
      const siblings = await tx`select key from document_categories where tenant_id = ${tenant.id} and parent_key = ${child} order by sort_order, key`;
      expect(siblings.map((r) => r.key)).toEqual([peer, leaf]);
      const [doc] = await tx`insert into academy_documents(tenant_id, category, title, kind, uploaded_by) values (${tenant.id}, ${root}, 'Root document', 'text', ${userId}) returning id`;
      await expect(tx.savepoint((s) => s`select mutate_document_folder('delete', p_key => ${root}, p_absorb_into => 'other')`)).rejects.toThrow('folder_has_children');
      expect((await tx`select category from academy_documents where id = ${doc.id}`)[0].category).toBe(root);
      const [leafDoc] = await tx`insert into academy_documents(tenant_id, category, title, kind, uploaded_by) values (${tenant.id}, ${leaf}, 'Leaf document', 'text', ${userId}) returning id`;
      await tx`select mutate_document_folder('reparent', p_key => ${child}, p_parent_key => null)`;
      expect((await tx`select category from academy_documents where id = ${leafDoc.id}`)[0].category).toBe(leaf);
      const [deleted] = await tx`select mutate_document_folder('delete', p_key => ${leaf}, p_absorb_into => ${root}) as result`;
      expect(deleted.result.moved).toBe(1);
      expect((await tx`select category from academy_documents where id = ${leafDoc.id}`)[0].category).toBe(root);
      await expect(tx.savepoint((s) => s`insert into academy_documents(tenant_id, category, title, kind, uploaded_by) values (${tenant.id}, ${leaf}, 'Stale upload', 'text', ${userId})`)).rejects.toMatchObject({ code: '23503' });
      await expect(tx.savepoint((s) => s`select mutate_document_folder('delete', p_key => 'other', p_absorb_into => ${root})`)).rejects.toThrow('folder_system');
      // 보이지 않는 문서가 하나라도 남으면 이미 옮긴 공개 문서까지 모두 롤백한다.
      const guarded = await create('보호 자료');
      const [publicDoc] = await tx`insert into academy_documents(tenant_id, category, title, kind, uploaded_by) values (${tenant.id}, ${guarded}, 'Public', 'text', ${userId}) returning id`;
      await tx`insert into academy_documents(tenant_id, category, title, kind, uploaded_by, restricted) values (${tenant.id}, ${guarded}, 'Restricted', 'text', ${userId}, true)`;
      await tx.unsafe('reset role');
      const teacherId = randomUUID();
      await tx`insert into users(id, tenant_id, email, display_name, system_role) values (${teacherId}, ${tenant.id}, ${`teacher-${tag}@test.invalid`}, 'Teacher', 'teacher')`;
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: teacherId })}, true)`;
      await tx.unsafe('set local role authenticated');
      await expect(tx.savepoint((s) => s`select mutate_document_folder('delete', p_key => ${guarded}, p_absorb_into => 'other')`)).rejects.toMatchObject({ code: '23503' });
      expect((await tx`select category from academy_documents where id = ${publicDoc.id}`)[0].category).toBe(guarded);
      expect(await tx`select key from document_categories where key = ${guarded}`).toHaveLength(1);
      // 테넌트 자체 정리 시 시스템 폴더와 자기참조 FK가 기존 CASCADE를 막지 않아야 한다.
      await tx.unsafe('reset role');
      await tx`delete from tenants where id = ${foreign.id}`;
      throw rollback;
    })).rejects.toBe(rollback);
  } finally { await db.end(); }
}, 60_000);
