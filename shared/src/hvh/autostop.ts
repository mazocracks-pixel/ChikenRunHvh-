import { CROUCH, PLAYER, SIM_DT } from '../constants';
import { clamp, normalize, type Vec3 } from '../math';
import { createMoveState, stepPlayer, type InputFrame, type MoveState } from '../physics';
import { makeRay, raycastWorld } from '../raycast';
import { SOURCE_MOVE } from '../movement';
import type { CollisionWorld } from '../collision';
import type { ObservableRecord } from './animation';

export interface AutoStopOptions {
  autoStop: boolean; autoStopSlowWalk: boolean; autoStopBetweenShots: boolean;
  autoStopPredict: boolean; autoStopPredictMs: number;
}
export interface PeekForecast { target: number; observedAt: number; etaMs: number; origin: Vec3 }
export type AutoStopKind = 'off' | 'slowwalk' | 'counter';
export interface AutoStopContext {
  assistedHvh: boolean; grounded: boolean; jumping: boolean; occupied: boolean; engaged: boolean;
  weaponState: 'Ready' | 'Cooldown' | 'Empty' | 'Reloading' | 'Switching weapon';
  target: boolean; stopSpeed?: number; forecast: PeekForecast | null;
}
export interface AutoStopPlan { kind: AutoStopKind; reason: 'idle' | 'target' | 'between-shots' | 'predicted-peek' }
/** Timing options are independent of the physical stop method. */
export function planAutoStop(o: AutoStopOptions, c: AutoStopContext): AutoStopPlan {
  const off: AutoStopPlan = { kind: 'off', reason: 'idle' };
  if (!o.autoStop || !c.assistedHvh || !c.grounded || c.jumping || c.occupied || !c.engaged) return off;
  if (c.weaponState !== 'Ready' && !(o.autoStopBetweenShots && c.weaponState === 'Cooldown')) return off;
  const predicted = o.autoStopPredict && c.forecast !== null;
  if (!c.target && !predicted) return off;
  const kind = o.autoStopSlowWalk && !(c.target && c.stopSpeed === 0) ? 'slowwalk' : 'counter';
  return { kind, reason: !c.target && predicted ? 'predicted-peek' : c.weaponState === 'Cooldown' ? 'between-shots' : 'target' };
}
/** Use native walking or counter-input, never clamp authoritative velocity. */
export function autoStopInput(frame: InputFrame, state: MoveState, plan: AutoStopPlan): InputFrame {
  if (plan.kind === 'off') return frame;
  if (plan.kind === 'slowwalk') return { ...frame, slowWalk: true };
  const x = -((state.walkVx ?? 0) + state.vx), z = -((state.walkVz ?? 0) + state.vz), speed = Math.hypot(x,z);
  return { ...frame, forward: speed > 0.4 ? (-Math.sin(frame.yaw)*x-Math.cos(frame.yaw)*z)/speed : 0,
    right: speed > 0.4 ? (Math.cos(frame.yaw)*x-Math.sin(frame.yaw)*z)/speed : 0 };
}

