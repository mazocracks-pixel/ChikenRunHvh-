import * as THREE from 'three';
import { mulberry32, type BoxKind } from '@game/shared';

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  draw(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function speckle(ctx: CanvasRenderingContext2D, size: number, seed: number, count: number, light: string, dark: string): void {
  const rand = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = rand() > 0.5 ? light : dark;
    ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 1 + rand() * 2);
  }
}

export function grassTexture(): THREE.CanvasTexture {
  return canvasTexture(512, (ctx, size) => {
    const rand = mulberry32(1);
    ctx.fillStyle = '#62a046';
    ctx.fillRect(0, 0, size, size);
    // Soft clumps of lighter and darker grass, drawn wrapped so the texture still tiles.
    for (let i = 0; i < 70; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 18 + rand() * 50;
      const tone = rand() > 0.5 ? '150, 200, 95' : '45, 95, 35';
      for (const ox of [-size, 0, size]) {
        for (const oy of [-size, 0, size]) {
          const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
          g.addColorStop(0, `rgba(${tone}, 0.22)`);
          g.addColorStop(1, `rgba(${tone}, 0)`);
          ctx.fillStyle = g;
          ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
        }
      }
    }
    // Thousands of little blades in a few shades.
    const shades = ['rgba(175, 220, 120, 0.5)', 'rgba(120, 180, 80, 0.55)', 'rgba(60, 115, 40, 0.5)', 'rgba(35, 80, 28, 0.45)', 'rgba(200, 210, 120, 0.35)'];
    ctx.lineCap = 'round';
    for (let i = 0; i < 9000; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const len = 3 + rand() * 7;
      const lean = (rand() - 0.5) * 4;
      ctx.strokeStyle = shades[Math.floor(rand() * shades.length)]!;
      ctx.lineWidth = 1 + rand() * 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + lean, y - len);
      ctx.stroke();
    }
  });
}

export function asphaltTexture(): THREE.CanvasTexture {
  return canvasTexture(256, (ctx, size) => {
    ctx.fillStyle = '#5b5f66';
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, 11, 3000, 'rgba(255,255,255,0.08)', 'rgba(0,0,0,0.15)');
  });
}

export function pavementTexture(): THREE.CanvasTexture {
  return canvasTexture(128, (ctx, size) => {
    ctx.fillStyle = '#a7a39b';
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, 12, 500, 'rgba(255,255,255,0.12)', 'rgba(0,0,0,0.1)');
    ctx.strokeStyle = 'rgba(70,65,60,0.45)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= size; i += size / 2) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, size);
      ctx.moveTo(0, i);
      ctx.lineTo(size, i);
      ctx.stroke();
    }
  });
}

/** Light grid for Sandbox, one square per building cell. */
export function gridTexture(): THREE.CanvasTexture {
  return canvasTexture(128, (ctx, size) => {
    ctx.fillStyle = '#7fbf6a';
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, 13, 400, 'rgba(255,255,255,0.08)', 'rgba(0,0,0,0.06)');
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, size, size);
  });
}

export function crateTexture(): THREE.CanvasTexture {
  return canvasTexture(256, (ctx, size) => {
    const rand = mulberry32(2);
    ctx.fillStyle = '#c28a4e';
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 32) {
      ctx.fillStyle = `rgba(90, 50, 20, ${0.08 + rand() * 0.12})`;
      ctx.fillRect(0, y, size, 32);
      ctx.fillStyle = 'rgba(70, 40, 15, 0.45)';
      ctx.fillRect(0, y, size, 2);
    }
    ctx.strokeStyle = '#7a4e25';
    ctx.lineWidth = 26;
    ctx.strokeRect(13, 13, size - 26, size - 26);
    ctx.lineWidth = 22;
    ctx.beginPath();
    ctx.moveTo(20, 20);
    ctx.lineTo(size - 20, size - 20);
    ctx.stroke();
  });
}

