import type { MapDef } from '@game/shared';
import { h } from './dom';

type Point = { x: number; z: number };

export function radarPoint(p: Point, radar: NonNullable<MapDef['radar']>): Point {
  return { x: (p.x - radar.x) / radar.size * 256, z: (p.z - radar.z) / radar.size * 256 };
}

export class Radar {
  private readonly label = h('span', { class: 'radar-location' });
  private readonly canvas = h('canvas', { width: 256, height: 256, 'aria-label': 'Radar: your position, teammates and bomb sites' });
  readonly root = h('div', { class: 'cs-radar' }, this.label, this.canvas);
  private map: MapDef | null = null;
  private readonly image = new Image();

  setMap(map: MapDef): void {
    this.map = map;
    this.root.hidden = !map.radar;
    if (map.radar) this.image.src = map.radar.image;
    this.label.textContent = map.name;
  }

  update(self: Point, yaw: number, teammates: readonly Point[]): void {
    const map = this.map, radar = map?.radar, ctx = this.canvas.getContext('2d');
    if (!map || !radar || !ctx) return;
    let nearest = Infinity, place = map.name;
    for (const p of map.nav ?? []) {
      if (!p.place) continue;
      const d = (p.x - self.x) ** 2 + (p.z - self.z) ** 2;
      if (d < nearest) { nearest = d; place = p.place.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^(CT|T)Spawn$/, '$1 Spawn'); }
    }
    this.label.textContent = nearest < 225 ? place : map.name;
    const centre = radarPoint(self, radar), zoom = 1.4;
    const screen = (p: Point) => { const q = radarPoint(p, radar); return { x: 128 + (q.x-centre.x)*zoom, z: 128 + (q.z-centre.z)*zoom }; };
    ctx.clearRect(0, 0, 256, 256);
    ctx.save();
    ctx.beginPath(); ctx.arc(128, 128, 125, 0, Math.PI*2); ctx.clip();
    ctx.fillStyle = '#121716'; ctx.fillRect(0, 0, 256, 256);
    if (this.image.complete && this.image.naturalWidth) ctx.drawImage(this.image, 128-centre.x*zoom, 128-centre.z*zoom, 256*zoom, 256*zoom);
    ctx.font = 'bold 17px Arial'; ctx.textAlign = 'center'; ctx.fillStyle = '#eedc87';
    for (const site of map.bombSites ?? []) { const p = screen(site); ctx.fillText(site.id, p.x, p.z); }
    ctx.fillStyle = '#89c6dc';
    for (const mate of teammates) { const p = screen(mate); ctx.beginPath(); ctx.arc(p.x, p.z, 4, 0, Math.PI*2); ctx.fill(); }
    ctx.translate(128, 128); ctx.rotate(-yaw);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 4); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#c1c4af'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(128, 128, 125, 0, Math.PI*2); ctx.stroke();
  }
}
