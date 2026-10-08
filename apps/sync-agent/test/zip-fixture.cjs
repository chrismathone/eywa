const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(buffer){let c=0xffffffff;for(const b of buffer)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function zipBytes(entries){const local=[],central=[];let offset=0;
  for(const entry of entries){const name=Buffer.from(entry.name),data=Buffer.from(entry.data),crc=crc32(data),a=Buffer.alloc(30),b=Buffer.alloc(46);
    a.writeUInt32LE(0x04034b50);a.writeUInt16LE(20,4);a.writeUInt16LE(0x800,6);a.writeUInt32LE(crc,14);a.writeUInt32LE(data.length,18);a.writeUInt32LE(data.length,22);a.writeUInt16LE(name.length,26);
    b.writeUInt32LE(0x02014b50);b.writeUInt16LE(0x314,4);b.writeUInt16LE(20,6);b.writeUInt16LE(0x800,8);b.writeUInt32LE(crc,16);b.writeUInt32LE(data.length,20);b.writeUInt32LE(data.length,24);b.writeUInt16LE(name.length,28);b.writeUInt32LE(((entry.mode??0x81a4)<<16)>>>0,38);b.writeUInt32LE(offset,42);
    local.push(a,name,data);central.push(b,name);offset+=a.length+name.length+data.length;
  }
  const center=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(center.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,center,end]);
}
module.exports={zipBytes};
