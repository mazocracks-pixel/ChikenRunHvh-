"""Rebuild Mirage from a local CS:GO installation. Requires numpy and Pillow.

Usage: python tools/import_mirage.py "C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive/csgo"
Source structures: cstrike15_src/public/{bspfile.h,studio.h,optimize.h} and game/server/nav_file.cpp.
"""
import io
import json
import math
import re
import struct
import sys
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SCALE = 0.025
BASE = -400


def parse_material(text):
    tokens = [t for t in re.findall(r'//[^\r\n]*|"(?:\\.|[^"\\])*"|[{}]|[^\s{}"]+', text.lstrip('\ufeff')) if not t.startswith('//')]
    cursor = 0
    def take():
        nonlocal cursor
        value = tokens[cursor]
        cursor += 1
        return value[1:-1] if value.startswith('"') else value
    def block():
        result = {}
        while cursor < len(tokens):
            key = take().lower()
            if key == '}': return result
            value = take()
            result[key] = block() if value == '{' else value
        raise ValueError('Unclosed VMT block')
    shader = take().lower()
    assert take() == '{', 'Expected a VMT shader block'
    return shader, block()


def position(p):
    return [round(float(p[0]) * SCALE, 4), round((float(p[2]) - BASE) * SCALE, 4), round(-float(p[1]) * SCALE, 4)]


def cstring(data, offset):
    end = data.index(0, offset)
    return data[offset:end].decode('utf8', 'replace'), end + 1


