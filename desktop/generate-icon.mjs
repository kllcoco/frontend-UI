// Offline CIRO moon icon. No native graphics dependency or remote asset download.
import {mkdirSync,writeFileSync} from "node:fs";
import {join,dirname} from "node:path";
import {fileURLToPath} from "node:url";

const sizes=[16,32,48,64,128,256];
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
function insideRoundedSquare(x,y){
 const qx=Math.max(Math.abs(x-32)-17,0),qy=Math.max(Math.abs(y-32)-17,0);
 return Math.hypot(qx,qy)<=15;
}
function pointInDiamond(x,y,cx,cy,xr,yr){
 return Math.abs(x-cx)/xr+Math.abs(y-cy)/yr<=1;
}
function sample(x,y){
 if(!insideRoundedSquare(x,y))return [0,0,0,0];
 // Brand teal field + crescent; coordinate system matches public/ciro-mark.svg.
 let r=7,g=25,b=20;
 const outer=Math.hypot(x-30.2,y-32)<27;
 const cutout=Math.hypot((x-41)/1.05,y-31.8)<23;
 if(outer&&!cutout){
  const t=clamp((x+y)/128);
  r=35+Math.floor(119*(1-t));g=140+Math.floor(105*(1-t));b=93+Math.floor(81*(1-t));
 }
 const star=pointInDiamond(x,y,51,31.3,10.5,13.2)||
  pointInDiamond(x,y,51,31.3,5.5,8.7);
 if(star){r=188;g=255;b=224;}
 return [r,g,b,255];
}
function dib(size){
 const stride=size*4,maskStride=Math.ceil(size/32)*4;
 const result=Buffer.alloc(40+size*stride+size*maskStride);
 result.writeUInt32LE(40,0);result.writeInt32LE(size,4);
 result.writeInt32LE(size*2,8);result.writeUInt16LE(1,12);
 result.writeUInt16LE(32,14);result.writeUInt32LE(0,16);
 result.writeUInt32LE(size*stride+size*maskStride,20);
 const aa=size>=128?2:4;
 for(let row=0;row<size;row++)for(let col=0;col<size;col++){
  let rr=0,gg=0,bb=0,aaSum=0;
  for(let sy=0;sy<aa;sy++)for(let sx=0;sx<aa;sx++){
   const [r,g,b,a]=sample((col+(sx+.5)/aa)*64/size,(size-1-row+(sy+.5)/aa)*64/size);
   rr+=r*a;gg+=g*a;bb+=b*a;aaSum+=a;
  }
  const offset=40+row*stride+col*4;
  const samples=aa*aa,alpha=Math.round(aaSum/samples);
  result[offset]=aaSum?Math.round(bb/aaSum):0;
  result[offset+1]=aaSum?Math.round(gg/aaSum):0;
  result[offset+2]=aaSum?Math.round(rr/aaSum):0;
  result[offset+3]=alpha;
  if(alpha<8){
   const byte=40+size*stride+row*maskStride+(col>>3);
   result[byte]|=0x80>>(col&7);
  }
 }
 return result;
}
export function buildIcon(){
 const images=sizes.map(size=>({size,bytes:dib(size)}));
 const header=Buffer.alloc(6+images.length*16);
 header.writeUInt16LE(0,0);header.writeUInt16LE(1,2);
 header.writeUInt16LE(images.length,4);
 let offset=header.length;
 for(let i=0;i<images.length;i++){
  const image=images[i],p=6+i*16;
  header[p]=image.size===256?0:image.size;
  header[p+1]=image.size===256?0:image.size;
  header[p+2]=0;header[p+3]=0;
  header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);
  header.writeUInt32LE(image.bytes.length,p+8);
  header.writeUInt32LE(offset,p+12);offset+=image.bytes.length;
 }
 return Buffer.concat([header,...images.map(x=>x.bytes)]);
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const target=join(dirname(fileURLToPath(import.meta.url)),"assets","ciro.ico");
 mkdirSync(dirname(target),{recursive:true});
 const ico=buildIcon();
 writeFileSync(target,ico);
 console.log("CIRO multi-resolution Windows icon:",ico.length,"bytes");
}
