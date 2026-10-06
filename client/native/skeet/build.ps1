param([string]$Emcc = 'em++')
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
  & $Emcc 'browser.cpp' 'menu/Menu.cpp' 'imgui/imgui.cpp' 'imgui/imgui_draw.cpp' 'imgui/imgui_widgets.cpp' '-Iimgui' '-Imenu' '-O2' '-DIMGUI_DISABLE_DEMO_WINDOWS' '-sMODULARIZE=1' '-sEXPORT_ES6=1' '-sENVIRONMENT=web' '-sALLOW_MEMORY_GROWTH=1' '-sFILESYSTEM=0' '-sEXPORTED_RUNTIME_METHODS=["ccall","UTF8ToString","HEAPU8"]' '-sEXPORTED_FUNCTIONS=["_malloc","_free"]' '-o' '../../public/skeet-native/menu.js'
  if ($LASTEXITCODE -ne 0) { throw 'Native menu compilation failed.' }
} finally { Pop-Location }