class Assets:
    def __init__(self, folder, pak):
        self.folder, self.pak = folder, pak
        data = (folder / 'pak01_dir.vpk').read_bytes()
        magic, version, size = struct.unpack_from('<3I', data)
        assert magic == 0x55aa1234 and version == 2, 'Expected a Source VPK v2'
        self.data, self.start, self.entries = data, 28 + size, {}
        cursor = 28
        while True:
            ext, cursor = cstring(data, cursor)
            if not ext:
                break
            while True:
                directory, cursor = cstring(data, cursor)
                if not directory:
                    break
                while True:
                    name, cursor = cstring(data, cursor)
                    if not name:
                        break
                    _, preload, archive, offset, length, terminator = struct.unpack_from('<IHHIIH', data, cursor)
                    assert terminator == 0xffff
                    cursor += 18
                    key = ((directory + '/') if directory != ' ' else '') + name + '.' + ext
                    self.entries[key.lower()] = (data[cursor:cursor + preload], archive, offset, length)
                    cursor += preload

    def read(self, name):
        name = name.replace('\\', '/').lower()
        if name in self.pak.namelist():
            return self.pak.read(name)
        loose = self.folder / name
        if loose.is_file():
            return loose.read_bytes()
        if name not in self.entries:
            raise FileNotFoundError(name)
        preload, archive, offset, length = self.entries[name]
        if archive == 0x7fff:
            return preload + self.data[self.start + offset:self.start + offset + length]
        with (self.folder / f'pak01_{archive:03}.vpk').open('rb') as file:
            file.seek(offset)
            return preload + file.read(length)

    def material(self, name, depth=0):
        assert depth < 8, 'Cyclic VMT patch'
        name = name.lower().removesuffix('.vmt').removeprefix('materials/')
        try:
            text = self.read('materials/' + name + '.vmt').decode('utf8', 'replace')
        except FileNotFoundError:
            return {}
        shader, values = parse_material(text)
        pairs = {k: v for k, v in values.items() if isinstance(v, str)}
        if 'include' in pairs:
            pairs = self.material(pairs['include'], depth + 1) | pairs
        for key in ('insert', 'replace'):
            pairs.update(values.get(key, {}))
        if shader != 'patch': pairs['shader'] = shader
        return pairs

    def texture(self, name):
        data = self.read('materials/' + name.removesuffix('.vtf') + '.vtf')
        assert data[:4] == b'VTF\0'
        header = struct.unpack_from('<I', data, 12)[0]
        width, height, flags, frames = struct.unpack_from('<HHIH', data, 16)
        fmt = struct.unpack_from('<I', data, 52)[0]
        mips, lowfmt, loww, lowh = struct.unpack_from('<BIBB', data, 56)
        formats = {13: (b'DXT1', 8), 14: (b'DXT3', 16), 15: (b'DXT5', 16), 20: (b'DXT1', 8)}
        assert fmt in formats, f'Unsupported VTF format {fmt}: {name}'
        fourcc, block = formats[fmt]
        size = lambda w, h, n: max(1, (w + 3) // 4) * max(1, (h + 3) // 4) * n
        offset = header + (size(loww, lowh, 8) if lowfmt == 13 and loww and lowh else 0)
        minor = struct.unpack_from('<I', data, 8)[0]
        if minor >= 3:
            resources = struct.unpack_from('<I', data, 68)[0]
            for i in range(resources):
                if data[80 + i * 8:83 + i * 8] == b'0\0\0':
                    offset = struct.unpack_from('<I', data, 84 + i * 8)[0]
        assert not flags & 0x4000, 'Cubemap is not a diffuse texture'
        for mip in range(mips - 1, 0, -1):
            offset += size(max(1, width >> mip), max(1, height >> mip), block) * frames
        length = size(width, height, block)
        dds = b'DDS ' + struct.pack('<7I', 124, 0x81007, height, width, length, 0, 0) + bytes(44)
        dds += struct.pack('<II4s5I', 32, 4, fourcc, 0, 0, 0, 0, 0) + struct.pack('<5I', 0x1000, 0, 0, 0, 0)
        image = Image.open(io.BytesIO(dds + data[offset:offset + length])).convert('RGBA')
        image.thumbnail((256, 256), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        image.save(out, format='PNG', optimize=True)
        return out.getvalue()


class Glb:
    def __init__(self, assets):
        self.assets, self.binary, self.groups = assets, bytearray(), {}
        self.models, self.instances = {}, {}
        self.doc = {'asset': {'version': '2.0', 'generator': 'ChickenRun Mirage importer'}, 'scene': 0,
                    'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0}], 'meshes': [], 'buffers': [],
                    'bufferViews': [], 'accessors': [], 'materials': [], 'textures': [], 'images': [],
                    'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}]}

    def view(self, data):
        while len(self.binary) % 4:
            self.binary.append(0)
        i = len(self.doc['bufferViews'])
        self.doc['bufferViews'].append({'buffer': 0, 'byteOffset': len(self.binary), 'byteLength': len(data)})
        self.binary.extend(data)
        return i

    def triangles(self, name, points, normals, uv):
        group = self.groups.setdefault(name, [[], [], []])
        group[0].extend(points)
        group[1].extend(normals)
        group[2].extend(uv)

    def instance(self, name, parts, origin, rotation, scale):
        if name not in self.models:
            groups = {}
            for material, points, normals, uv in parts:
                group = groups.setdefault(material, [[], [], []])
                group[0].extend([[p[0] * SCALE, p[2] * SCALE, -p[1] * SCALE] for p in points])
                group[1].extend([[n[0], n[2], -n[1]] for n in normals])
                group[2].extend(uv)
            self.models[name] = groups
        axis = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]])
        r = axis @ rotation @ axis.T
        # Eigenvector form is stable even for 180-degree prop rotations.
        k = np.array([[r[0, 0]-r[1, 1]-r[2, 2], r[1, 0]+r[0, 1], r[2, 0]+r[0, 2], r[2, 1]-r[1, 2]],
                      [r[1, 0]+r[0, 1], r[1, 1]-r[0, 0]-r[2, 2], r[2, 1]+r[1, 2], r[0, 2]-r[2, 0]],
                      [r[2, 0]+r[0, 2], r[2, 1]+r[1, 2], r[2, 2]-r[0, 0]-r[1, 1], r[1, 0]-r[0, 1]],
                      [r[2, 1]-r[1, 2], r[0, 2]-r[2, 0], r[1, 0]-r[0, 1], np.trace(r)]]) / 3
        _, vectors = np.linalg.eigh(k)
        quaternion = vectors[:, -1]
        if quaternion[3] < 0: quaternion = -quaternion
        self.instances.setdefault(name, [[], [], []])
        group = self.instances[name]
        group[0].append(position(origin))
        group[1].append(quaternion.tolist())
        group[2].append([scale] * 3)

    def save(self, path):
        primitives, textures, missing, materials, meshes = [], {}, [], {}, []
        groups = [('world', self.groups)] + list(self.models.items())
        for mesh_name, mesh_groups in groups:
          primitives = []
          for name, arrays in mesh_groups.items():
            vertex_data = np.column_stack(arrays).astype('<f4')
            unique, indices = np.unique(vertex_data, axis=0, return_inverse=True)
            arrays = [unique[:, :3], unique[:, 3:6], unique[:, 6:8]]
            attributes = {}
            for key, values in zip(('POSITION', 'NORMAL', 'TEXCOORD_0'), arrays):
                data = np.asarray(values, dtype='<f4')
                accessor = {'bufferView': self.view(data.tobytes()), 'componentType': 5126,
                            'count': len(data), 'type': 'VEC2' if key == 'TEXCOORD_0' else 'VEC3'}
                if key == 'POSITION':
                    accessor.update(min=data.min(axis=0).tolist(), max=data.max(axis=0).tolist())
                attributes[key] = len(self.doc['accessors'])
                self.doc['accessors'].append(accessor)
            pairs = self.assets.material(name)
            texture = pairs.get('$basetexture', '')
            material = {'name': name, 'doubleSided': True, 'pbrMetallicRoughness': {'metallicFactor': 0, 'roughnessFactor': 1}}
            if texture:
                try:
                    if texture not in textures:
                        png = self.assets.texture(texture)
                        image_index = len(self.doc['images'])
                        self.doc['images'].append({'bufferView': self.view(png), 'mimeType': 'image/png', 'name': texture})
                        textures[texture] = len(self.doc['textures'])
                        self.doc['textures'].append({'source': image_index, 'sampler': 0})
                    material['pbrMetallicRoughness']['baseColorTexture'] = {'index': textures[texture]}
                    if pairs.get('$alphatest') == '1':
                        material.update(alphaMode='MASK', alphaCutoff=0.5)
                    elif pairs.get('$translucent') == '1':
                        material['alphaMode'] = 'BLEND'
                except (FileNotFoundError, AssertionError) as error:
                    missing.append(str(error))
            else:
                material['pbrMetallicRoughness']['baseColorFactor'] = [0.65, 0.58, 0.43, 1]
            if name not in materials:
                materials[name] = len(self.doc['materials'])
                self.doc['materials'].append(material)
            index = materials[name]
            index_accessor = len(self.doc['accessors'])
            self.doc['accessors'].append({'bufferView': self.view(indices.astype('<u4').tobytes()), 'componentType': 5125, 'count': len(indices), 'type': 'SCALAR'})
            primitives.append({'attributes': attributes, 'indices': index_accessor, 'material': index})
          meshes.append({'name': mesh_name, 'primitives': primitives})
          if mesh_name != 'world':
            attributes = {}
            for key, values in zip(('TRANSLATION', 'ROTATION', 'SCALE'), self.instances[mesh_name]):
                data = np.asarray(values, dtype='<f4')
                attributes[key] = len(self.doc['accessors'])
                self.doc['accessors'].append({'bufferView': self.view(data.tobytes()), 'componentType': 5126, 'count': len(data), 'type': 'VEC4' if key == 'ROTATION' else 'VEC3'})
            node = len(self.doc['nodes'])
            self.doc['nodes'].append({'mesh': len(meshes) - 1, 'extensions': {'EXT_mesh_gpu_instancing': {'attributes': attributes}}})
            self.doc['scenes'][0]['nodes'].append(node)
        self.doc['extensionsUsed'] = self.doc['extensionsRequired'] = ['EXT_mesh_gpu_instancing']
        self.doc['meshes'] = meshes
        self.doc['buffers'] = [{'byteLength': len(self.binary)}]
        header = json.dumps(self.doc, separators=(',', ':')).encode()
        header += b' ' * (-len(header) % 4)
        self.binary.extend(bytes(-len(self.binary) % 4))
        length = 12 + 8 + len(header) + 8 + len(self.binary)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(struct.pack('<III', 0x46546c67, 2, length) + struct.pack('<II', len(header), 0x4e4f534a) + header + struct.pack('<II', len(self.binary), 0x004e4942) + self.binary)
        print(f'GLB: {len(materials)} materials, {len(textures)} textures, {length / 1e6:.1f} MB; texture fallbacks: {len(missing)}')
        return missing


