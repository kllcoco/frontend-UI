import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {desktopPackagePreflight} from '../scripts/desktop-package-preflight.mjs';
function setup(){
 const root=mkdtempSync(join(tmpdir(),'ciro-package-gate-'));
 const file=(name,content='')=>{const p=join(root,name);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,content);};
 for(const name of ['desktop/main.cjs','desktop/preload.cjs','desktop/runtime.cjs','server/index.mjs'])file(name);
 file('electron-builder.yml',`asar: true\nfiles:\n  - dist/**/*\n  - desktop/**/*\n  - server/**/*\n  - package.json\n  - node_modules/**/*\nnsis:\n  perMachine: false\n`);
 file('package.json',JSON.stringify({main:'desktop/main.cjs',dependencies:{express:'^4',dotenv:'^16'}}));
 return {root,file,close:()=>rmSync(root,{recursive:true,force:true})};
}
test('source-only preflight does not require build artifacts or paid CI',()=>{
 const s=setup();try{assert.equal(desktopPackagePreflight(s.root).sourceReady,true);
  assert.throws(()=>desktopPackagePreflight(s.root,{phase:'win-source',platform:'linux'}),/Windows host/);
 }finally{s.close();}
});
test('built mode requires real frontend and installed production dependencies',()=>{
 const s=setup();try{
  assert.throws(()=>desktopPackagePreflight(s.root,{phase:'built'}),/dist\/index.html/);
  s.file('dist/index.html','<!doctype html>');
  assert.throws(()=>desktopPackagePreflight(s.root,{phase:'built'}),/Runtime package/);
  s.file('node_modules/express/package.json','{}');
  s.file('node_modules/dotenv/package.json','{}');
  assert.equal(desktopPackagePreflight(s.root,{phase:'built'}).buildReady,true);
 }finally{s.close();}
});
test('missing packaged backend and degraded installer config fail closed',()=>{
 const s=setup();try{
  s.file('electron-builder.yml','asar: false\n');
  assert.throws(()=>desktopPackagePreflight(s.root),/ASAR packaging/);
  s.file('electron-builder.yml','asar: true\nfiles:\n  - dist/**/*\nnsis:\n  perMachine: true\n');
  assert.throws(()=>desktopPackagePreflight(s.root),/excludes required input/);
 }finally{s.close();}
});
