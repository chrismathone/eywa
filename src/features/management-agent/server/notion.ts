import "server-only";
import { createPage, queryDatabaseAll, titlePropertyName, updatePageProps } from "@/lib/notion/client";
import { assertTenantViewOutboundAllowed } from "@/lib/auth/tenant-view-outbound";
import { CASE_LABEL, caseHref, type AgentCase } from "../model";

// A dedicated notification database, never the existing staff task database.
export function managementNotionConfig(tenantId: string) {
  const dbId = process.env.NOTION_MANAGEMENT_DATABASE_ID?.trim();
  if (!dbId || !process.env.NOTION_TOKEN?.trim() || process.env.NOTION_TENANT_ID?.trim() !== tenantId) return null;
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return { dbId, origin: url.origin };
  } catch { return null; }
}

export async function publishCaseNotice(row: AgentCase, creationStarted: boolean, beforeCreate: () => Promise<void>) {
  await assertTenantViewOutboundAllowed();
  const config = managementNotionConfig(row.tenant_id);
  if (!config) throw new Error("not_configured");
  const title = await titlePropertyName(config.dbId);
  // Stable full UUID in the title permits recovery after a lost POST response.
  const existing = await queryDatabaseAll(config.dbId, { filter: { property: title, title: { contains: row.id } } }, { maxPages: 1 });
  if (existing.length > 1) throw new Error("duplicate_notice");
  const properties = {
    [title]: { title: [{ type: "text", text: {
      content: `상담 후속조치 · ${CASE_LABEL[row.status]} · ${row.id}`,
      link: { url: `${config.origin}${caseHref(row.id)}` },
    } }] },
  };
  if (existing[0]) {
    await updatePageProps(existing[0].id, properties);
    return existing[0].id;
  }
  // Notion create has no idempotency key. An ambiguous POST is never blindly replayed.
  if (creationStarted) throw new Error("creation_uncertain");
  await beforeCreate();
  return createPage(config.dbId, properties);
}