def read_nav(data):
    cursor = 0
    def take(fmt):
        nonlocal cursor
        value = struct.unpack_from('<' + fmt, data, cursor)
        cursor += struct.calcsize('<' + fmt)
        return value[0] if len(value) == 1 else value
    magic, version, subversion, _ = take('4I')
    assert (magic, version, subversion) == (0xfeedface, 16, 1), 'Expected CS:GO NAV 16.1'
    take('B')
    places = []
    for _ in range(take('H')):
        n = take('H')
        places.append(data[cursor:cursor + n - 1].decode())
        cursor += n
    take('B')
    areas = []
    for _ in range(take('I')):
        id_, flags = take('2I')
        nw, se = take('3f'), take('3f')
        ne, sw = take('2f')
        links = []
        for _ in range(4):
            for _ in range(take('I')):
                links.append(take('I'))
        count = take('B')
        cursor += count * 17
        for _ in range(take('I')):
            take('IBIB')
            count = take('B')
            cursor += count * 5
        place = take('H')
        for _ in range(2):
            count = take('I')
            cursor += count * 4
        take('6f')
        count = take('I')
        cursor += count * 5
        take('I')
        # CCSNavArea::Load appends its approach count (empty in modern analyzed maps).
        approach = take('B')
        cursor += approach * 14
        p = position(((nw[0] + se[0]) / 2, (nw[1] + se[1]) / 2, (nw[2] + se[2] + ne + sw) / 4))
        areas.append({'id': id_, 'x': p[0], 'y': p[1], 'z': p[2], 'links': links, 'place': places[place - 1] if place else '', 'flags': flags, 'nw': nw, 'se': se, 'ne': ne, 'sw': sw})
    assert len({a['id'] for a in areas}) == len(areas)
    return areas


