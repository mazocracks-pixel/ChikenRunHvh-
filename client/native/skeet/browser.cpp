#include <emscripten.h>
#include <emscripten/html5.h>
#include <GLES2/gl2.h>
#include <vector>
#include <string>
#include <algorithm>
#include "imgui/imgui.h"
#include "imgui/imgui_internal.h"
#include "menu/Menu.h"
#include "menu/MenuFonts.h"
#include "menu/Config.h"

BrowserConfig g_Config;
ImFont *menuFont, *tabFont, *tabFont2, *tabFont3, *controlFont, *boldMenuFont;
ImTextureID menuBg;
bool unload=false;
#include "config_bridge.inc"

struct Control { int id,type; std::string group,label,detail; float value=0,min=0,max=1; std::vector<std::string> choices; };
static std::vector<Control> controls;
static GLuint program,vbo,ebo;
static GLint projection,texture;
static EMSCRIPTEN_WEBGL_CONTEXT_HANDLE context;
static std::string widgets;
static bool heldMouse[5]={},pressedMouse[5]={};
static ImVec2 mouseNow,pressPos,releasePos;
static bool pressQueued=false,releaseQueued=false;
static bool heldKeys[512]={},pressedKeys[512]={};

void BrowserRecordWidget(const char* label) {
  ImVec2 p=ImGui::GetItemRectMin(),q=ImGui::GetItemRectMax();
  auto* w=ImGui::GetCurrentWindow();
  if(q.y<w->ClipRect.Min.y || p.y>w->ClipRect.Max.y)return;
  widgets += std::string(label)+"\t"+std::to_string(p.x)+"\t"+std::to_string(p.y)+"\t"+std::to_string(q.x)+"\t"+std::to_string(q.y)+"\n";
}
void BrowserGroup(const char* group) {
  // The same spacing as the original group boxes, with their gap at the top.
  ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing,ImVec2(4.f,2.f));
  bool top=ImGui::GetCursorPosY()<20.f;
  if(top)ImGui::CustomSpacing(7.f);
  for(auto& c:controls) if(c.group==group) {
    ImGui::PushID(c.id);
    if(c.type==6) {
      // A section heading: bold, with a divider running to the edge of the box.
      if(!top)ImGui::CustomSpacing(9.f);
      ImGui::NewLine(); ImGui::SameLine(19.f);
      ImGui::PushFont(boldMenuFont); ImGui::PushStyleColor(ImGuiCol_Text,ImColor(214,214,214).Value);
      ImGui::TextUnformatted(c.label.c_str());
      ImGui::PopStyleColor(); ImGui::PopFont();
      ImVec2 a=ImGui::GetItemRectMin(),b=ImGui::GetItemRectMax();float y=floorf((a.y+b.y)*.5f)+.5f;
      ImGui::GetWindowDrawList()->AddLine(ImVec2(b.x+6.f,y),ImVec2(ImGui::GetWindowPos().x+ImGui::GetWindowWidth()-27.f,y),ImColor(52,52,52));
      ImGui::PopID(); top=false; continue;
    }
    top=false;
    ImGui::Spacing();
    std::string label=c.label;
    const float fit=c.type==3?150.f:185.f;
    while(label.size()>3 && ImGui::CalcTextSize(label.c_str()).x>fit)label.pop_back();
    if(label!=c.label)label+="...";
    label+="##control";
    if(c.type==1||c.type==2)ImGui::CustomSpacing(18.f);
    // Ticks sit at the box's edge; everything else lines up with their names, as in the original menu.
    ImGui::NewLine(); ImGui::SameLine(c.type==0?19.f:42.f);
    ImGui::PushItemWidth(159.f);
    if(c.type==0) { bool value=c.value!=0; if(ImGui::Checkbox(label.c_str(),&value))c.value=value; }
    if(c.type==1) ImGui::SliderFloat(label.c_str(),&c.value,c.min,c.max,c.max>10?"%.0f":"%.2f");
    if(c.type==2) { int value=(int)c.value; std::vector<const char*> choices; for(auto& s:c.choices)choices.push_back(s.c_str()); if(ImGui::Combo(label.c_str(),&value,choices.data(),choices.size()))c.value=value; }
    if(c.type==3) { ImGui::PushStyleColor(ImGuiCol_Button,ImColor(35,35,35).Value);ImGui::PushStyleColor(ImGuiCol_ButtonHovered,ImColor(55,55,55).Value);ImGui::PushStyleColor(ImGuiCol_ButtonActive,ImColor(65,65,65).Value);if(ImGui::Button(label.c_str(),ImVec2(159,20)))c.value=1;ImGui::PopStyleColor(3); }
    if(c.type==4) { ImGui::PushStyleColor(ImGuiCol_Text,ImColor(150,150,150).Value);ImGui::PushTextWrapPos(ImGui::GetWindowWidth()-27.f);ImGui::Text("%s%s%s",c.label.c_str(),c.detail.empty()?"":": ",c.detail.c_str());ImGui::PopTextWrapPos();ImGui::PopStyleColor(); }
    if(c.type==5) {
      int rgb=(int)c.value;float color[3]={((rgb>>16)&255)/255.f,((rgb>>8)&255)/255.f,(rgb&255)/255.f};
      ImGui::AlignTextToFramePadding();ImGui::TextUnformatted(label.substr(0,label.find("##")).c_str());ImGui::SameLine(219.f);
      if(ImGui::ColorEdit3("##color",color,ImGuiColorEditFlags_NoInputs))c.value=((int)(color[0]*255)<<16)|((int)(color[1]*255)<<8)|(int)(color[2]*255);
    }
    BrowserRecordWidget(c.label.c_str());
    if(c.type!=4 && ImGui::IsItemHovered()) ImGui::SetTooltip("%s%s%s",c.label.c_str(),c.detail.empty()?"":"\n",c.detail.c_str());
    ImGui::PopItemWidth(); ImGui::PopID();
  }
  ImGui::PopStyleVar();
}