export function hayTexture(): THREE.CanvasTexture {
  return canvasTexture(128, (ctx, size) => {
    const rand = mulberry32(3);
    ctx.fillStyle = '#e2bd5e';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 420; i++) {
      ctx.strokeStyle = rand() > 0.5 ? 'rgba(255, 235, 150, 0.5)' : 'rgba(160, 120, 40, 0.35)';
      ctx.lineWidth = 1;
      const x = rand() * size;
      const y = rand() * size;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rand() - 0.5) * 6, y + 6 + rand() * 10);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(120, 80, 30, 0.6)';
    ctx.fillRect(0, size * 0.3, size, 4);
    ctx.fillRect(0, size * 0.7, size, 4);
  });
}

function bricks(seed: number, mortar: string, base: [number, number, number], jitter: number, rows: number) {
  return canvasTexture(256, (ctx, size) => {
    const rand = mulberry32(seed);
    ctx.fillStyle = mortar;
    ctx.fillRect(0, 0, size, size);
    const brickH = size / rows;
    const brickW = size / (rows / 2);
    for (let row = 0; row < rows; row++) {
      const offset = row % 2 === 0 ? 0 : brickW / 2;
      for (let col = -1; col < size / brickW + 1; col++) {
        const j = Math.floor(rand() * jitter);
        ctx.fillStyle = `rgb(${base[0] + j}, ${base[1] + j}, ${base[2] + j})`;
        ctx.fillRect(offset + col * brickW + 3, row * brickH + 3, brickW - 6, brickH - 6);
      }
    }
  });
}

export function stoneTexture(): THREE.CanvasTexture {
  return bricks(4, '#6d7075', [150, 153, 158], 30, 4);
}

/** Big pale sandstone blocks (Sandstown walls). */
export function sandstoneTexture(): THREE.CanvasTexture {
  return bricks(11, '#b89a6e', [214, 186, 140], 22, 4);
}

/** Neutral corrugated metal, for boxes with their own colour (shipping containers, machines). */
export function containerTexture(): THREE.CanvasTexture {
  return canvasTexture(128, (ctx, size) => {
    ctx.fillStyle = '#d4d4d4';
    ctx.fillRect(0, 0, size, size);
    for (let x = 0; x < size; x += 16) {
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(x, 0, 5, size);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x + 8, 0, 3, size);
    }
    speckle(ctx, size, 23, 300, 'rgba(255,255,255,0.08)', 'rgba(0,0,0,0.1)');
  });
}

/** Packed snow with faint blue shadows. */
export function snowTexture(): THREE.CanvasTexture {
  return canvasTexture(256, (ctx, size) => {
    ctx.fillStyle = '#eef4f8';
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, 21, 2200, 'rgba(255,255,255,0.5)', 'rgba(120,150,180,0.12)');
  });
}

/** Factory floor: grey concrete tiles with yellow hazard stripes. */
export function factoryFloorTexture(): THREE.CanvasTexture {
  return canvasTexture(256, (ctx, size) => {
    ctx.fillStyle = '#8d8f91';
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, 22, 1400, 'rgba(255,255,255,0.08)', 'rgba(0,0,0,0.12)');
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let i = 0; i <= size; i += size / 4) {
      ctx.fillRect(i - 1, 0, 2, size);
      ctx.fillRect(0, i - 1, size, 2);
    }
    ctx.fillStyle = 'rgba(230,180,40,0.55)';
    ctx.fillRect(0, size * 0.48, size, size * 0.04);
  });
}

/** Wind-rippled desert sand. */
export function sandTexture(): THREE.CanvasTexture {
  return canvasTexture(256, (ctx, size) => {
    ctx.fillStyle = '#d8bf8e';
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, 12, 2600, 'rgba(255,248,225,0.18)', 'rgba(120,90,50,0.14)');
    const rand = mulberry32(13);
    ctx.strokeStyle = 'rgba(150,115,70,0.12)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 18; i++) {
      const y = rand() * size;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= size; x += 16) ctx.lineTo(x, y + Math.sin(x / 30 + i) * 4);
      ctx.stroke();
    }
  });
}

/** A ChikenBomb site marking: a red ring with the site's letter. */
export function bombSiteTexture(letter: string): THREE.CanvasTexture {
  return canvasTexture(256, (ctx, size) => {
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(214, 52, 40, 0.85)';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(214, 52, 40, 0.16)';
    ctx.fill();
    ctx.fillStyle = 'rgba(214, 52, 40, 0.9)';
    ctx.font = 'bold 150px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, size / 2, size / 2 + 8);
  });
}