def nav_floors(areas):
    # shortcut: Source navigation supplies stepped ramp floors; exact ramps require convex collision.
    boxes = []
    for area in areas:
        nw, se, ne, sw = area['nw'], area['se'], area['ne'], area['sw']
        width, depth = se[0] - nw[0], se[1] - nw[1]
        if width <= 0 or depth <= 0: continue
        for x in np.arange(nw[0], se[0], 16):
            for y in np.arange(nw[1], se[1], 16):
                xx, yy = min(x + 16, se[0]), min(y + 16, se[1])
                u, v = ((x + xx) / 2 - nw[0]) / width, ((y + yy) / 2 - nw[1]) / depth
                height = (nw[2] * (1-u) + ne * u) * (1-v) + (sw * (1-u) + se[2] * u) * v
                p = position(((x + xx) / 2, (y + yy) / 2, height))
                boxes.append({'kind': 'sandstone', 'x': p[0], 'y': p[1] - .1, 'z': p[2], 'w': round((xx-x) * SCALE, 4), 'h': .1, 'd': round((yy-y) * SCALE, 4), 'visible': False})
    return boxes


def read_model(assets, name):
    mdl = assets.read(name)
    vvd = assets.read(name[:-4] + '.vvd')
    vtx = assets.read(name[:-4] + '.dx90.vtx')
    assert mdl[:4] == b'IDST' and vvd[:4] == b'IDSV'
    assert struct.unpack_from('<i', mdl, 8)[0] == struct.unpack_from('<i', vvd, 8)[0] == struct.unpack_from('<i', vtx, 16)[0]
    integer = lambda data, offset: struct.unpack_from('<i', data, offset)[0]
    count, start = integer(vvd, 16), integer(vvd, 56)
    verts = np.frombuffer(vvd, dtype='<f4', count=count * 12, offset=start).reshape(-1, 12)
    fixups = integer(vvd, 48)
    if fixups:
        offset = integer(vvd, 52)
        ids = []
        for i in range(fixups):
            _, first, number = struct.unpack_from('<3i', vvd, offset + i * 12)
            ids.extend(range(first, first + number))
        verts = verts[ids]
    paths = [cstring(mdl, integer(mdl, integer(mdl, 216) + i * 4))[0] for i in range(integer(mdl, 212))]
    materials = []
    for i in range(integer(mdl, 204)):
        offset = integer(mdl, 208) + i * 64
        texture = cstring(mdl, offset + integer(mdl, offset))[0]
        options = [path + texture for path in paths] + [texture]
        materials.append(next((p for p in options if assets.material(p)), texture))
    parts = []
    for bi in range(integer(mdl, 232)):
        body = integer(mdl, 236) + bi * 16
        vb = integer(vtx, 32) + bi * 8
        model = body + integer(mdl, body + 12)
        vm = vb + integer(vtx, vb + 4)
        lod = vm + integer(vtx, vm + 4) + min(2, integer(vtx, vm) - 1) * 12
        for mi in range(integer(mdl, model + 72)):
            mesh = model + integer(mdl, model + 76) + mi * 116
            material, _, _, vertex_offset = struct.unpack_from('<4i', mdl, mesh)
            vertex_offset += integer(mdl, model + 84) // 48
            vmesh = lod + integer(vtx, lod + 4) + mi * 9
            for gi in range(integer(vtx, vmesh)):
                group = vmesh + integer(vtx, vmesh + 4) + gi * 33
                nverts, voff, nindices, ioff, nstrips, soff = struct.unpack_from('<6i', vtx, group)
                lookup = [struct.unpack_from('<H', vtx, group + voff + j * 9 + 4)[0] + vertex_offset for j in range(nverts)]
                indices = np.frombuffer(vtx, dtype='<u2', count=nindices, offset=group + ioff)
                for si in range(nstrips):
                    strip = group + soff + si * 35
                    number, first = struct.unpack_from('<2i', vtx, strip)
                    assert vtx[strip + 18] & 1, 'Expected triangle lists'
                    ids = np.array([lookup[int(i)] for i in indices[first:first + number]])
                    assert len(ids) % 3 == 0 and max(ids, default=0) < len(verts)
                    parts.append((materials[material], verts[ids, 4:7], verts[ids, 7:10], verts[ids, 10:12]))
    return parts


