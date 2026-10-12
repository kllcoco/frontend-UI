import {existsSync,readFileSync,statSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const manifestPaths=['desktop/main.cjs','desktop/preload.cjs','desktop/runtime.cjs',
 'server/index.mjs','electron-builder.yml','package.json'];
const archiveEntries=['dist/**/*','desktop/**/*','server/**/*','package.json','node_modules/**/*'];
const productionDeps=['express','dotenv'];

export function desktopPackagePreflight(root,{phase='source',platform=process.platform}={}){
 if(!['source','win-source','built'].includes(phase))throw Error('Unknown packaging preflight phase');
 if(phase==='win-source'&&platform!=='win32')throw Error('NSIS packaging requires a Windows host');
 const missing=manifestPaths.filter(path=>!existsSync(join(root,path)));
 if(missing.length)throw Error('Desktop source missing: '+missing.join(', '));
 const pack=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
 if(pack.main!=='desktop/main.cjs')throw Error('Electron main must point to desktop/main.cjs');
 for(const dep of productionDeps)if(!pack.dependencies?.[dep])
  throw Error('Missing runtime dependency: '+dep);
 const yaml=readFileSync(join(root,'electron-builder.yml'),'utf8');
 if(!/^asar:\s*true\s*$/m.test(yaml))throw Error('ASAR packaging must be enabled');
 for(const entry of archiveEntries){
  const present=yaml.split(/\r?\n/).some(line=>line.trim().startsWith('- ')&&
   line.trim().slice(2).trim().replace(/^["']|["']$/g,'')===entry);
  if(!present)throw Error('Electron packaging excludes required input: '+entry);
 }
 if(!/^\s*perMachine:\s*false\s*$/m.test(yaml))
  throw Error('First-party Windows installer must remain per-user');
 if(phase==='built'){
  const dist=join(root,'dist','index.html');
  if(!existsSync(dist)||!statSync(dist).isFile())throw Error('Built frontend dist/index.html missing');
  for(const dep of productionDeps)if(!existsSync(join(root,'node_modules',dep,'package.json')))
   throw Error('Runtime package not installed: '+dep);
 }
 return {ok:true,phase,sourceReady:true,buildReady:phase==='built'};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=resolve(process.cwd());
 try{
  const receipt=desktopPackagePreflight(root,{phase:process.argv[2]||'source'});
  process.stdout.write(JSON.stringify(receipt)+'\n');
 }catch(error){
  process.stderr.write('CIRO desktop preflight FAIL: '+error.message+'\n');
  process.exitCode=1;
 }
}
