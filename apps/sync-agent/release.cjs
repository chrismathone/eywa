// Create reviewable immutable artifacts. This command never uploads or changes production.
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {execFileSync}=require('node:child_process');
async function hash(file){const h=crypto.createHash('sha256');for await(const c of fs.createReadStream(file))h.update(c);return h.digest('hex');}
async function main(){
  const build=require('./build-config.json'),directory=path.join(__dirname,'dist/win-unpacked'),out=path.join(__dirname,'dist/release',String(build.sequence));
  const base=process.env.EYWA_AGENT_RELEASE_BASE_URL;if(!base||new URL(base).protocol!=='https:'||new URL(base).username||new URL(base).password||new URL(base).search||new URL(base).hash)throw new Error('Set EYWA_AGENT_RELEASE_BASE_URL to the immutable HTTPS release directory.');
  fs.mkdirSync(out,{recursive:true});const archive=path.join(out,`AywaSync-${build.version}.zip`);if(fs.existsSync(archive))throw new Error('Release archive already exists; choose a new sequence.');
  const files=[];const walk=async(relative='')=>{for(const name of fs.readdirSync(path.join(directory,relative)).sort()){const rel=relative?relative+'/'+name:name,full=path.join(directory,rel),stat=fs.lstatSync(full);if(stat.isSymbolicLink())throw new Error('Symlinks cannot be published');if(stat.isDirectory())await walk(rel);else files.push({path:rel,size:stat.size,sha256:await hash(full)});}};await walk();
  const zip=path.join(__dirname,'node_modules/electron-winstaller/vendor/7z.exe');execFileSync(zip,['a','-tzip','-mx=5',archive,'.'],{cwd:directory,stdio:'ignore',windowsHide:true});
  const manifest={protocol:1,sequence:build.sequence,version:build.version,expiresAt:new Date(Date.now()+180*86400000).toISOString(),url:new URL(path.basename(archive),base.replace(/\/?$/,'/')).href,size:fs.statSync(archive).size,sha256:await hash(archive),files};
  const bytes=Buffer.from(JSON.stringify(manifest));const keyFile=process.env.EYWA_AGENT_SIGNING_KEY_FILE||path.join(process.env.LOCALAPPDATA,'AYWA','ReleaseKeys','sync-agent-private.pem');
  const signature=crypto.sign('RSA-SHA256',bytes,fs.readFileSync(keyFile)).toString('base64');if(!crypto.verify('RSA-SHA256',bytes,build.publicKey,Buffer.from(signature,'base64')))throw new Error('Release signing key does not match the packaged public key');
  const envelope={payload:bytes.toString('base64'),signature};
  // Exercise the exact client's bounds against the real packaged manifest before release.
  require('./lib/update.cjs').verifyManifest(envelope,build.publicKey,{sequence:build.sequence-1});
  fs.writeFileSync(path.join(out,'release.json'),JSON.stringify(envelope));
  const installer=path.join(__dirname,'dist',`AywaSync-Setup-${build.version}.exe`);fs.copyFileSync(installer,path.join(out,path.basename(installer)));
  const record={version:build.version,sequence:build.sequence,installerUrl:new URL(path.basename(installer),base.replace(/\/?$/,'/')).href,installerSha256:await hash(installer),archiveSha256:manifest.sha256,archiveBytes:manifest.size,files:files.length,createdAt:new Date().toISOString()};
  fs.writeFileSync(path.join(out,'release-record.json'),JSON.stringify({version:build.version,sequence:build.sequence,manifest:{payload:envelope.payload},signature:envelope.signature,installer_url:record.installerUrl}));
  fs.writeFileSync(path.join(out,'checksums.json'),JSON.stringify(record,null,2));console.log(JSON.stringify({prepared:true,directory:out,...record}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