static GLuint shader(GLenum type,const char* source) { GLuint s=glCreateShader(type);glShaderSource(s,1,&source,nullptr);glCompileShader(s);return s; }
extern "C" {
EMSCRIPTEN_KEEPALIVE void native_init() {
  EmscriptenWebGLContextAttributes attrs; emscripten_webgl_init_context_attributes(&attrs);
  attrs.alpha=true;attrs.depth=false;attrs.stencil=false;attrs.antialias=false;attrs.premultipliedAlpha=false;attrs.majorVersion=1;
  context=emscripten_webgl_create_context("#skeet-native-canvas",&attrs);emscripten_webgl_make_context_current(context);
  IMGUI_CHECKVERSION();ImGui::CreateContext();ImGui::StyleColorsDark();
  auto& io=ImGui::GetIO();io.IniFilename=nullptr;io.LogFilename=nullptr;io.ConfigFlags|=ImGuiConfigFlags_NavEnableKeyboard;
  menuFont=io.Fonts->AddFontFromMemoryCompressedTTF(verdana_compressed_data,verdana_compressed_size,12.f);
  boldMenuFont=io.Fonts->AddFontFromMemoryCompressedTTF(verdanab_compressed_data,verdanab_compressed_size,12.f);
  controlFont=io.Fonts->AddFontFromMemoryCompressedTTF(comboarrow_compressed_data,comboarrow_compressed_size,12.f);tabFont=tabFont2=tabFont3=menuFont;
  unsigned char* pixels;int width,height;io.Fonts->GetTexDataAsRGBA32(&pixels,&width,&height);
  GLuint font;glGenTextures(1,&font);glBindTexture(GL_TEXTURE_2D,font);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_LINEAR);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_LINEAR);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA,width,height,0,GL_RGBA,GL_UNSIGNED_BYTE,pixels);io.Fonts->TexID=(ImTextureID)(intptr_t)font;
  const char* vs="attribute vec2 Position;attribute vec2 UV;attribute vec4 Color;uniform mat4 Projection;varying vec2 FragUV;varying vec4 FragColor;void main(){FragUV=UV;FragColor=Color;gl_Position=Projection*vec4(Position,0,1);}";
  const char* fs="precision mediump float;uniform sampler2D Texture;varying vec2 FragUV;varying vec4 FragColor;void main(){gl_FragColor=FragColor*texture2D(Texture,FragUV);}";
  GLuint v=shader(GL_VERTEX_SHADER,vs),f=shader(GL_FRAGMENT_SHADER,fs);program=glCreateProgram();glAttachShader(program,v);glAttachShader(program,f);
  glBindAttribLocation(program,0,"Position");glBindAttribLocation(program,1,"UV");glBindAttribLocation(program,2,"Color");glLinkProgram(program);glDeleteShader(v);glDeleteShader(f);
  projection=glGetUniformLocation(program,"Projection");texture=glGetUniformLocation(program,"Texture");glGenBuffers(1,&vbo);glGenBuffers(1,&ebo);
  io.KeyMap[ImGuiKey_Tab]=9;io.KeyMap[ImGuiKey_LeftArrow]=37;io.KeyMap[ImGuiKey_RightArrow]=39;io.KeyMap[ImGuiKey_UpArrow]=38;io.KeyMap[ImGuiKey_DownArrow]=40;io.KeyMap[ImGuiKey_PageUp]=33;io.KeyMap[ImGuiKey_PageDown]=34;io.KeyMap[ImGuiKey_Home]=36;io.KeyMap[ImGuiKey_End]=35;io.KeyMap[ImGuiKey_Insert]=45;io.KeyMap[ImGuiKey_Delete]=46;io.KeyMap[ImGuiKey_Backspace]=8;io.KeyMap[ImGuiKey_Space]=32;io.KeyMap[ImGuiKey_Enter]=13;io.KeyMap[ImGuiKey_Escape]=27;io.KeyMap[ImGuiKey_A]=65;io.KeyMap[ImGuiKey_C]=67;io.KeyMap[ImGuiKey_V]=86;io.KeyMap[ImGuiKey_X]=88;io.KeyMap[ImGuiKey_Y]=89;io.KeyMap[ImGuiKey_Z]=90;
}
EMSCRIPTEN_KEEPALIVE void native_background(int width,int height,unsigned char* pixels) { GLuint t;glGenTextures(1,&t);glBindTexture(GL_TEXTURE_2D,t);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_LINEAR);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_LINEAR);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,GL_CLAMP_TO_EDGE);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_T,GL_CLAMP_TO_EDGE);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA,width,height,0,GL_RGBA,GL_UNSIGNED_BYTE,pixels);menuBg=(ImTextureID)(intptr_t)t; }
EMSCRIPTEN_KEEPALIVE void native_clear_controls(){controls.clear();}
EMSCRIPTEN_KEEPALIVE void native_add(int id,const char* group,const char* label,int type,float min,float max,const char* options,const char* detail) {
  Control c;c.id=id;c.group=group;c.label=label;c.type=type;c.min=min;c.max=max;c.detail=detail;
  std::string all=options;size_t pos;while((pos=all.find('|'))!=std::string::npos){c.choices.push_back(all.substr(0,pos));all.erase(0,pos+1);}if(!all.empty())c.choices.push_back(all);controls.push_back(c);
}
EMSCRIPTEN_KEEPALIVE void native_control_set(int id,float value){for(auto& c:controls)if(c.id==id)c.value=value;}
EMSCRIPTEN_KEEPALIVE float native_control_get(int id){for(auto& c:controls)if(c.id==id)return c.value;return 0;}
EMSCRIPTEN_KEEPALIVE void native_detail(int id,const char* detail){for(auto& c:controls)if(c.id==id)c.detail=detail;}
EMSCRIPTEN_KEEPALIVE void native_mouse(float x,float y,int button,int down,float wheel){auto& io=ImGui::GetIO();mouseNow=ImVec2(x,y);if(button>=0&&button<5){heldMouse[button]=down;if(down){pressedMouse[button]=true;pressPos=mouseNow;pressQueued=true;}else{releasePos=mouseNow;releaseQueued=true;}}io.MouseWheel+=wheel;}
EMSCRIPTEN_KEEPALIVE void native_key(int key,int down,int ctrl,int shift,int alt){auto& io=ImGui::GetIO();if(key>=0&&key<512){heldKeys[key]=down;if(down)pressedKeys[key]=true;}io.KeyCtrl=ctrl;io.KeyShift=shift;io.KeyAlt=alt;}
EMSCRIPTEN_KEEPALIVE void native_text(const char* text){ImGui::GetIO().AddInputCharactersUTF8(text);}
EMSCRIPTEN_KEEPALIVE const char* native_widgets(){return widgets.c_str();}
EMSCRIPTEN_KEEPALIVE int native_popup_count(){return ImGui::GetCurrentContext()->OpenPopupStack.Size;}
EMSCRIPTEN_KEEPALIVE void native_reset_input(){std::fill(heldMouse,heldMouse+5,false);std::fill(pressedMouse,pressedMouse+5,false);std::fill(heldKeys,heldKeys+512,false);std::fill(pressedKeys,pressedKeys+512,false);pressQueued=releaseQueued=false;auto& io=ImGui::GetIO();std::fill(io.MouseDown,io.MouseDown+5,false);std::fill(io.KeysDown,io.KeysDown+512,false);io.KeyCtrl=io.KeyShift=io.KeyAlt=false;io.MouseWheel=0;ImGui::GetCurrentContext()->OpenPopupStack.clear();}
EMSCRIPTEN_KEEPALIVE void native_frame(float width,float height,float dt) {
  emscripten_webgl_make_context_current(context);auto& io=ImGui::GetIO();io.DisplaySize=ImVec2(width,height);io.DeltaTime=std::max(0.001f,dt);
  if(pressQueued){io.MousePos=pressPos;pressQueued=false;}else if(releaseQueued){io.MousePos=releasePos;releaseQueued=false;}else io.MousePos=mouseNow;
  for(int b=0;b<5;b++){io.MouseDown[b]=heldMouse[b]||pressedMouse[b];pressedMouse[b]=false;}
  for(int k=0;k<512;k++){io.KeysDown[k]=heldKeys[k]||pressedKeys[k];pressedKeys[k]=false;}
  widgets.clear();ImGui::NewFrame();ImGui::SetNextWindowPos(ImVec2(0,0),ImGuiCond_Always);Menu::Get().isOpen=true;Menu::Get().Render();ImGui::Render();
  auto* draw=ImGui::GetDrawData();glViewport(0,0,(int)width,(int)height);glClearColor(0,0,0,0);glClear(GL_COLOR_BUFFER_BIT);glEnable(GL_BLEND);glBlendEquation(GL_FUNC_ADD);glBlendFuncSeparate(GL_SRC_ALPHA,GL_ONE_MINUS_SRC_ALPHA,GL_ONE,GL_ONE_MINUS_SRC_ALPHA);glDisable(GL_CULL_FACE);glDisable(GL_DEPTH_TEST);glEnable(GL_SCISSOR_TEST);glActiveTexture(GL_TEXTURE0);glUseProgram(program);glUniform1i(texture,0);
  const float p[4][4]={{2.f/width,0,0,0},{0,-2.f/height,0,0},{0,0,-1,0},{-1,1,0,1}};glUniformMatrix4fv(projection,1,GL_FALSE,&p[0][0]);
  glBindBuffer(GL_ARRAY_BUFFER,vbo);glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,ebo);for(int i=0;i<3;i++)glEnableVertexAttribArray(i);
  glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,sizeof(ImDrawVert),(void*)IM_OFFSETOF(ImDrawVert,pos));glVertexAttribPointer(1,2,GL_FLOAT,GL_FALSE,sizeof(ImDrawVert),(void*)IM_OFFSETOF(ImDrawVert,uv));glVertexAttribPointer(2,4,GL_UNSIGNED_BYTE,GL_TRUE,sizeof(ImDrawVert),(void*)IM_OFFSETOF(ImDrawVert,col));
  for(int i=0;i<draw->CmdListsCount;i++){const auto* list=draw->CmdLists[i];glBufferData(GL_ARRAY_BUFFER,list->VtxBuffer.Size*sizeof(ImDrawVert),list->VtxBuffer.Data,GL_STREAM_DRAW);glBufferData(GL_ELEMENT_ARRAY_BUFFER,list->IdxBuffer.Size*sizeof(ImDrawIdx),list->IdxBuffer.Data,GL_STREAM_DRAW);size_t offset=0;for(const auto& cmd:list->CmdBuffer){if(cmd.UserCallback)cmd.UserCallback(list,&cmd);else{glBindTexture(GL_TEXTURE_2D,(GLuint)(intptr_t)cmd.TextureId);glScissor((int)cmd.ClipRect.x,(int)(height-cmd.ClipRect.w),(int)(cmd.ClipRect.z-cmd.ClipRect.x),(int)(cmd.ClipRect.w-cmd.ClipRect.y));glDrawElements(GL_TRIANGLES,cmd.ElemCount,GL_UNSIGNED_SHORT,(void*)(offset*sizeof(ImDrawIdx)));}offset+=cmd.ElemCount;}}
  glDisable(GL_SCISSOR_TEST);
}
}
