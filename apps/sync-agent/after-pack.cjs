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
};
