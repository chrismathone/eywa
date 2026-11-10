import { isRecord } from "@/lib/guards";
type Parameter = { kind: string; ids?: string[]; columns?: string[] };
export type QueryDefinition = { parts: string[]; modules: string[]; parameters: Parameter[]; replacement?:string };
export type QueryCatalog = Record<string, QueryDefinition>;
export class InvalidAgentQuery extends Error {}
type Fragment = { id: string; parameters: unknown[] };
const bad = (): never => { throw new InvalidAgentQuery("허용되지 않는 작업입니다."); };

/** All SQL tokens come from a checked-in build catalog. Parameter values never become SQL. */
export function compileAgentQuery(catalog: QueryCatalog, module: string, operation: Fragment) {
  const values: unknown[] = [];
  const bind = (value: unknown): string => {
    if (values.length >= 50000) return bad();
    if (isRecord(value)) {
      if (value.kind !== "json" || !Object.hasOwn(value,"value") || Object.keys(value).some(k=>!["kind","value"].includes(k))) return bad();
      // The wire value is already encoded JSON. Force a text parameter first so
      // postgres.js cannot apply its jsonb serializer a second time.
      values.push(JSON.stringify(value.value)); return `$${values.length}::text::jsonb`;
    }
    if (value === undefined || (typeof value === "number" && !Number.isFinite(value))) return bad();
    if (Array.isArray(value) && value.some(v=>isRecord(v) || Array.isArray(v))) return bad();
    values.push(value); return `$${values.length}`;
  };
  const build = (op: Fragment, depth: number): string => {
    if (depth > 5 || !/^[a-f0-9]{64}$/.test(op.id)) return bad();
    const def = Object.hasOwn(catalog,op.id) ? catalog[op.id] : undefined;
    if (!def || !def.modules.includes(module) || !Array.isArray(op.parameters) || op.parameters.length !== def.parts.length-1) return bad();
    // Compatibility aliases are checked-in catalog entries, never wire input.
    // Both the original and corrected query retain their module/shape checks.
    if(def.replacement)return build({id:def.replacement,parameters:op.parameters},depth+1);
    let text = def.parts[0]!;
    for (let i=0;i<op.parameters.length;i++) {
      const value = op.parameters[i], expected=def.parameters[i]!;
      if(expected.kind === "fragment") {
        if(!isRecord(value) || value.kind!=="fragment" || typeof value.id!=="string" || !expected.ids?.includes(value.id) || !Array.isArray(value.parameters)) return bad();
        text += build({id:value.id,parameters:value.parameters},depth+1);
      } else if(expected.kind === "list") {
        if(!isRecord(value) || value.kind!=="list" || !Array.isArray(value.values) || !value.values.length || value.values.length>10000) return bad();
        text += `(${value.values.map(bind).join(",")})`;
      } else if(expected.kind === "rows") {
        if(!isRecord(value) || value.kind!=="rows" || !Array.isArray(value.columns) || !Array.isArray(value.rows) || !value.rows.length || value.rows.length>5000) return bad();
        const columns=value.columns;
        if(!columns.length || new Set(columns).size!==columns.length || columns.some(c=>typeof c!=="string" || !expected.columns?.includes(c))) return bad();
        text += `(${columns.map(c=>`"${c}"`).join(",")}) values `;
        text += value.rows.map(row=>{
          if(!isRecord(row)) return bad();
          return `(${columns.map(c=>bind(row[c as string])).join(",")})`;
        }).join(",");
      } else text += bind(value);
      text += def.parts[i+1];
    }
    return text;
  };
  const text=build(operation,0);
  // A read timeout helper cannot change session identity or authorization.
  if (/set_config\('statement_timeout'/.test(text) && (values.length!==1 || !/^\d+$/.test(String(values[0])) || Number(values[0])>10000)) return bad();
  return { text, values };
}
