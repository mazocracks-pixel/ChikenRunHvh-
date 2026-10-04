import { WEAPONS, WEAPON_IDS, damageAt } from '@game/shared';
import { defaultLook, SURFACES } from '../game/look';
import { getCameraMode, setCameraMode } from '../game/CameraRig';
import type { Control, Tab } from './controls';
import type { Dev } from './Dev';
import { configsPanel } from './panels/configs';
import { playersPanel } from './panels/players';

export function buildTabs(dev: Dev): Tab[] {
  const toggle=(label:string,path:string,hint?:string):Control=>({type:'toggle',label,path,hint});
  const slider=(label:string,path:string,unit?:string,hint?:string):Control=>({type:'slider',label,path,unit,hint});
  const key=(label:string,path:string,hint?:string):Control=>({type:'key',label,path,hint});
  const select=(label:string,path:string,hint?:string):Control=>({type:'select',label,path,hint});
  const info=(label:string,value:()=>string,hint?:string):Control=>({type:'info',label,value,hint});
  const selected=()=>WEAPONS[dev.config.weapons.selected];
  return [
    {id:'aim',label:'Aim',icon:'⌖',configKey:['rage.aim','hvh.aim','legit.trigger'],sections:[
      {title:'HvH rules',icon:'◇',wide:true,items:[info('Equal stats',()=> 'Normal damage · spread · recoil · ammo · movement'),info('Shot policy',()=> 'Enemies only · valid bullet paths · real server hitboxes','Minimum damage / hitchance are estimates. Manual shots stay available; cover and recoil still matter.')]},
      {title:'Targeting',icon:'⌖',items:[toggle('Aim assist','rage.aim.enabled'),toggle('Auto fire','rage.aim.autoTarget','Normal fire timers and ammunition apply'),toggle('Target lock','rage.aim.lock'),select('Target priority','rage.aim.priority'),select('Hitbox','rage.aim.hitbox'),slider('Aim FOV','rage.aim.fov','°'),slider('Reaction delay','hvh.aim.reaction','ms'),slider('Target switch delay','hvh.aim.switchDelay','ms'),slider('Turn speed','hvh.aim.turnRate','°/s')]},
      {title:'Shot selection',icon:'◎',items:[slider('Minimum damage','hvh.aim.minDamage','HP','Predicted health damage after armor; lethal shots can pass'),slider('Hit chance','hvh.aim.hitchance','%','Sampled from actual speed, weapon spread and the current shot path'),select('Body aim preference','hvh.aim.bodyAim'),toggle('Autowall','hvh.aim.autowall','Normal penetration: up to two crates / hay / wood, 35% damage loss per box'),key('Force body aim','hvh.aim.bodyKey','Hold J by default'),slider('Damage override threshold','hvh.aim.damageOverride','HP'),key('Damage override key','hvh.aim.overrideKey','Hold H; changes the threshold, never weapon damage')]},
      {title:'Trigger',icon:'ϟ',items:[toggle('Trigger assist','legit.trigger.enabled','Used when aim assist is off'),slider('Trigger delay','legit.trigger.delay','ms'),slider('Trigger FOV','legit.trigger.fov','°'),key('Trigger key','legit.trigger.key','Empty = always active while playing')]},
    ]},
    {id:'antiaim',label:'Anti-aim',icon:'↻',configKey:['hvh.antiAim','hvh.invertKey'],sections:[
      {title:'Real / fake stance',icon:'↻',items:[toggle('Enable anti-aim','hvh.antiAim.enabled','HvH only. The server computes both headings'),select('Yaw base','hvh.antiAim.mode'),slider('Desync angle','hvh.antiAim.desync','°','Fake body offset, capped at 58°'),slider('Jitter amplitude','hvh.antiAim.jitter','°','Alternates every 180 ms; capped at 45°'),slider('Spin speed','hvh.antiAim.spinSpeed','°/s'),key('Invert desync','hvh.invertKey','Hold K to switch sides')]},
      {title:'Resolver & counterplay',icon:'◈',items:[toggle('Resolve real hitboxes','hvh.feedback.resolver','Aim and ESP use the authoritative real stance'),info('Cyan stance marker',()=> 'Every HvH player sees the real heading','The rendered chicken is the fake pose. Cyan arrow = real heading. Shots reveal your stance for 300 ms.'),info('Limits',()=> 'No fake pitch · no invulnerability · no hidden hitbox state')]},
    ]},
    {id:'exploits',label:'Exploits',icon:'ϟ',configKey:'hvh.exploit',sections:[
      {title:'Shared charge',icon:'ϟ',items:[{type:'select',label:'Exploit mode',path:'hvh.exploit',options:[{value:'off',label:'Off'},{value:'doubleTap',label:'Double Tap'},{value:'hideShots',label:'Hide Shots'}]},info('Charge',()=> `${Math.round((dev.runtime.currentSession?.local.server.hvhCharge??0)*100)}%`),info('Double Tap',()=> 'One extra shot · 8 s recharge','Two normal bullets. Second shot uses an 80 ms minimum interval within a 500 ms window. Projectiles, melee and native bursts are excluded.'),info('Hide Shots',()=> 'Delay stance reveal · 6 s recharge','A charged shot delays the normal 300 ms reveal by 150 ms. Shot tracers and the real stance marker remain visible.'),info('Tradeoff',()=> 'One shared resource · normal magazine / reload','Changing modes or guns never refills charge; each respawn starts recharging.')]},
    ]},
    {id:'movement',label:'Movement',icon:'➶',configKey:['legit.move','hvh.movement','misc.autoJump'],sections:[
      {title:'Peek control',icon:'➶',items:[toggle('Auto-stop','hvh.movement.autoStop','Stops movement intent when aim has a target; remaining knockback still adds spread'),toggle('Slow walk','hvh.movement.slowWalk','45% input while held, on the ground'),key('Slow walk key','hvh.movement.slowKey','Shift by default'),toggle('Auto-peek return','hvh.movement.peekAssist','Hold key to mark an anchor; after shooting, release movement keys to return'),key('Auto-peek key','hvh.movement.peekKey','Hold Z; release to cancel. Jumping, blocked route or manual movement cancels return.'),info('Peek state',()=>dev.runtime.peekState)]},
      {title:'Normal movement helpers',icon:'⌁',items:[toggle('Bunny hop','legit.move.bhop'),toggle('Auto strafe','legit.move.autoStrafe'),toggle('Jump buffer','legit.move.jumpAssist','Remembers a jump pressed just before landing'),info('Movement limits',()=> 'Normal speed · collision · gravity · jetpack fuel')]},
    ]},
    {id:'visuals',label:'Visuals',icon:'◈',configKey:['visuals','legit.wall'],sections:[
      {title:'Player ESP',icon:'☐',items:[toggle('Enable ESP','visuals.esp.enabled'),...(['box','name','health','distance','weapon','skeleton','snaplines','headCircle','glow'] as const).map(k=>toggle(k==='headCircle'?'Head circle':k[0].toUpperCase()+k.slice(1),`visuals.esp.${k}`)),toggle('Wall silhouettes','legit.wall.enabled','HvH already provides enemy silhouettes to everyone'),{type:'color',label:'Enemy color',path:'visuals.colors.enemy'},{type:'color',label:'Friendly color',path:'visuals.colors.friendly'},slider('ESP opacity','visuals.colors.opacity')]},
      {title:'Arena markers',icon:'◇',items:[toggle('Items','visuals.world.items'),toggle('Projectiles / vehicles','visuals.world.weapons'),toggle('Objectives','visuals.world.objectives'),toggle('Hitboxes','visuals.world.hitboxes'),toggle('Collision outlines','visuals.world.collision')]},
    ]},
    {id:'weapons',label:'Weapons',icon:'✦',configKey:'weapons.selected',sections:[
      {title:'Weapon reference',icon:'✦',wide:true,items:[{type:'select',label:'Weapon reference',path:'weapons.selected',options:WEAPON_IDS.map(id=>({value:id,label:WEAPONS[id].name}))},info('Damage at 10 / 30 / 60 m',()=> selected().projectile?'Explosive splash': [10,30,60].map(d=>`${Math.round(damageAt(selected(),d)*selected().pellets)} HP`).join(' / ')),info('Fire interval / magazine',()=>`${selected().fireInterval} ms / ${selected().magazine} rounds`),info('Reload time',()=>`${selected().reloadTime} ms`),info('Weapon tuning',()=> 'Stats are fixed by the server','This reference does not equip or modify a weapon.')]},
    ]},
    {id:'world',label:'World',icon:'⛰',configKey:'world',sections:[
      {title:'Local arena palette',icon:'◐',items:[...SURFACES.map(s=>({type:'color' as const,label:s[0].toUpperCase()+s.slice(1),path:`world.${s}`})),{type:'color',label:'Sky',path:'world.zenith'},{type:'color',label:'Horizon',path:'world.horizon'},slider('Exposure','world.exposure'),{type:'buttons',label:'Reset palette',items:[{label:'Default palette',run:()=>{dev.set('world',defaultLook());dev.menuRefresh();}}]}]},
    ]},
    {id:'telemetry',label:'Telemetry',icon:'▤',configKey:['misc','hvh.feedback'],sections:[
      {title:'Shot decisions',icon:'▤',items:[toggle('Target information','hvh.feedback.targetInfo'),toggle('Shot log','hvh.feedback.shotLog'),info('Target',()=>dev.runtime.diagnostics.target),info('Prediction',()=>`~${dev.runtime.diagnostics.damage} HP / ${dev.runtime.diagnostics.chance}%`),info('Decision',()=>dev.runtime.diagnostics.state)]},
      {title:'Readouts',icon:'◎',items:[toggle('FPS counter','misc.fpsCounter'),toggle('Ping','misc.ping'),toggle('Coordinates','misc.coords'),toggle('Speed','misc.speed'),toggle('Map information','misc.mapInfo'),toggle('Crosshair','misc.crosshair'),toggle('Hitmarker','misc.hitmarker'),toggle('Damage indicator','misc.damageIndicator'),{type:'toggle',label:'Third person',bind:{get:()=>getCameraMode()==='third',set:v=>setCameraMode(v?'third':'first')}},{type:'buttons',label:'Crosshair',items:[{label:'Edit crosshair',run:()=>dev.openCrosshairSettings()}]}]},
      {title:'Match roster',icon:'☺',wide:true,items:[{type:'custom',label:'Players',render:()=>playersPanel(dev)}]},
    ]},
    {id:'configs',label:'Configs',icon:'▣',sections:[{title:'Configurations',icon:'▣',wide:true,items:[{type:'custom',label:'Configs',keywords:'save load delete rename export import preset',render:()=>configsPanel(dev)}]}]},
    {id:'settings',label:'Settings',icon:'☰',configKey:'settings',sections:[
      {title:'Menu',icon:'▦',items:[key('Menu key','settings.menuKey','Insert by default; also available from Pause → HvH panels'),slider('Menu scale','settings.scale','×'),slider('Menu opacity','settings.opacity'),slider('Animation speed','settings.animSpeed','×'),select('Theme','settings.theme'),{type:'color',label:'Accent',path:'settings.accent'},toggle('Sounds','settings.sounds'),toggle('Notifications','settings.notifications'),{type:'buttons',label:'Reset all',items:[{label:'Reset all settings',run:()=>{dev.resetAll();dev.menuRefresh();}}]}]},
    ]},
  ];
}
