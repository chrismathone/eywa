const fs=require('node:fs');const path=require('node:path');
module.exports=async context=>{
  // electron-builder excludes nested node_modules from extraResources. Copy the separately
  // installed worker dependencies explicitly, then verify the runtime's entry points.
  const source=path.resolve(__dirname,'build/runtime/node_modules'),out=path.resolve(context.appOutDir);
  if(!out.startsWith(path.resolve(__dirname,'dist')+path.sep))throw new Error('Unexpected packaging destination');
  const destination=path.join(out,'resources/runtime/node_modules');
  await fs.promises.cp(source,destination,{recursive:true,dereference:true});
  for(const name of ['playwright','@playwright/test','exceljs','iconv-lite','googleapis'])if(!fs.existsSync(path.join(destination,name,'package.json')))throw new Error(`Missing packaged dependency: ${name}`);
  if(fs.existsSync(path.join(destination,'postgres')))throw new Error('Direct database client must not ship');
  // 실행기 판·설치본 순번 표식(1.0.13). 실행기는 aywa-install.json으로 설치 폴더 본체의 순번을 알고, 본체는 aywa-launcher.json으로
  // 설치 폴더 실행기가 옛 판인지 본다. 판 값은 native/Bootstrap.cs의 LauncherVersion과 같아야 한다.
  const build=require('./build-config.json');if(!Number.isSafeInteger(build.sequence)||build.sequence<1)throw new Error('Invalid build sequence');
  const launcher=Number(/const int LauncherVersion = (\d+);/.exec(fs.readFileSync(path.join(__dirname,'native/Bootstrap.cs'),'utf8'))?.[1]);if(!Number.isSafeInteger(launcher)||launcher<2)throw new Error('LauncherVersion not found');
  fs.writeFileSync(path.join(out,'aywa-launcher.json'),JSON.stringify({launcher}));fs.writeFileSync(path.join(out,'aywa-install.json'),JSON.stringify({sequence:build.sequence}));
};
