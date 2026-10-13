// Incremental cross-device sync: one encrypted row per item (conversation, project, prompt, settings).
// Every write bumps a global revision so devices pull "everything after rev N". Conflicts resolve by
// item modification time (last writer wins); deletions are kept as tombstones so they propagate.
import {DatabaseSync} from "node:sqlite";
import {mkdirSync} from "node:fs";
import {join} from "node:path";

export const SYNC_KINDS=new Set(["conversation","project","prompt","settings"]);
export const SYNC_LIMITS={itemBytes:3_000_000,batchItems:200,pageItems:200,totalItems:6000};

// Rows belong to one user each; revisions are global, so "after rev N" only ever skips older rows.
// `legacyOwner` receives the rows of the single-owner table used before accounts had several users.
export function createSyncStore(dir,legacyOwner=null){
  mkdirSync(dir,{recursive:true});
  const db=new DatabaseSync(join(dir,"sync.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS sync_rows(
      user_id TEXT NOT NULL, key TEXT NOT NULL, kind TEXT NOT NULL, item_id TEXT NOT NULL,
      rev INTEGER NOT NULL, mtime INTEGER NOT NULL, deleted INTEGER NOT NULL, payload TEXT,
      PRIMARY KEY(user_id,key));
    CREATE INDEX IF NOT EXISTS sync_rows_rev ON sync_rows(user_id,rev);`);
  const legacy=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sync_items'").get();
  if(legacy&&legacyOwner){
    db.exec("BEGIN IMMEDIATE");
    try{
      db.prepare(`INSERT OR IGNORE INTO sync_rows(user_id,key,kind,item_id,rev,mtime,deleted,payload)
        SELECT ?,key,kind,item_id,rev,mtime,deleted,payload FROM sync_items`).run(legacyOwner);
      db.exec("DROP TABLE sync_items");db.exec("COMMIT");
    }catch(error){db.exec("ROLLBACK");throw error;}
  }
  const q={
    max:db.prepare("SELECT COALESCE(MAX(rev),0) AS rev FROM sync_rows"),
    userMax:db.prepare("SELECT COALESCE(MAX(rev),0) AS rev FROM sync_rows WHERE user_id=?"),
    count:db.prepare("SELECT COUNT(*) AS n FROM sync_rows WHERE user_id=? AND deleted=0"),
    total:db.prepare("SELECT COUNT(*) AS n FROM sync_rows WHERE user_id=?"),
    get:db.prepare("SELECT * FROM sync_rows WHERE user_id=? AND key=?"),
    since:db.prepare("SELECT * FROM sync_rows WHERE user_id=? AND rev>? ORDER BY rev LIMIT ?"),
    drop:db.prepare("DELETE FROM sync_rows WHERE user_id=?"),
    put:db.prepare(`INSERT INTO sync_rows(user_id,key,kind,item_id,rev,mtime,deleted,payload) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(user_id,key) DO UPDATE SET rev=excluded.rev,mtime=excluded.mtime,deleted=excluded.deleted,payload=excluded.payload`)
  };
  return {
    rev:user=>Number(q.userMax.get(user).rev),
    count:user=>Number(q.count.get(user).n),
    total:user=>Number(q.total.get(user).n),
    get:(user,key)=>q.get.get(user,key)||null,
    since:(user,rev,limit)=>q.since.all(user,rev,limit),
    removeUser:user=>q.drop.run(user),
    /** Atomically write a batch; `decide(existing)` returns the row to store or null to reject. */
    write(user,items,decide){
      db.exec("BEGIN IMMEDIATE");
      try{
        let rev=Number(q.max.get().rev);
        const results=items.map(item=>{
          const existing=q.get.get(user,item.key)||null;
          const row=decide(item,existing);
          if(!row)return {item,existing,accepted:false};
          rev+=1;
          q.put.run(user,item.key,item.kind,item.id,rev,item.mtime,item.deleted?1:0,row.payload);
          return {item,accepted:true,rev};
        });
        db.exec("COMMIT");
        return results;
      }catch(error){db.exec("ROLLBACK");throw error;}
    },
    close:()=>db.close()
  };
}
