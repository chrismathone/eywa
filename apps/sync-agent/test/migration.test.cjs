const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {readLegacySettings,copyLegacyState}=require('../lib/legacy.cjs');
test('migration preserves behavior switches and resume files without importing server credentials',async()=>{
  const root=fs.mkdtempSync(path.resolve(__dirname,'../../../work/migration-test-')),old=path.join(root,'old'),destination=path.join(root,'new');fs.mkdirSync(path.join(old,'classnote'),{recursive:true});fs.mkdirSync(path.join(old,'videos'),{recursive:true});fs.mkdirSync(path.join(old,'.makeedu-tmp'),{recursive:true});
  fs.writeFileSync(path.join(old,'.env.local'),'DATABASE_URL=must-not-import\nSUPABASE_SERVICE_ROLE_KEY=must-not-import\nCLASSNOTE_INTERNAL_SECRET=must-not-import\nCLASSNOTE_UPLOAD_ID=fixture\nCLASSNOTE_BOARD_AUTO_SYNC=observe\nCLASSNOTE_BOARD_AUTO_RELEASE=off\nCLASSNOTE_VIDEO_COMPRESS=off\nCLASSNOTE_OUT=classnote\nCLASSNOTE_VIDEO_OUT=videos\nMAKEEDU_OUT=.makeedu-tmp\nCLASSNOTE_TENANT_ID=fixture-tenant\n');
  fs.writeFileSync(path.join(old,'classnote','provision-last-run.txt'),'2026-10-08');const resume=JSON.stringify({fileId:'existing-file',session:'fixture-session',md5:'source-hash',uploadMd5:'compressed-hash'});fs.writeFileSync(path.join(old,'videos','a.drive-state.json'),resume);
  const config=readLegacySettings(old);assert.deepEqual(config.credentials,{CLASSNOTE_UPLOAD_ID:'fixture',CLASSNOTE_BOARD_AUTO_SYNC:'observe',CLASSNOTE_BOARD_AUTO_RELEASE:'off',CLASSNOTE_VIDEO_COMPRESS:'off'});assert.deepEqual(config.tenantIds,['fixture-tenant']);
  await copyLegacyState(config.folders,destination);assert.equal(fs.readFileSync(path.join(destination,'state/classnote/videos/a.drive-state.json'),'utf8'),resume);
  fs.writeFileSync(path.join(destination,'state/classnote/provision-last-run.txt'),'newer-marker');await copyLegacyState(config.folders,destination);assert.equal(fs.readFileSync(path.join(destination,'state/classnote/provision-last-run.txt'),'utf8'),'newer-marker');
  assert.equal(fs.readFileSync(path.join(old,'classnote/provision-last-run.txt'),'utf8'),'2026-10-08');
  await assert.rejects(copyLegacyState({classnote:path.join(destination,'state/classnote')},destination));
});
