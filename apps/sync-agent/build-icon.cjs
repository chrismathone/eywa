const fs=require('node:fs');const path=require('node:path');const sharp=require('../../node_modules/sharp');
async function main(){
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" rx="56" fill="#173d73"/><path d="M57 195 110 61h36l53 134h-37l-9-27H102l-9 27Zm55-57h31l-15-45Z" fill="#ffffff"/><circle cx="194" cy="61" r="13" fill="#8ddfc8"/></svg>';
  const sizes=[16,32,48,256],buffers=await Promise.all(sizes.map(size=>sharp(Buffer.from(svg)).resize(size,size).png().toBuffer()));
  const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=header.length;
  buffers.forEach((b,i)=>{const p=6+i*16;header[p]=sizes[i]===256?0:sizes[i];header[p+1]=header[p];header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);header.writeUInt32LE(b.length,p+8);header.writeUInt32LE(offset,p+12);offset+=b.length;});
  fs.mkdirSync(path.join(__dirname,'build'),{recursive:true});fs.writeFileSync(path.join(__dirname,'build/icon.ico'),Buffer.concat([header,...buffers]));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
