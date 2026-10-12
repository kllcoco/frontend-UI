"use strict";
const {contextBridge,ipcRenderer}=require("electron");
const bridge={
 handshake(payload){return ipcRenderer.invoke("ciro-native:handshake",payload);},
 notify(payload){return ipcRenderer.invoke("ciro-native:notify",payload);}
};
contextBridge.exposeInMainWorld("ciroNativeBridge",Object.freeze(bridge));
