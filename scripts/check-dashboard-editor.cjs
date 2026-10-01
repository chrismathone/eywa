// 개발 서버 전용: node scripts/check-dashboard-editor.cjs http://127.0.0.1:3500
// Chromium 경로를 직접 지정하려면 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH 사용.
const { chromium } = require('@playwright/test');
const assert = (v, m) => { if (!v) throw new Error(m); };
(async () => {
 const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
 try {
  const page = await browser.newPage({ viewport: { width: 1894, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(new URL('/dev/dashboard-harness', process.argv[2] || 'http://127.0.0.1:3500').href, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.getByRole('button', { name: '편집', exact: true }).waitFor();
  await page.locator('[data-dashboard-card="panel:studentsComp"] svg').first().waitFor();
  await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(500);
  const geometry = () => page.locator('[aria-label="운영실 미리보기"]').evaluate(root => {
   const origin = root.getBoundingClientRect(), seen = new Set(), cards = [];
   for (const el of root.querySelectorAll('[data-dashboard-card]')) {
    const id = el.dataset.dashboardCard; if (seen.has(id)) continue; seen.add(id);
    const r = el.getBoundingClientRect(); if (r.width && r.height) cards.push({ id, x: r.x-origin.x, y:r.y-origin.y, w:r.width, h:r.height });
   }
   return cards;
  });
  const same = (a,b,label) => {
   assert(a.length === b.length, label+' count '+a.length+' != '+b.length);
   for (let i=0;i<a.length;i++) {
    assert(a[i].id === b[i].id, label+' card order');
    for (const k of ['x','y','w','h']) assert(Math.abs(a[i][k]-b[i][k]) < 1, label+' '+a[i].id+' '+k+' '+a[i][k]+' != '+b[i][k]);
   }
  };
  const before = await geometry();
  await page.getByRole('button',{name:'편집',exact:true}).click();
  await page.locator('[data-tile-id]').first().waitFor(); await page.waitForTimeout(500);
  same(before,await geometry(),'owner edit toggle');
  assert(await page.locator('[data-tile-id]').count() === before.length,'overlay count');
  const overlayDiffs = await page.locator('[data-tile-id]').evaluateAll(tiles => tiles.flatMap(tile => {
   const actual=document.querySelector('[data-live-preview] [data-dashboard-card="'+CSS.escape(tile.dataset.tileId)+'"]');
   const a=actual.getBoundingClientRect(),b=tile.getBoundingClientRect();
   return ['x','y','width','height'].filter(k=>Math.abs(a[k]-b[k])>=1).map(k=>tile.dataset.tileId+':'+k);
  }));
  assert(!overlayDiffs.length,'overlay mismatch '+overlayDiffs.join(','));
  await page.locator('[data-tile-id="kpi:students"]').click(); await page.waitForTimeout(200);
  same(before,await geometry(),'inspector must not resize dashboard');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'완료',exact:true}).click(); await page.waitForTimeout(400);
  same(before,await geometry(),'owner done toggle');
  console.log('owner view/edit/done and overlay geometry match '+before.length+' cards');
  await page.getByRole('button',{name:'과목 관리자 배치',exact:true}).click(); await page.waitForTimeout(300);
  const subject = await geometry();
  await page.getByRole('button',{name:'편집',exact:true}).click(); await page.waitForTimeout(400);
  same(subject,await geometry(),'subject edit toggle');
  const items=()=>page.locator('input[name=data]').inputValue().then(v=>JSON.stringify(JSON.parse(v).layouts.find(l=>l.role==='subject').items));
  const initial=await items(); const tiles=page.locator('[data-tile-id]');
  const a=await tiles.first().boundingBox(),z=await tiles.nth(2).boundingBox();
  await page.mouse.move(a.x+40,a.y+45); await page.mouse.down(); await page.mouse.move(z.x+z.width-20,z.y+45,{steps:14}); await page.waitForTimeout(180); await page.mouse.up(); await page.waitForTimeout(400);
  assert(await items()!==initial,'live mouse drag did not reorder');
  const edited=await geometry();
  await page.getByRole('button',{name:'완료',exact:true}).click(); await page.waitForTimeout(300);
  same(edited,await geometry(),'edited placement matches done');
  await page.getByRole('button',{name:'편집',exact:true}).click(); await page.waitForTimeout(250);
  await page.getByRole('button',{name:'되돌리기',exact:true}).click(); await page.waitForTimeout(250); assert(await items()===initial,'undo');
  assert(errors.length===0,'browser errors '+JSON.stringify(errors));
  console.log(JSON.stringify({passed:['owner exact geometry','actual chart retained','overlay exact bounds','inspector retains width','subject exact geometry','live drag','edited preview parity','undo'],errors}));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
