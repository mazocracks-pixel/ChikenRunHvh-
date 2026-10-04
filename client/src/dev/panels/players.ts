import { h } from '../../ui/dom';
import type { Dev } from '../Dev';
/** Read-only roster; public configuration never controls other players. */
export function playersPanel(dev: Dev): HTMLElement & { refresh: () => void } {
  const root = h('div', { class:'dev-player-list' }) as unknown as HTMLElement & { refresh:()=>void };
  let key='';
  root.refresh=()=>{
    const session=dev.runtime.currentSession;
    const infos=session?[...session.infos.values()]:[];
    const next=JSON.stringify(infos.map(p=>[p.pid,p.name,p.kills,p.deaths]));
    if(next===key)return; key=next;
    root.replaceChildren(...(infos.length?infos.map(p=>h('div',{class:'dev-row'},h('span',null,p.name+(p.bot?' [BOT]':'')),h('span',null,`${p.kills} K / ${p.deaths} D`))):[h('p',null,'Join a match to see the roster.')]));
  };
  root.refresh(); return root;
}
