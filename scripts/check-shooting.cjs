const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');

async function main() {
  const browser = await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
  const page = await browser.newPage({viewport:{width:1280,height:800}}), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const output = process.env.QA_OUTPUT_DIR;
  if (output) fs.mkdirSync(output,{recursive:true});
  const screenshot = async name => { if(output) await page.screenshot({path:path.join(output,name)}); };
  const scope = page.locator('.scope');
  const app = fn => page.evaluate(fn);
  const widget = label => page.evaluate(label => document.querySelector('#skeet-native-canvas').dataset.widgets.split('\n').map(l=>l.split('\t')).find(w=>w[0]===label),label);
  const toggleScope = async () => {
    const canvas = page.locator('#skeet-native-canvas');
    await page.waitForFunction(()=>document.querySelector('#skeet-native-canvas')?.dataset.widgets?.length>0);
    const r = await canvas.boundingBox();
    await page.mouse.click(r.x+40*r.width/660,r.y+344*r.height/560);
    await page.waitForTimeout(150);
    for(let i=0;i<30&&!await widget('Override scope');i++) {
      await page.mouse.move(r.x+470*r.width/660,r.y+420*r.height/560);
      await page.mouse.wheel(0,80);await page.waitForTimeout(60);
    }
    const w = await widget('Override scope');assert.ok(w,'compiled C++ scope override control');
    await page.mouse.click(r.x+(Number(w[1])+8)*r.width/660,r.y+(Number(w[2])+Number(w[4]))/2*r.height/560);
    await page.waitForTimeout(150);
    await page.keyboard.press('Escape');await page.locator('.skeet-native-root').waitFor({state:'detached'});
  };
  const enter = async mode => {
    await page.getByRole('button',{name:/Create room/}).click();await page.locator('#create-mode').selectOption(mode);
    await page.locator('#create-bots').fill('0');await page.getByRole('button',{name:'Create room',exact:true}).click();
    if(mode==='hvh') {
      await page.getByRole('dialog',{name:'HvH setup'}).waitFor();await page.getByRole('radio',{name:/Skeet/}).check();
      await page.getByRole('button',{name:'Configure Skeet',exact:true}).click();await toggleScope();
      assert.equal(await app(()=>window.__app.dev.config.skeet.native.Visuals_Effects_removeScopeOverlay),1);
      await page.getByRole('button',{name:'Begin match',exact:true}).click();
      await page.getByRole('dialog',{name:'HvH setup'}).waitFor({state:'detached'});
    }
    await page.mouse.click(640,400);await page.waitForFunction(()=>!!document.pointerLockElement);
    await page.keyboard.press('Digit3');await page.waitForTimeout(400);
    assert.equal(await app(()=>window.__app.game.activeSession.weapons.def.scope),true);
    await page.mouse.down({button:'right'});await scope.waitFor({state:'visible'});await page.waitForTimeout(500);
  };
  try {
    await page.addInitScript(()=>{
      localStorage.setItem('chikengun:cookie-notice','2');localStorage.setItem('chikengun:settings',JSON.stringify({fullscreen:false,quality:'low'}));
      localStorage.removeItem('chikengun:dev:skeet');
    });
    await page.goto(process.env.BASE_URL || 'http://localhost:3001');await page.locator('.main-menu .logo').waitFor();
    await enter('hvh');
    const origins = await app(()=>{
      const s=window.__app.game.activeSession, state={...s.local.state}, server=s.local.server, seq=s.nextSeq, core=s.weapons.hvh.core;
      try {
        Object.assign(s.local.state,{y:2,onGround:false,crouching:false,crouchAmount:0});
        s.local.server={...server,y:0,onGround:true,crouching:false,crouchAmount:0,ack:100,simulationTime:s.serverNow()};s.nextSeq=102;
        s.weapons.hvh.core={...core,fakeLag:0,latencyMs:0,jitterMs:0,packetLoss:0};const sent=s.eye(true).y;
        s.weapons.hvh.core.fakeLag=12;return {sent,held:s.eye(true).y};
      } finally {Object.assign(s.local.state,state);s.local.server=server;s.nextSeq=seq;s.weapons.hvh.core=core;}
    });
    assert.equal(origins.sent,3.3,'normal shots use their delivered jump command origin');
    assert.equal(origins.held,1.3,'held commands cannot move the firing origin into an unsent jump');
    const trace = await app(()=>{
      const effects=window.__app.game.activeSession.effects;
      effects.tracer({x:10,y:2,z:10},{x:10,y:2,z:-30},0xfff1a8,'hitscan-check');
      const t=effects.tracers[(effects.nextTracer+effects.tracers.length-1)%effects.tracers.length];
      const first={length:t.mesh.scale.z,x:t.mesh.position.x,z:t.mesh.position.z};
      effects.update(0.016);
      const second={length:t.mesh.scale.z,x:t.mesh.position.x,z:t.mesh.position.z};
      const slot=effects.nextTracer,life=t.life;
      effects.tracer({x:99,y:99,z:99},{x:10,y:2,z:-20},0xfff1a8,'hitscan-check');
      return {first,second,corrected:t.mesh.scale.z,reused:effects.nextTracer===slot,lifeUnchanged:t.life===life};
    });
    assert.equal(trace.first.length,40,'the complete hitscan streak appears immediately');
    assert.deepEqual(trace.second,trace.first,'the streak fades without traveling');
    assert.equal(trace.corrected,30,'the accepted endpoint corrects the existing streak');
    assert.ok(trace.reused&&trace.lifeUnchanged,'confirmation creates no duplicate or replayed shot');
    assert.ok((await scope.getAttribute('class')).includes('override'));
    const optics = await app(()=>{const s=window.__app.game.activeSession;return {fov:s.camera.fov,zoom:s.weapons.def.zoom,base:window.__app.game.input.zoomScale,cone:document.querySelector('.scope').style.getPropertyValue('--cone')};});
    assert.equal(optics.cone,'0px');assert.ok(optics.base>0&&optics.base<1);
    await screenshot('Skeet-override-scope.png');
    const seq = await app(()=>window.__app.game.activeSession.weapons.shotSeq);
    await page.mouse.down();await page.waitForTimeout(30);
    assert.equal(await app(()=>window.__app.game.activeSession.weapons.shotSeq),seq+1);
    assert.equal(await scope.getAttribute('data-ready'),'false');
    assert.ok(await app(()=>document.querySelector('.scope-flare').getAnimations().length>0));
    assert.ok(await app(()=>window.__app.game.activeSession.effects.tracers.some(t=>t.mesh.visible&&t.mesh.scale.z>0)));
    await screenshot('Skeet-scope-shot.png');await page.mouse.up();
    await page.waitForFunction(()=>document.querySelector('.scope').dataset.ready==='true',null,{timeout:4000});
    await page.mouse.up({button:'right'});await scope.waitFor({state:'hidden'});await page.waitForTimeout(500);
    const wideFov = await app(()=>window.__app.game.activeSession.camera.fov);
    assert.ok(Math.abs(Math.tan(wideFov*Math.PI/360)/Math.tan(optics.fov*Math.PI/360)-optics.zoom)<0.05,'optical magnification matches the weapon zoom');
    await page.keyboard.press('Insert');await toggleScope();
    assert.equal(await app(()=>window.__app.dev.config.skeet.native.Visuals_Effects_removeScopeOverlay),0);
    await page.mouse.click(640,400);await page.mouse.down({button:'right'});await scope.waitFor({state:'visible'});
    assert.ok(!(await scope.getAttribute('class')).includes('override'));await page.waitForTimeout(500);
    await screenshot('Sniper-scope.png');await page.mouse.up({button:'right'});
    await page.reload();await page.locator('.main-menu .logo').waitFor();await enter('ffa');
    await app(()=>window.__app.dev.set('skeet.native.Visuals_Effects_removeScopeOverlay',1));await page.waitForTimeout(150);
    assert.ok(!(await scope.getAttribute('class')).includes('override'));assert.equal(await app(()=>window.__app.game.activeSession.hvhVisuals),null);
    await page.setViewportSize({width:640,height:480});await screenshot('Sniper-scope-small.png');
    await page.emulateMedia({reducedMotion:'reduce'});await page.mouse.down();await page.waitForTimeout(60);await page.mouse.up();
    assert.equal(await app(()=>document.querySelector('.scope-flare').getAnimations().length),0);
    assert.deepEqual(errors,[]);
    const result = {nativeOverride:true,normalScope:true,scopeCycling:true,shotPulse:true,instantHitscanStreak:true,ordinaryModeIsolation:true,smallViewport:true,reducedMotion:true,optics,errors};
    if(output) fs.writeFileSync(path.join(output,'shooting-browser-qa.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));
  } finally {await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