def merge_boxes(boxes):
    bounds = set()
    for b in boxes:
        bounds.add(tuple(round(v, 3) for v in (b['x'] - b['w'] / 2, b['y'], b['z'] - b['d'] / 2, b['x'] + b['w'] / 2, b['y'] + b['h'], b['z'] + b['d'] / 2)))
    for axis in (0, 2, 0):
        groups = {}
        other = [i for i in range(6) if i not in (axis, axis + 3)]
        for b in bounds:
            groups.setdefault(tuple(b[i] for i in other), []).append((b[axis], b[axis + 3]))
        bounds = []
        for key, spans in groups.items():
            spans.sort()
            merged = []
            for lo, hi in spans:
                if merged and lo <= merged[-1][1] + 0.001:
                    merged[-1][1] = max(hi, merged[-1][1])
                else:
                    merged.append([lo, hi])
            for lo, hi in merged:
                b = [0] * 6
                b[axis], b[axis + 3] = lo, hi
                for i, v in zip(other, key): b[i] = v
                bounds.append(tuple(b))
    return [{'kind': 'sandstone', 'x': round((b[0] + b[3]) / 2, 4), 'y': b[1], 'z': round((b[2] + b[5]) / 2, 4), 'w': round(b[3] - b[0], 4), 'h': round(b[4] - b[1], 4), 'd': round(b[5] - b[2], 4), 'visible': False} for b in sorted(bounds) if min(b[3] - b[0], b[4] - b[1], b[5] - b[2]) >= .001]


