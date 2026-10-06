import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {writeFileSync} from 'node:fs';
import {startGameServer} from '../server/src/app';
import {createMoveState,WEAPONS} from '../shared/src';
import {defaultConfig} from '../client/src/dev/config';
const runtime=createRequire(import.meta.url);
const {chromium}=runtime(process.env.PLAYWRIGHT_PACKAGE || 'playwright');

async function main(){
 const server=await startGameServer({port:3002,dbPath:':memory:',clientDist:resolve(import.meta.dirname,'../client/dist'),publicHvhPanel:true,guestsPerHour:1000});
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']}),checks:any[]=[],errors:string[]=[];
 try{for(const scenario of ['scout-scope','manual-scope','jump-noscope','jump-scope-lag']){
  const known=new Set(server.io.sockets.sockets.keys()),page=await browser.newPage({viewport:{width:1280,height:800}});
  page.on('pageerror',(e:Error)=>errors.push(e.message));
  const config=defaultConfig('skeet');config.rage.aim.enabled=true;config.rage.aim.autoTarget=scenario!=='manual-scope';
  config.legit.move.bhop=scenario.startsWith('jump');
  config.skeet.profiles.snipers.autoScope=scenario!=='jump-noscope';config.skeet.native.Visuals_Effects_removeScopeOverlay=1;
  if(scenario==='jump-scope-lag'){
   Object.assign(config.skeet.fakeLag,{enabled:true,limit:12,breakOnShot:false});
   Object.assign(config.hvh.core,{latencyMs:120,jitterMs:30});
  }
  await page.addInitScript(config=>{
   localStorage.setItem('chikengun:settings',JSON.stringify({fullscreen:false,quality:'low'}));localStorage.setItem('chikengun:cookie-notice','2');
   localStorage.setItem('chikengun:dev:skeet',JSON.stringify(config));
  },config);
  await page.goto('http://localhost:3002');await page.getByRole('button',{name:/Create room/}).click();
  await page.locator('#create-mode').selectOption('hvh');await page.locator('#create-map').selectOption('farm');await page.locator('#create-bots').fill('1');
  await page.getByRole('button',{name:'Create room',exact:true}).click();await page.getByRole('dialog',{name:'HvH setup'}).waitFor();await page.getByRole('radio',{name:/Skeet/}).check();
  const socket=[...server.io.sockets.sockets.values()].find(s=>!known.has(s.id)&&server.rooms.roomOf(s.id))!,room=server.rooms.roomOf(socket.id)!,p=room.playerFor(socket.id)!;
  const events:any[]=[],requests:any[]=[];
  const emit=socket.emit.bind(socket);(socket as any).emit=(name:string,...args:any[])=>{if(name==='shot')events.push({...args[0],air:!p.state.onGround,y:p.state.y,at:performance.now(),age:performance.now()-args[0].audit?.recordT});return emit(name,...args);};
  const fire=room.handleFire.bind(room);room.handleFire=(shooter:any,req:any)=>{
   if(shooter===p)requests.push({shot:req.shot,aiming:req.aiming,air:!p.state.onGround,speed:p.state.horizontalSpeed,age:performance.now()-req.t,command:req.command,ack:p.lastSeq});return fire(shooter,req);
  };
  await page.getByRole('button',{name:'Begin match',exact:true}).click();await page.getByRole('dialog',{name:'HvH setup'}).waitFor({state:'detached'});
  room.startNow();await page.waitForTimeout(700);
  p.info.loadout=['scout'];p.weaponSlot=0;room.respawnPlayer(p,performance.now());p.mags.set('scout',WEAPONS.scout.magazine);p.state=createMoveState(17,0,-12.5);
  if(scenario==='jump-scope-lag'){p.hvh.core!.latencyMs=120;p.hvh.core!.jitterMs=30;}
  const bot=[...room.players.values()].find(b=>b.info.bot)!;bot.respawn(17,12.5,Math.PI,performance.now(),0);bot.resolver.clear();
  const brain=(room.bots as any).brains.get(bot.pid);brain.hvhAnchor={...bot.state};brain.hvhCandidate=null;brain.hvhNextObserve=brain.hvhNextScan=0;
  p.shieldUntil=performance.now()+4500;bot.shieldUntil=performance.now()+900;
  socket.emit('playerUpdated',p.info);server.io.to(room.channel).emit('spawn',{pid:p.pid,x:17,y:0,z:-12.5,yaw:0});server.io.to(room.channel).emit('spawn',{pid:bot.pid,x:17,y:0,z:12.5,yaw:Math.PI});
  await page.evaluate("window.__scopeFrames=[];requestAnimationFrame(function sample(){const s=document.querySelector('.scope');if(s)window.__scopeFrames.push({t:performance.now(),visible:!s.hidden,ready:s.dataset.ready==='true'});if(window.__scopeFrames.length<600)requestAnimationFrame(sample);});");
  await page.waitForTimeout(300);if(!await page.evaluate(()=>!!document.pointerLockElement))await page.mouse.click(640,400);
  await page.waitForFunction(()=>!!document.pointerLockElement);
  if(scenario.startsWith('jump'))await page.keyboard.down('Space');
  if(scenario!=='jump-noscope'){
   await page.locator('.scope.override').waitFor({state:'visible',timeout:6000});
   if(scenario==='manual-scope'){await page.waitForFunction(()=>document.querySelector('.scope')?.getAttribute('data-ready')==='true');await page.waitForTimeout(200);await page.mouse.click(640,400);}
   if(process.env.QA_OUTPUT_DIR)await page.screenshot({path:resolve(process.env.QA_OUTPUT_DIR,'Scout-'+scenario+'.png')});
  }
  await page.waitForTimeout(4800);await page.keyboard.up('Space');
  const shots=events.filter(e=>e.pid===p.pid&&e.weapon==='scout'),hits=shots.filter(e=>e.audit?.reason==='HIT'&&e.audit.damage>0);
  const frames=await page.evaluate(()=>(window as any).__scopeFrames as {t:number;visible:boolean;ready:boolean}[]);
  let scopeFrames=0;if(scenario!=='jump-noscope'){const pulse=frames.find((f,i)=>i>0&&f.visible&&!f.ready&&frames[i-1]!.visible&&frames[i-1]!.ready);if(!pulse){console.log(JSON.stringify({scenario,shots,requests,frames}));}assert.ok(pulse,'captured actual firing-cycle transition');const cycle=frames.filter(f=>f.t>=pulse.t&&f.t<pulse.t+WEAPONS.scout.fireInterval-150);assert.ok(cycle.length>10,'scope frame sample');assert.ok(cycle.every(f=>f.visible),'scope remains visible through target death and bolt cycle');scopeFrames=cycle.length;}
  const airborneHits=hits.filter(e=>e.air),result={scenario,scopeFrames,shots:shots.length,damage:hits.reduce((n,e)=>n+e.audit.damage,0),airborneHits:airborneHits.length,reasons:shots.map(e=>e.audit?.reason),events:shots.map(e=>({age:e.age,air:e.air,y:e.y,audit:e.audit,hits:e.hits})),lastInput:p.lastInput,requests};
  checks.push(result);console.log(JSON.stringify(result));assert.ok(result.damage>0,scenario);assert.ok(!result.reasons.includes('RECORD_INVALID'));
  if(scenario.startsWith('jump'))assert.ok(airborneHits.length>0,'actual airborne Scout damage');
  if(scenario==='jump-noscope')assert.ok(requests.filter(r=>r.shot>=hits[0]?.shot).every(r=>!r.aiming));
  else assert.ok(requests.some(r=>r.aiming),'Skeet auto-scope still prepares and fires');
  await page.close();room.close();
 }}finally{await browser.close();await server.close();}
 assert.deepEqual(errors,[]);if(process.env.QA_OUTPUT_DIR)writeFileSync(resolve(process.env.QA_OUTPUT_DIR,'hvh-duels-qa.json'),JSON.stringify({checks,errors},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