export function brickTexture(): THREE.CanvasTexture {
  return bricks(5, '#c9bba4', [158, 72, 52], 28, 8);
}

export function roofTexture(): THREE.CanvasTexture {
  return canvasTexture(128, (ctx, size) => {
    ctx.fillStyle = '#5a5f66';
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, 6, 600, 'rgba(255,255,255,0.08)', 'rgba(0,0,0,0.12)');
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let i = 0; i < size; i += 16) ctx.fillRect(0, i, size, 2);
  });
}

export function woodTexture(): THREE.CanvasTexture {
  return canvasTexture(128, (ctx, size) => {
    const rand = mulberry32(7);
    ctx.fillStyle = '#9b6b3d';
    ctx.fillRect(0, 0, size, size);
    for (let x = 0; x < size; x += 21) {
      ctx.fillStyle = `rgba(60, 35, 15, ${0.15 + rand() * 0.2})`;
      ctx.fillRect(x, 0, 21, size);
      ctx.fillStyle = 'rgba(40, 20, 5, 0.5)';
      ctx.fillRect(x, 0, 2, size);
    }
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = 'rgba(60,30,10,0.25)';
      ctx.beginPath();
      const x = rand() * size;
      ctx.moveTo(x, rand() * size);
      ctx.lineTo(x + (rand() - 0.5) * 4, rand() * size);
      ctx.stroke();
    }
  });
}

export function metalTexture(): THREE.CanvasTexture {
  return canvasTexture(128, (ctx, size) => {
    ctx.fillStyle = '#4f7d5b';
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, 8, 500, 'rgba(255,255,255,0.08)', 'rgba(0,0,0,0.12)');
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    for (let i = 0; i < size; i += 32) ctx.fillRect(i, 0, 3, size);
  });
}

export function concreteTexture(): THREE.CanvasTexture {
  return canvasTexture(128, (ctx, size) => {
    ctx.fillStyle = '#b8b5ae';
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, 9, 900, 'rgba(255,255,255,0.12)', 'rgba(0,0,0,0.12)');
  });
}

/** Box kinds → texture and how many metres one repeat covers. Crates show one crate per face. */
export function boxTexture(kind: BoxKind): { texture: THREE.CanvasTexture; tile: number | null } {
  switch (kind) {
    case 'crate':
      return { texture: crateTexture(), tile: null };
    case 'hay':
      return { texture: hayTexture(), tile: 1.2 };
    case 'stone':
      return { texture: stoneTexture(), tile: 1.5 };
    case 'brick':
      return { texture: brickTexture(), tile: 1.6 };
    case 'roof':
      return { texture: roofTexture(), tile: 2 };
    case 'wood':
      return { texture: woodTexture(), tile: 1.2 };
    case 'metal':
      return { texture: metalTexture(), tile: 1.5 };
    case 'sandstone':
      return { texture: sandstoneTexture(), tile: 2.4 };
    case 'concrete':
    case 'car':
      return { texture: concreteTexture(), tile: 2 };
  }
}

export function mysteryBoxTexture(): THREE.CanvasTexture {
  return canvasTexture(128, (ctx, size) => {
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, '#ffd54f');
    grad.addColorStop(1, '#ff9f1c');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#b26a00';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, size - 10, size - 10);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 84px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', size / 2, size / 2 + 4);
  });
}

/** Soft round puff used for smoke, explosion clouds and dust. */
export function puffTexture(): THREE.CanvasTexture {
  const texture = canvasTexture(64, (ctx, size) => {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  });
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

/**
 * A box whose UVs are scaled by face size, so a texture tiles once every `tile` metres
 * on every face instead of stretching over long walls.
 */
export function tiledBoxGeometry(w: number, h: number, d: number, tile: number): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(w, h, d);
  const uv = geometry.getAttribute('uv');
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 vertices each).
  const faceSizes: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  faceSizes.forEach(([u, v], face) => {
    for (let i = face * 4; i < face * 4 + 4; i++) {
      uv.setXY(i, (uv.getX(i) * u) / tile, (uv.getY(i) * v) / tile);
    }
  });
  uv.needsUpdate = true;
  return geometry;
}