def main(folder):
    bsp = (folder / 'maps/de_mirage.bsp').read_bytes()
    assert bsp[:4] == b'VBSP' and struct.unpack_from('<i', bsp, 4)[0] == 21
    lumps = [struct.unpack_from('<4i', bsp, 8 + i * 16) for i in range(64)]
    def lump(index):
        offset, size, _, compressed = lumps[index]
        assert not compressed, f'Compressed BSP lump {index}'
        return bsp[offset:offset + size]
    entities = [dict(re.findall(r'"([^"\n]+)"\s+"([^"\n]*)"', block)) for block in re.findall(r'\{([^{}]*)\}', lump(0).decode('utf8', 'replace'))]
    assets = Assets(folder, zipfile.ZipFile(io.BytesIO(lump(40))))
    glb = Glb(assets)
    vertices = np.frombuffer(lump(3), dtype='<f4').reshape(-1, 3)
    edges = np.frombuffer(lump(12), dtype='<u2').reshape(-1, 2)
    surfedges = np.frombuffer(lump(13), dtype='<i4')
    texinfo = [struct.unpack_from('<16f2i', lump(6), i) for i in range(0, len(lump(6)), 72)]
    texdata = [struct.unpack_from('<3f5i', lump(2), i) for i in range(0, len(lump(2)), 32)]
    names = [cstring(lump(43), offset)[0] for offset in np.frombuffer(lump(44), dtype='<i4')]
    models = [struct.unpack_from('<9f3i', lump(14), i) for i in range(0, len(lump(14)), 48)]
    faces = lump(7)
    visible_models = [0] + [int(e['model'][1:]) for e in entities if e.get('classname') == 'func_brush' and e.get('model', '').startswith('*') and e.get('StartDisabled', '0') == '0']
    for model_index in visible_models:
        model = models[model_index]
        for i in range(model[10], model[10] + model[11]):
            _, _, _, first, count, ti = struct.unpack_from('<HBBihh', faces, i * 56)
            info = texinfo[ti]
            if info[16] & (0x80 | 0x4 | 0x2):
                continue
            texture = texdata[info[17]]
            name = names[texture[3]]
            if name.startswith('tools/'):
                continue
            ids = [edges[abs(int(edge))][0 if edge >= 0 else 1] for edge in surfedges[first:first + count]]
            poly = vertices[ids]
            if len(poly) < 3 or np.max(np.abs(poly[:, :2])) > 4200:
                continue
            displacement = struct.unpack_from('<h', faces, i * 56 + 12)[0]
            if displacement >= 0:
                assert len(poly) == 4
                offset = displacement * 176
                start = np.array(struct.unpack_from('<3f', lump(26), offset))
                first_vertex, _, power = struct.unpack_from('<3i', lump(26), offset + 12)
                assert struct.unpack_from('<H', lump(26), offset + 36)[0] == i
                side = (1 << power) + 1
                corner = int(np.argmin(np.linalg.norm(poly - start, axis=1)))
                quad = np.roll(poly, -corner, axis=0)
                grid, grid_uv = [], []
                for row in range(side):
                    v = row / (side - 1)
                    for col in range(side):
                        u = col / (side - 1)
                        base = (quad[0] * (1-u) + quad[3] * u) * (1-v) + (quad[1] * (1-u) + quad[2] * u) * v
                        direction = struct.unpack_from('<4f', lump(33), (first_vertex + row * side + col) * 20)
                        grid.append(base + np.array(direction[:3]) * direction[3])
                        grid_uv.append([float(np.dot(base, info[:3]) + info[3]) / max(1, texture[4]), float(np.dot(base, info[4:7]) + info[7]) / max(1, texture[5])])
                for row in range(side - 1):
                    for col in range(side - 1):
                        a = row * side + col
                        for ids in ((a, a + side, a + side + 1), (a, a + side + 1, a + 1)):
                            tri = [grid[k] for k in ids]
                            n = np.cross(tri[1] - tri[0], tri[2] - tri[0])
                            n /= max(np.linalg.norm(n), 1e-8)
                            glb.triangles(name, [position(p) for p in tri], [[n[0], n[2], -n[1]]] * 3, [grid_uv[k] for k in ids])
                continue
            # Source junctions can make the first three vertices collinear on a valid face.
            normal = np.cross(poly[1:-1] - poly[0], poly[2:] - poly[0]).sum(axis=0)
            length = np.linalg.norm(normal)
            if length < 1e-6:
                continue
            normal /= length
            n = [normal[0], normal[2], -normal[1]]
            uv = [[float(np.dot(p, info[:3]) + info[3]) / max(1, texture[4]), float(np.dot(p, info[4:7]) + info[7]) / max(1, texture[5])] for p in poly]
            for j in range(1, len(poly) - 1):
                ids = (0, j, j + 1)
                glb.triangles(name, [position(poly[k]) for k in ids], [n] * 3, [uv[k] for k in ids])

    # Source brush bounds stay exact for axis-aligned architecture. Slopes become narrow steps.
    planes = [struct.unpack_from('<4fi', lump(1), i)[:4] for i in range(0, len(lump(1)), 20)]
    sides = [struct.unpack_from('<Hhhh', lump(19), i) for i in range(0, len(lump(19)), 8)]
    leaf_brushes = np.frombuffer(lump(17), dtype='<u2')
    solid_brushes, seen_nodes = set(), set()
    def visit_node(node):
        if node in seen_nodes: return
        seen_nodes.add(node)
        if node < 0:
            first, count = struct.unpack_from('<HH', lump(10), (-node - 1) * 32 + 24)
            solid_brushes.update(int(i) for i in leaf_brushes[first:first + count])
        else:
            for child in struct.unpack_from('<2i', lump(5), node * 32 + 4): visit_node(child)
    for i in visible_models: visit_node(models[i][9])
    boxes = []
    def add_box(lo, hi):
        lo, hi = np.asarray(lo), np.asarray(hi)
        if np.any(hi - lo < 0.01) or lo[2] > 250 or hi[2] < BASE:
            return
        if lo[0] < -3200 or hi[0] > 1900 or lo[1] < -3000 or hi[1] > 1700:
            return
        a, b = position(lo), position(hi)
        boxes.append({'kind': 'sandstone', 'x': round((a[0] + b[0]) / 2, 4), 'y': a[1], 'z': round((a[2] + b[2]) / 2, 4), 'w': round(b[0] - a[0], 4), 'h': round(b[1] - a[1], 4), 'd': round(a[2] - b[2], 4), 'visible': False})
    for offset in range(0, len(lump(18)), 12):
        if offset // 12 not in solid_brushes:
            continue
        first, count, contents = struct.unpack_from('<3i', lump(18), offset)
        if not contents & (1 | 0x10000):
            continue
        ps = np.array([planes[sides[i][0]] for i in range(first, first + count)])
        lo, hi = np.full(3, -np.inf), np.full(3, np.inf)
        sloped = []
        for normal in ps:
            axes = np.flatnonzero(np.abs(normal[:3]) > 1e-5)
            if len(axes) == 1:
                axis = axes[0]
                bound = normal[3] / normal[axis]
                if normal[axis] > 0: hi[axis] = min(hi[axis], bound)
                else: lo[axis] = max(lo[axis], bound)
            else: sloped.append(normal)
        if not np.all(np.isfinite([lo, hi])) or np.any(hi <= lo) or np.max(np.abs([lo[:2], hi[:2]])) > 4200:
            continue
        if not sloped:
            add_box(lo, hi)
            continue
        # shortcut: diagonal brush collision is stepped at 16 Source units; use convex hull physics for exact edge contact.
        step = 16
        for x in np.arange(lo[0], hi[0], step):
            for y in np.arange(lo[1], hi[1], step):
                xx, yy = min(x + step, hi[0]), min(y + step, hi[1])
                low, high = lo[2], hi[2]
                for nx, ny, nz, d in sloped:
                    worst = max(nx * qx + ny * qy for qx in (x, xx) for qy in (y, yy))
                    if abs(nz) < 1e-6:
                        if worst > d + 0.01: high = low
                    elif nz > 0: high = min(high, (d - worst) / nz)
                    else: low = max(low, (d - worst) / nz)
                if high > low:
                    add_box([x, y, low], [xx, yy, high])

    # Static prop models supply Mirage's arches, windows, crates, market and site furniture.
    print(f'World collision before merging: {len(boxes)} boxes', flush=True)
    prop_models, failed_models = {}, []
    game = lump(35)
    for gi in range(struct.unpack_from('<i', game)[0]):
        id_, _, version, start, length = struct.unpack_from('<IHHii', game, 4 + gi * 16)
        if id_ != 0x73707270:
            continue
        assert version == 11
        cursor = start
        count = struct.unpack_from('<i', bsp, cursor)[0]
        cursor += 4
        model_names = [bsp[cursor + i * 128:cursor + (i + 1) * 128].split(b'\0')[0].decode() for i in range(count)]
        cursor += count * 128
        leaves = struct.unpack_from('<i', bsp, cursor)[0]
        cursor += 4 + leaves * 2
        count = struct.unpack_from('<i', bsp, cursor)[0]
        cursor += 4
        assert cursor + count * 80 == start + length
        for i in range(count):
            at = cursor + i * 80
            origin = np.array(struct.unpack_from('<3f', bsp, at))
            pitch, yaw, roll = [math.radians(v) for v in struct.unpack_from('<3f', bsp, at + 12)]
            model_id = struct.unpack_from('<H', bsp, at + 24)[0]
            solid = bsp[at + 30]
            scale = struct.unpack_from('<f', bsp, at + 76)[0]
            name = model_names[model_id]
            if name not in prop_models:
                try:
                    prop_models[name] = read_model(assets, name)
                except (FileNotFoundError, AssertionError, struct.error, IndexError) as error:
                    failed_models.append(f'{name}: {error}')
                    prop_models[name] = []
            cp, sp, cy, sy, cr, sr = math.cos(pitch), math.sin(pitch), math.cos(yaw), math.sin(yaw), math.cos(roll), math.sin(roll)
            rotation = np.array([[cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
                                 [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
                                 [-sp, cp * sr, cp * cr]])
            glb.instance(name, prop_models[name], origin, rotation, scale)
            for material, points, normals, uv in prop_models[name]:
                points = (points * scale) @ rotation.T + origin
                if solid:
                    # shortcut: static-prop collision follows triangle bounds, not Source's separate VPhysics hull.
                    for triangle in points.reshape(-1, 3, 3):
                        lo, hi = triangle.min(axis=0), triangle.max(axis=0)
                        spans = sorted(hi - lo)
                        if spans[1] < 8 or spans[2] < 20:
                            continue
                        thin = hi - lo < 1
                        lo[thin] -= 0.5
                        hi[thin] += 0.5
                        add_box(lo, hi)
    print(f'Static prop models: {len(prop_models)}; model fallbacks: {len(failed_models)}', flush=True)
    spawns = []
    for e in entities:
        if e.get('classname') in ('info_player_terrorist', 'info_player_counterterrorist'):
            p = position([float(v) for v in e['origin'].split()])
            spawns.append({'x': p[0], 'y': p[1], 'z': p[2], 'team': 1 if e['classname'] == 'info_player_terrorist' else 2})
    areas = read_nav((folder / 'maps/de_mirage.nav').read_bytes())
    boxes.extend(nav_floors(areas))
    # Merge adjacent equal-height pieces; collision never needs a separate box per render triangle.
    boxes = merge_boxes(boxes)
    assert len(spawns) >= 10 and len(boxes) > 100 and len(areas) > 100
    missing = glb.save(ROOT / 'client/public/maps/mirage.glb')
    out = {'boxes': boxes, 'spawns': spawns, 'nav': areas}
    (ROOT / 'shared/src/maps/mirage-data.json').write_text(json.dumps(out, separators=(',', ':')))
    print(f'Collision: {len(boxes)} boxes; spawns: {len(spawns)}; navigation: {len(areas)} areas')
    (ROOT / 'tools/mirage-import-report.json').write_text(json.dumps({'source': 'de_mirage.bsp v21 / de_mirage.nav v16.1', 'boxes': len(boxes), 'spawns': len(spawns), 'navAreas': len(areas), 'textureFallbacks': missing, 'modelFallbacks': failed_models}, indent=2))


if __name__ == '__main__':
    main(Path(sys.argv[1]))
