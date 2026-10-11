import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createPluginConnectionStore} from "../server/plugin-connection-store.mjs";

test("rotating CIRO credential key re-encrypts old provider grants transactionally",()=>{
 const dir=mkdtempSync(join(tmpdir(),"ciro-rotation-"));
 const oldKey=randomBytes(32).toString("base64");
 const newKey=randomBytes(32).toString("base64");
 let oldStore,newStore,withoutOld;
 try{
  oldStore=createPluginConnectionStore({dir,env:{CIRO_ACCOUNT_DATA_KEY:oldKey}});
  const generation=oldStore.putConnection({ownerId:"alice",provider:"github",
   account:{login:"alice"},secret:{accessToken:"unexported-rotatable-token"},scopes:["repo"]});
  oldStore.close();oldStore=null;
  newStore=createPluginConnectionStore({dir,env:{
   CIRO_ACCOUNT_DATA_KEY:newKey,CIRO_ACCOUNT_DATA_KEY_PREVIOUS:oldKey
  }});
  const refreshed=newStore.connection("alice","github");
  assert.equal(refreshed.secret.accessToken,"unexported-rotatable-token");
  assert.equal(refreshed.generation,generation);
  assert.equal(newStore.audit("alice")[0].event,"connection.key_rotated");
  assert.equal(JSON.stringify(newStore.get()).includes("unexported-rotatable-token"),false);
  newStore.close();newStore=null;
  withoutOld=createPluginConnectionStore({dir,env:{CIRO_ACCOUNT_DATA_KEY:newKey}});
  assert.equal(withoutOld.connection("alice","github").secret.accessToken,"unexported-rotatable-token");
  assert.equal(withoutOld.connection("bob","github"),null);
 }finally{
  oldStore?.close();newStore?.close();withoutOld?.close();
  rmSync(dir,{recursive:true,force:true});
 }
});
