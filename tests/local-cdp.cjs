// Minimal loopback-only WebSocket transport for dependency-free Chrome tests.
const http=require('node:http'),crypto=require('node:crypto');
module.exports=class LocalCDP {
 constructor(url){
  const u=new URL(url);
  if(!['localhost','127.0.0.1','[::1]'].includes(u.hostname))throw Error('Only loopback test endpoints are allowed');
  this.buffer=Buffer.alloc(0);this.parts=[];
  const request=http.request({hostname:'127.0.0.1',port:u.port,path:u.pathname,headers:{Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Key':crypto.randomBytes(16).toString('base64'),'Sec-WebSocket-Version':'13'}});
  request.on('upgrade',(res,socket,head)=>{this.socket=socket;socket.on('data',d=>this.read(d));socket.on('error',e=>this.onerror?.(e));this.onopen?.();if(head.length)this.read(head)});
  request.on('response',res=>this.onerror?.(Error('WebSocket HTTP '+res.statusCode)));
  request.on('error',e=>this.onerror?.(e));request.end();
 }
 send(text){
  const data=Buffer.from(text),mask=crypto.randomBytes(4),header=Buffer.alloc(data.length<126?2:data.length<65536?4:10);
  header[0]=0x81;
  if(data.length<126)header[1]=0x80|data.length;
  else if(data.length<65536){header[1]=0xfe;header.writeUInt16BE(data.length,2)}
  else{header[1]=0xff;header.writeBigUInt64BE(BigInt(data.length),2)}
  const encoded=Buffer.from(data);for(let i=0;i<encoded.length;i++)encoded[i]^=mask[i%4];
  this.socket.write(Buffer.concat([header,mask,encoded]));
 }
 read(chunk){
  if(process.env.CDP_DEBUG)console.log('WS chunk',chunk.length,chunk.subarray(0,150).toString());
  this.buffer=Buffer.concat([this.buffer,chunk]);
  while(this.buffer.length>=2){
   const b=this.buffer,opcode=b[0]&15,final=Boolean(b[0]&128);let n=b[1]&127,offset=2;
   if(n===126){if(b.length<4)return;n=b.readUInt16BE(2);offset=4}
   else if(n===127){if(b.length<10)return;n=Number(b.readBigUInt64BE(2));offset=10}
   if(b.length<offset+n)return;
   const data=b.subarray(offset,offset+n);this.buffer=b.subarray(offset+n);
   if(opcode===8){this.close();return}
   if(opcode===1||opcode===0){this.parts.push(data);if(final){const text=Buffer.concat(this.parts).toString();this.parts=[];this.onmessage?.({data:text})}}
  }
 }
 close(){this.socket?.destroy()}
};
