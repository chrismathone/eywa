const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const {_electron}=require('../build/runtime/node_modules/playwright');
async function main(){
  const root=fs.mkdtempSync(path.resolve(__dirname,'../../../work/agent-ui-'));
  const env={...process.env,LOCALAPPDATA:root,APPDATA:path.join(root,'Roaming')};delete env.ELECTRON_RUN_AS_NODE;delete env.DATABASE_URL;delete env.SUPABASE_SERVICE_ROLE_KEY;
  const packaged=process.argv.includes('--packaged');
  const electron=await _electron.launch({executablePath:path.resolve(__dirname,packaged?'../dist/win-unpacked/AywaSyncRuntime.exe':'../node_modules/electron/dist/electron.exe'),args:packaged?[]:[path.resolve(__dirname,'..')],env,timeout:30000});
  try{
    const page=await electron.firstWindow();await page.getByRole('heading',{name:'지점 연결',exact:true}).waitFor();
    const noMenu=()=>electron.evaluate(({Menu,BrowserWindow})=>({applicationMenuRemoved:Menu.getApplicationMenu()===null,menuBarVisible:BrowserWindow.getAllWindows()[0].isMenuBarVisible()}));
    assert.deepEqual(await noMenu(),{applicationMenuRemoved:true,menuBarVisible:false});
    await page.keyboard.press('Alt');assert.deepEqual(await noMenu(),{applicationMenuRemoved:true,menuBarVisible:false});
    const requests=[];page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
    await page.getByLabel('지점 연결 코드').fill('123');await page.getByRole('button',{name:'지점 연결',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'12자리 연결 코드를 입력해 주세요.'}).waitFor();
    assert.deepEqual(requests,[]);assert.equal(await page.evaluate(()=>typeof require),'undefined');assert.equal(await page.evaluate(()=>typeof process),'undefined');
    await page.screenshot({path:path.join(root,packaged?'packaged.png':'desktop.png'),fullPage:true});
    const state=await page.evaluate(()=>window.agent.command('state'));assert.equal(state.ok,true);assert.equal(state.state.paired,false);
    assert.equal(await page.getByRole('button',{name:'로그 폴더 열기',exact:true}).count(),1);
    await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
    assert.equal(await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
    await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show());
    assert.deepEqual(await noMenu(),{applicationMenuRemoved:true,menuBarVisible:false});
    console.log(JSON.stringify({passed:true,packaged,evidence:root,rendererIsolated:true,menuRemoved:true,closeKeepsRunning:true,networkRequests:requests.length}));
  }finally{await electron.evaluate(({app})=>app.exit(0)).catch(()=>{});await electron.close().catch(()=>{});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