export interface PeekPredictionInput {
  now: number; eye: Vec3; view: Vec3; fov: number; range: number; horizonMs: number;
  records: readonly ObservableRecord[]; world: CollisionWorld;
}
function visible(input: PeekPredictionInput, origin: Vec3, crouch: number): boolean {
  const scale = 1-clamp(crouch,0,1)*0.3, cos = Math.cos(clamp(input.fov,1,360)*Math.PI/360);
  for (const height of [1.15,0.75]) {
    const delta = { x:origin.x-input.eye.x, y:origin.y+height*scale-input.eye.y, z:origin.z-input.eye.z };
    const distance = Math.hypot(delta.x,delta.y,delta.z);
    if (distance<0.01 || distance>input.range) continue;
    const direction = normalize(delta);
    if (direction.x*input.view.x+direction.y*input.view.y+direction.z*input.view.z < cos-1e-6) continue;
    const hit = raycastWorld(makeRay(input.eye,direction),input.world,distance);
    if (!hit || hit.t>=distance-0.02) return true;
  }
  return false;
}
/** Forecast movement only. Future poses never become aim, resolver or rewind records. */
export function predictEnemyPeek(input: PeekPredictionInput): PeekForecast | null {
  const tracks = new Map<number,ObservableRecord[]>();
  for (const r of input.records) {
    if (!r.alive || !Number.isFinite(r.t) || r.t>input.now+16 || input.now-r.t>300) continue;
    const track = tracks.get(r.pid) ?? []; if (!track.some(v=>v.t===r.t)) track.push(r); tracks.set(r.pid,track);
  }
  const candidates = [...tracks.values()].map(t=>t.sort((a,b)=>b.t-a.t)).sort((a,b)=>
    Math.hypot(a[0]!.origin.x-input.eye.x,a[0]!.origin.z-input.eye.z)-Math.hypot(b[0]!.origin.x-input.eye.x,b[0]!.origin.z-input.eye.z)).slice(0,8);
  let best: PeekForecast | null = null;
  for (const [latest,previous] of candidates) {
    if (!latest || !previous || input.now-latest.t>200 || latest.hp<=0) continue;
    const values = [latest.origin.x,latest.origin.y,latest.origin.z,latest.velocity.x,latest.velocity.y,latest.velocity.z,
      previous.origin.x,previous.origin.y,previous.origin.z,previous.velocity.x,previous.velocity.y,previous.velocity.z];
    if (!values.every(Number.isFinite)) continue;
    const elapsed = (latest.t-previous.t)/1000, speed = Math.hypot(latest.velocity.x,latest.velocity.z), priorSpeed = Math.hypot(previous.velocity.x,previous.velocity.z);
    if (elapsed<SIM_DT/2 || elapsed>0.25 || speed<0.2 || speed>SOURCE_MOVE.maxVelocity || priorSpeed<0.1) continue;
    if ((latest.velocity.x*previous.velocity.x+latest.velocity.z*previous.velocity.z)/(speed*priorSpeed)<0.3) continue;
    const error = Math.hypot(latest.origin.x-previous.origin.x-(latest.velocity.x+previous.velocity.x)*elapsed/2,
      latest.origin.z-previous.origin.z-(latest.velocity.z+previous.velocity.z)*elapsed/2);
    if (error>Math.max(0.35,speed*elapsed*0.75) || visible(input,latest.origin,latest.crouch)) continue;
    const state = createMoveState(latest.origin.x,latest.origin.y,latest.origin.z);
    state.walkVx=latest.velocity.x;state.walkVz=latest.velocity.z;state.vy=latest.velocity.y;
    state.onGround=latest.grounded;state.crouching=latest.crouch>0.5;state.crouchAmount=latest.crouch;
    const age = Math.max(0,input.now-latest.t), span = Math.min(300,age+clamp(input.horizonMs,50,300));
    const moveScale = state.crouching?CROUCH.speed:1;
    const frame: InputFrame = {seq:0,forward:latest.grounded?-latest.velocity.z/speed:0,right:latest.grounded?latest.velocity.x/speed:0,
      yaw:0,pitch:0,jump:false,crouch:state.crouching};
    // Constant observed ground speed is the extrapolation assumption; normal collision still applies.
    for (let time=0;time<span;) {
      const dt=Math.min(SIM_DT,(span-time)/1000);time+=dt*1000;
      stepPlayer(state,frame,dt,input.world,null,0.1,speed/(PLAYER.speed*moveScale),true);
      if (time+1e-6<age || !visible(input,state,latest.crouch)) continue;
      const etaMs=Math.max(0,time-age);
      if (!best || etaMs<best.etaMs) best={target:latest.pid,observedAt:latest.t,etaMs,origin:{x:state.x,y:state.y,z:state.z}};
      break;
    }
  }
  return best;
}
