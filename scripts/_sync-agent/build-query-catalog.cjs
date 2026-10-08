// Build-time allowlist. The network API accepts IDs and parameters, never SQL text.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const entries = {
  classnote: ['watch-classnote-queue.mjs', 'process-classnote-queue.mjs', 'process-classnote-notices.mjs', 'process-classnote-recalls.mjs', 'process-parent-replies.mjs', 'process-parent-reactions.mjs', 'sync-child-map.mjs', 'sync-classnote-reads.mjs', 'backfill-attach-only-messages.mjs'],
  makeedu: ['watch-sync-requests.cjs', 'sync-all.cjs', 'check-session.mjs', 'check-login.cjs', 'push-consultations.cjs', 'import-enrollments.cjs', 'import-consultations-excel.cjs', 'sync-prospects.cjs', 'reconcile-invoices.cjs'],
};
// Retain released query IDs across web deployments. Installed PCs may update hours later.
const catalogPath=path.join(root,'src/features/sync-agent/server/query-catalog.json');
const catalog = fs.existsSync(catalogPath)?JSON.parse(fs.readFileSync(catalogPath,'utf8')):{};
const sources = new Map();
const externals = new Set();
const normalize = p => p.replaceAll('\\', '/');
const idOf = parts => crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
function visitFile(file, module) {
  file = path.resolve(file);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || /\.test\./.test(file)) return;
  const key = `${module}:${file}`;
  if (sources.has(key)) return;
  sources.set(key, normalize(path.relative(root,file)));
  const source = ts.createSourceFile(file, fs.readFileSync(file,'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declarations = new Map();
  function collect(n) { if(ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) declarations.set(n.name.text,n.initializer); ts.forEachChild(n,collect); }
  collect(source);
  const templateParts = t => ts.isNoSubstitutionTemplateLiteral(t) ? [t.text] : [t.head.text,...t.templateSpans.map(s=>s.literal.text)];
  function descriptor(n,seen=new Set()) {
    if(ts.isIdentifier(n) && declarations.has(n.text) && !seen.has(n.text)) return descriptor(declarations.get(n.text),new Set([...seen,n.text]));
    const fragments=[];
    function find(x) { if(ts.isTaggedTemplateExpression(x) && /^(sql\d*|tx|s|db\(\))$/.test(x.tag.getText(source))) fragments.push(idOf(templateParts(x.template))); else ts.forEachChild(x,find); }
    find(n);
    if(fragments.length) return {kind:'fragment',ids:[...new Set(fragments)]};
    if(ts.isCallExpression(n) && /^(sql\d*|tx|s|db\(\))$/.test(n.expression.getText(source))) {
      if(n.arguments.length===1) return {kind:'list'};
      const columns=n.arguments.slice(1).filter(ts.isStringLiteral).map(a=>a.text);
      if(n.arguments.some(ts.isSpreadElement)) columns.push('tenant_id','source','classnote_post_id','classnote_comment_id','child_id','student_id','class_name','content','posted_at','classified_at','category','cross_teacher_ids');
      return {kind:'rows',columns:[...new Set(columns)]};
    }
    return {kind:'value'};
  }
  function walk(node) {
    if (ts.isStringLiteral(node) && /\.(mjs|cjs|json)$/.test(node.text) && !node.text.includes('://')) {
      const local = path.resolve(path.dirname(file),node.text);
      if (fs.existsSync(local) && /\.(mjs|cjs)$/.test(local)) visitFile(local,module);
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && !node.moduleSpecifier.text.startsWith('.')) externals.add(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.expression.kind===ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && !node.arguments[0].text.startsWith('.')) externals.add(node.arguments[0].text);
    if (ts.isCallExpression(node) && node.expression.getText(source)==='require' && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && !node.arguments[0].text.startsWith('.')) externals.add(node.arguments[0].text);
    if (ts.isTaggedTemplateExpression(node)) {
      const tag = node.tag.getText(source);
      if (/^(sql\d*|tx|s|db\(\))$/.test(tag)) {
        const t = node.template;
        const parts = templateParts(t);
        if (/worker_execution_lease/.test(parts.join(' '))) return;
        const id = idOf(parts);
        const existing = catalog[id];
        catalog[id] = { parts, modules: [...new Set([...(existing?.modules ?? []),module])], sources: [...new Set([...(existing?.sources ?? []),normalize(path.relative(root,file))])],
          parameters: ts.isNoSubstitutionTemplateLiteral(t) ? [] : t.templateSpans.map((s,i)=>{
            const next=descriptor(s.expression),old=existing?.parameters?.[i];
            if(old?.kind===next.kind){if(next.ids)next.ids=[...new Set([...old.ids??[],...next.ids])];if(next.columns)next.columns=[...new Set([...old.columns??[],...next.columns])];}
            return next;
          }),
          expressions: ts.isNoSubstitutionTemplateLiteral(t) ? [] : t.templateSpans.map(s=>s.expression.getText(source)) };
      }
    }
    ts.forEachChild(node,walk);
  }
  walk(source);
}
for(const [module,files] of Object.entries(entries)) for(const file of files) visitFile(path.join(root,`scripts/_${module}`,file),module);
const sorted = Object.fromEntries(Object.entries(catalog).sort(([a],[b])=>a.localeCompare(b)));
const out = path.join(root,'src/features/sync-agent/server/query-catalog.json');
fs.mkdirSync(path.dirname(out),{recursive:true});
fs.writeFileSync(out,JSON.stringify(sorted,null,2)+'\n');
const tables = [...new Set(Object.values(catalog).flatMap(q=>[...q.parts.join(' ? ').matchAll(/\b(?:from|join|update|into)\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi)].map(m=>m[1].toLowerCase())))].sort();
fs.writeFileSync(path.join(__dirname,'runtime-manifest.json'),JSON.stringify({entries,sources:[...new Set(sources.values())].sort(),externals:[...externals].sort(),tables},null,2)+'\n');
console.log(JSON.stringify({queries:Object.keys(catalog).length,sources:new Set(sources.values()).size,tables,externals:[...externals].sort()},null,2));
