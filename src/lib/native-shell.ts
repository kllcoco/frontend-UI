/* Narrow client-to-native-shell V1 handshake. No system command execution, FS, or secrets. */
export type NativePlatform="windows"|"macos"|"linux"|"android"|"ios";
export type NativeShellStatus={
  available:boolean;platform:NativePlatform|null;version:string|null;
  protocol:"ciro-native-shell.v1";verified:false;grants:string[];
};
type NativeHello={contract:"ciro-native-shell.v1";origin:string;nonce:string};
type NativeHelloReply={contract:string;origin:string;nonce:string;platform:string;
  version:string;grants:unknown};
interface NativeBridgeV1{
  handshake:(payload:NativeHello)=>Promise<NativeHelloReply>;
  notify?:(payload:{title:string;body:string})=>Promise<{accepted:boolean}>;
}
declare global{
  interface Window{ciroNativeBridge?:NativeBridgeV1;}
}
const empty:NativeShellStatus={available:false,platform:null,version:null,
  protocol:"ciro-native-shell.v1",verified:false,grants:[]};
export async function probeNativeShell():Promise<NativeShellStatus>{
  const bridge=window.ciroNativeBridge;
  if(!bridge||typeof bridge.handshake!=="function")return {...empty};
  const nonce=crypto.randomUUID();
  const origin=window.location.origin;
  const result=await Promise.race([
    bridge.handshake({contract:"ciro-native-shell.v1",origin,nonce}),
    new Promise<never>((_resolve,reject)=>setTimeout(()=>reject(new Error("Native bridge timeout")),3000))
  ]);
  if(!result||result.contract!=="ciro-native-shell.v1"||result.nonce!==nonce||
    result.origin!==origin||!["windows","macos","linux","android","ios"].includes(result.platform)||
    typeof result.version!=="string"||result.version.length>100)
    throw new Error("Native shell handshake mismatch");
  const grants=Array.isArray(result.grants)?result.grants.filter(
    (g):g is string=>["notifications","deep_links"].includes(g)
  ):[];
  // Browser-visible JS is not hardware attestation. Treat as unverified until
  // the signed native packager implements origin isolation and attestation.
  return {available:true,platform:result.platform as NativePlatform,
    version:result.version,grants,protocol:"ciro-native-shell.v1",verified:false};
}
export async function sendNativeNotification(status:NativeShellStatus,title:string,body:string):Promise<void>{
  if(!status.available||!status.grants.includes("notifications")||!window.ciroNativeBridge?.notify)
    throw new Error("Native notification bridge is not available");
  if(title.length>120||body.length>450||!title.trim())throw new Error("Notification exceeds limits");
  const result=await window.ciroNativeBridge.notify({title,body});
  if(result?.accepted!==true)throw new Error("Native shell rejected notification");
}
