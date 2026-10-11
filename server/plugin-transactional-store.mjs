import {DatabaseSync} from "node:sqlite";
import {existsSync,mkdirSync,readFileSync,statSync,chmodSync} from "node:fs";
import {join} from "node:path";

function privateFile(path) {
  if(!existsSync(path))return;
  if(process.platform!=="win32"&&(statSync(path).mode&0o077)!==0)
    throw new Error("CIRO plugin state file must not be group/world accessible: "+path);
}
export function createTransactionalPluginDocument({dir,kind,legacyName,initial,validate}) {
  if(!/^[a-z][a-z0-9_-]{1,48}$/.test(kind))throw new Error("Invalid plugin state namespace");
  mkdirSync(dir,{recursive:true,mode:0o700});
  const file=join(dir,"plugin-control.sqlite");
  const legacy=join(dir,legacyName);
  privateFile(file);
  const db=new DatabaseSync(file);
  try {
    if(process.platform!=="win32")chmodSync(file,0o600);
    db.exec("PRAGMA busy_timeout=5000;");
    db.exec("PRAGMA journal_mode=WAL;");
    db.exec("PRAGMA synchronous=FULL;");
    db.exec("CREATE TABLE IF NOT EXISTS plugin_documents (kind TEXT PRIMARY KEY, version INTEGER NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL)");
    const select=db.prepare("SELECT payload, version FROM plugin_documents WHERE kind=?");
    const insert=db.prepare("INSERT INTO plugin_documents (kind,version,payload,updated_at) VALUES (?,1,?,?)");
    const update=db.prepare("UPDATE plugin_documents SET payload=?,version=version+1,updated_at=? WHERE kind=?");
    const decode=row=>{
      if(!row)return null;
      const document=JSON.parse(row.payload);
      if(!validate(document))throw new Error("Plugin state incompatible: refusing migration");
      return document;
    };
    function guarded(fn) {
      db.exec("BEGIN IMMEDIATE");
      try{
        const result=fn();
        db.exec("COMMIT");
        return result;
      }catch(error) {
        try{db.exec("ROLLBACK");}catch{/* preserve original error */}
        throw error;
      }
    }
    guarded(()=>{
      if(select.get(kind))return;
      let original=initial();
      if(existsSync(legacy)) {
        privateFile(legacy);
        original=JSON.parse(readFileSync(legacy,"utf8"));
      }
      if(!validate(original))throw new Error("Legacy plugin state incompatible: refusing migration");
      insert.run(kind,JSON.stringify(original),new Date().toISOString());
    });
    return {
      kind,
      read(){const row=select.get(kind);if(!row)throw new Error("Plugin state document missing");return decode(row);},
      mutate(callback){
        return guarded(()=>{
          const state=decode(select.get(kind));
          if(!state)throw new Error("Plugin state document missing");
          const value=callback(state);
          if(!validate(state))throw new Error("Plugin state mutation invalid");
          update.run(JSON.stringify(state),new Date().toISOString(),kind);
          return value;
        });
      },
      close(){db.close();}
    };
  }catch(error){
    db.close();
    throw error;
  }
}
