// Incremental cross-device sync: one encrypted row per item (conversation, project, prompt, settings).
// Every write bumps a global revision so devices pull "everything after rev N". Conflicts resolve by
// item modification time (last writer wins); deletions are kept as tombstones so they propagate.
import {DatabaseSync} from "node:sqlite";
import {mkdirSync} from "node:fs";
import {join} from "node:path";

export const SYNC_KINDS=new Set(["conversation","project","prompt","settings"]);
export const SYNC_LIMITS={itemBytes:3_000_000,batchItems:200,pageItems:200,totalItems:6000};

export function createSyncStore(dir){
  mkdirSync(dir,{recursive:true});
  const db=new DatabaseSync(join(dir,"sync.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS sync_items(
      key TEXT PRIMARY KEY, kind TEXT NOT NULL, item_id TEXT NOT NULL,
      rev INTEGER NOT NULL, mtime INTEGER NOT NULL, deleted INTEGER NOT NULL, payload TEXT);
    CREATE INDEX IF NOT EXISTS sync_items_rev ON sync_items(rev);`);
  const q={
    max:db.prepare("SELECT COALESCE(MAX(rev),0) AS rev FROM sync_items"),
    count:db.prepare("SELECT COUNT(*) AS n FROM sync_items WHERE deleted=0"),
    total:db.prepare("SELECT COUNT(*) AS n FROM sync_items"),
    get:db.prepare("SELECT * FROM sync_items WHERE key=?"),
    since:db.prepare("SELECT * FROM sync_items WHERE rev>? ORDER BY rev LIMIT ?"),
    put:db.prepare(`INSERT INTO sync_items(key,kind,item_id,rev,mtime,deleted,payload) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET rev=excluded.rev,mtime=excluded.mtime,deleted=excluded.deleted,payload=excluded.payload`)
  };
  return {
    rev:()=>Number(q.max.get().rev),
    count:()=>Number(q.count.get().n),
    total:()=>Number(q.total.get().n),
    get:key=>q.get.get(key)||null,
    since:(rev,limit)=>q.since.all(rev,limit),
    /** Atomically write a batch; `decide(existing)` returns the row to store or null to reject. */
    write(items,decide){
      db.exec("BEGIN IMMEDIATE");
      try{
        let rev=Number(q.max.get().rev);
        const results=items.map(item=>{
          const existing=q.get.get(item.key)||null;
          const row=decide(item,existing);
          if(!row)return {item,existing,accepted:false};
          rev+=1;
          q.put.run(item.key,item.kind,item.id,rev,item.mtime,item.deleted?1:0,row.payload);
          return {item,accepted:true,rev};
        });
        db.exec("COMMIT");
        return results;
      }catch(error){db.exec("ROLLBACK");throw error;}
    },
    close:()=>db.close()
  };
}
