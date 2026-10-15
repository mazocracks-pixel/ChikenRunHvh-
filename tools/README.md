# Mirage import

The bundled `client/public/maps/mirage.glb` and `shared/src/maps/mirage-data.json` are sufficient to run the game. Steam, Python and a C++ compiler are not required by the browser.

To rebuild from the installed classic CS:GO data:

```powershell
python tools/import_mirage.py "C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive/csgo"
node node_modules/tsx/dist/cli.mjs tools/prepare_mirage.ts
gltfpack -i client/public/maps/mirage.glb -o work/mirage-optimized.glb -si 0.3 -slb -sp -se 0.005 -cc -vp 16 -vt 16 -tw -tq 6 -tl 128 -kn
Copy-Item work/mirage-optimized.glb client/public/maps/mirage.glb
node tools/check_mirage.mjs
```

Create `work/` before the optimization step. The importer requires NumPy and Pillow; gltfpack v1.3 was used for this build. Keep `-slb`: it locks mesh boundaries so simplification preserves floor edges. Run `prepare_mirage.ts` once directly after importing the raw map. It settles spawn positions, removes blocked navigation points, checks every connection against the game collision and retains the connected main map.

## Exact reference structures

These paths are in [the supplied CS:GO reference tree](https://github.com/sr2echa/CSGO-Source-Code/tree/master/cstrike15_src):

| File | Structures used |
| --- | --- |
| `public/bspfile.h` | `dheader_t`, `lump_t`, `dface_t`, `texinfo_t`, `ddispinfo_t`, `CDispVert`, brush/leaf/model records and the embedded pakfile |
| `public/studio.h` | `studiohdr_t`, `mstudiobodyparts_t`, `mstudiomodel_t`, `mstudiomesh_t`, VVD vertex data |
| `public/optimize.h` | VTX body/model/LOD/mesh/strip-group/strip records and original vertex IDs |
| `game/server/nav_file.cpp` | NAV header, version and place-directory serialization |
| `game/server/nav_area.cpp` | `CNavArea::Save` area corners, connections, hiding spots, encounter paths and ladder records |
| `game/server/cstrike15/cs_nav_area.cpp` | `CCSNavArea::Save` / `Load` Counter-Strike approach records appended to each area |

The input is Source **BSP v21 / NAV v16.1**, with `csgo/pak01_dir.vpk` and external VPK archives. Source coordinates become `(X × .025, (Z + 400) × .025, -Y × .025)` in the browser. Model instances use the same origin and rotation conversion.

## Current asset

- 3,357,028 bytes after mesh compression; 247 embedded WebP textures, capped at 128 pixels.
- 351 rendered meshes, 2,223 scene instances and 930,540 triangles, including 241 imported static-prop model types and all 954 displacement surfaces.
- 35,623 collision boxes, 33 floor-settled team spawns and 755 connected main navigation areas.
- No missing model or texture fallbacks in the import report.

`check_mirage.mjs` exercises the actual Three.js mesh-compressed GLTF loader, checks PNG/WebP signatures and geometry bounds, and checks the visible floor below every team spawn plus the lobby camera sightline. It substitutes textures in Node; browser texture decoding and shading are checked separately in the preview.

The BSP importer calculates polygon normals over the whole triangle fan. Source faces often begin with several collinear vertices at a junction; using only the first three incorrectly discarded the T-spawn floor and other valid surfaces. The floor check failed on the old asset and passes after reimporting and compressing.

The material reader supports quoted and unquoted VMT keys, nested shader blocks and patch includes. It preserves alpha masks for leaves and only enables blending for materials that request it. The server CSP permits texture `blob:` fetches created by Three.js. Imported map surfaces use matte lighting, while chickens and guns keep their existing materials. Mirage renders at a maximum device pixel ratio of 1 without the bloom postprocessing passes.

Run the parser checks from this directory with `python -m unittest test_import_mirage.py`.

## Limits

The aim is a lighter browser Mirage experience: recognizable routes, cover and landmarks with simplified visual detail. Collision uses stepped boxes for sloping brushes and terrain, plus simplified prop bounds. Buying and planting use the game's circular zones. Textures and prop detail are reduced; Source lightmaps, shaders, animated map entities and effects are not reproduced. Existing sealed PvE event areas remain outside the Mirage competitive area. Original maps are available alongside Mirage through each mode's map picker.
