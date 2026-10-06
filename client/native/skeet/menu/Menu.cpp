#include "Menu.h"
#include "MenuControls.h"
#include "Dropdown.h"
#include "Config.h"

#include "imgui.h"
#include "imgui_internal.h"


extern ImFont* menuFont;
extern ImFont* tabFont;
extern ImFont* tabFont2;
extern ImFont* tabFont3;
extern ImFont* controlFont;
extern ImTextureID menuBg;
void BrowserGroup(const char* name);

static int tab = 0;

extern bool unload;

void Menu::ColorPicker(const char* name, float* color, bool alpha) {

	ImGuiWindow* window = ImGui::GetCurrentWindow();
	ImGuiStyle* style = &ImGui::GetStyle();

	auto alphaSliderFlag = alpha ? ImGuiColorEditFlags_AlphaBar : ImGuiColorEditFlags_NoAlpha;

	ImGui::SameLine(219.f);
	ImGui::ColorEdit4(std::string{ "##" }.append(name).append("Picker").c_str(), color, alphaSliderFlag | ImGuiColorEditFlags_NoInputs | ImGuiColorEditFlags_NoTooltip);
    BrowserRecordWidget(name);
}

void Menu::Render() {

	ImGuiStyle* style = &ImGui::GetStyle();

	style->WindowPadding = ImVec2(6, 6);

	ImGui::PushFont(menuFont);

	ImGui::SetNextWindowSize(ImVec2(660.f, 560.f));
	ImGui::BeginMenuBackground("Skeet / Chicken HvH", &Menu::Get().isOpen, ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse | ImGuiWindowFlags_NoTitleBar); {

		ImGui::BeginChild("Complete Border", ImVec2(648.f, 548.f), false); {

			ImGui::Image(menuBg, ImVec2(648.f, 548.f));

		} ImGui::EndChild();

		ImGui::SameLine(6.f);

		style->Colors[ImGuiCol_ChildBg] = ImColor(0, 0, 0, 0);

		ImGui::BeginChild("Menu Contents", ImVec2(648.f, 548.f), false); {

			ImGui::ColorBar("unicorn", ImVec2(648.f, 2.f));

			style->ItemSpacing = ImVec2(0.f, -1.f);
			
			ImGui::BeginTabs("Tabs", ImVec2(75.f, 542.f), false); {

				style->ItemSpacing = ImVec2(0.f, 0.f);

				style->ButtonTextAlign = ImVec2(0.5f, 0.47f);

				ImGui::PopFont();
				ImGui::PushFont(tabFont);

                const char* tabs[] = {"Aim", "Anti-aim", "Visuals", "Settings"};
                ImGui::TabSpacer("##Top Spacer", ImVec2(75.f, 10.f));
                for (int i = 0; i < 4; i++) {
                    if (i == tab) ImGui::SelectedTab(tabs[i], ImVec2(75.f, 130.f));
                    else if (ImGui::Tab(tabs[i], ImVec2(75.f, 130.f))) tab = i;
                }
                ImGui::TabSpacer2("##Bottom Spacer", ImVec2(75.f, 7.f));
                ImGui::PopFont();
				ImGui::PushFont(menuFont);

				style->ButtonTextAlign = ImVec2(0.5f, 0.5f);

			} ImGui::EndTabs();		

			ImGui::SameLine(75.f);

			ImGui::BeginChild("Tab Contents", ImVec2(572.f, 542.f), false); {

				style->Colors[ImGuiCol_Border] = ImColor(0, 0, 0, 0);

				switch (tab) {

				case 0:
					Aimbot();
					break;
				case 1:
					Antiaim();
					break;
				case 2:
                    Visuals();
                    break;
                case 3:
                    Misc();
                    break;
				}

				style->Colors[ImGuiCol_Border] = ImColor(10, 10, 10, 255);

			} ImGui::EndChild();

			style->ItemSpacing = ImVec2(4.f, 4.f);
			style->Colors[ImGuiCol_ChildBg] = ImColor(17, 17, 17, 255);

		} ImGui::EndChild();

		ImGui::PopFont();
		
	} ImGui::End();
}

void Menu::Shutdown() {

	ImGui::DestroyContext();
}

void Menu::Aimbot() {
    auto* style = &ImGui::GetStyle();
    InsertSpacer("Top Spacer");
    ImGui::Columns(2, NULL, false);
    InsertGroupBoxLeft("Targeting", 506.f); { BrowserGroup("Aimbot"); }
    InsertEndGroupBoxLeft("Targeting Cover", "Targeting");
    ImGui::NextColumn();
    InsertGroupBoxRight("Weapon and resolver", 506.f); { BrowserGroup("Rage Other"); }
    InsertEndGroupBoxRight("Weapon Cover", "Weapon and resolver");
}

void Menu::Antiaim() {
    auto* style = &ImGui::GetStyle();
    InsertSpacer("Top Spacer");
    ImGui::Columns(2, NULL, false);
    InsertGroupBoxLeft("Angles", 506.f); { BrowserGroup("Anti-aimbot angles"); }
    InsertEndGroupBoxLeft("Angles Cover", "Angles");
    ImGui::NextColumn();
    InsertGroupBoxRight("Packets and exploits", 506.f); { BrowserGroup("Fake lag"); }
    InsertEndGroupBoxRight("Packets Cover", "Packets and exploits");
}

void Menu::Visuals() {
    auto* style = &ImGui::GetStyle();
    InsertSpacer("Top Spacer");
    ImGui::Columns(2, NULL, false);
    InsertGroupBoxLeft("Players", 506.f); {
        style->ItemSpacing = ImVec2(4, 2);
        style->WindowPadding = ImVec2(4, 4);
        ImGui::CustomSpacing(9.f);
        InsertCheckbox("Bounding box", g_Config.Visuals.Players.boundingBox);
        InsertColorPicker("##Bounding box color", g_Config.Color.Players.boundingBox, false);
        InsertCheckbox("Health bar", g_Config.Visuals.Players.healthBar);
        InsertCheckbox("Name", g_Config.Visuals.Players.name);
        InsertColorPicker("##Name color", g_Config.Color.Players.name, false);
        InsertCheckbox("Weapon text", g_Config.Visuals.Players.weaponText);
        InsertCheckbox("Glow", g_Config.Visuals.Players.glow);
        InsertColorPicker("##Glow color", g_Config.Color.Players.glow, true);
        InsertCheckbox("Player", g_Config.Visuals.ColoredModels.player);
        InsertColorPicker("##Player color", g_Config.Color.ColoredModels.player, true);
        if (g_Config.Visuals.ColoredModels.player) {
            InsertCheckbox("Player behind wall", g_Config.Visuals.ColoredModels.playerBehindWall);
            InsertColorPicker("##Player behind wall color", g_Config.Color.ColoredModels.playerBehindWall, true);
            InsertComboWithoutText("##player material", g_Config.Visuals.ColoredModels.playerMaterial, chamsMaterials);
        }
        InsertCheckbox("Weapons", g_Config.Visuals.ColoredModels.weapons);
        InsertColorPicker("##Weapons color", g_Config.Color.ColoredModels.weapons, true);
        if (g_Config.Visuals.ColoredModels.weapons) {
            InsertComboWithoutText("##weapons material", g_Config.Visuals.ColoredModels.weaponsMaterial, chamsMaterials);
        }
        InsertCheckbox("Local fake shadow", g_Config.Visuals.ColoredModels.localFakeShadow);
        InsertColorPicker("##Local fake shadow color", g_Config.Color.ColoredModels.localFakeShadow, true);
        if (ImGui::CollapsingHeader("More player visuals")) {
            InsertCheckbox("Teammates", g_Config.Visuals.Players.teammates);
            InsertCheckbox("Dormant", g_Config.Visuals.Players.dormant);
            InsertCheckbox("Flags", g_Config.Visuals.Players.flags);
            InsertCheckbox("Weapon icon", g_Config.Visuals.Players.weaponIcon);
            InsertColorPicker("##Weapon color", g_Config.Color.Players.weaponIcon, false);
            InsertCheckbox("Ammo", g_Config.Visuals.Players.ammo);
            InsertColorPicker("##Ammo color", g_Config.Color.Players.ammo, false);
            InsertCheckbox("Distance", g_Config.Visuals.Players.distance);
            InsertCheckbox("Skeleton", g_Config.Visuals.Players.skeleton);
            InsertColorPicker("##Skeleton color", g_Config.Color.Players.skeleton, false);
            InsertCheckbox("Line of sight", g_Config.Visuals.Players.lineOfSight);
            InsertColorPicker("##Line of sight color", g_Config.Color.Players.lineOfSight, false);
            InsertCheckbox("Out of FOV arrow", g_Config.Visuals.Players.outOfFOVArrow);
            InsertColorPicker("##Out of FOV arrow color", g_Config.Color.Players.outOfFOVArrow, false);
            if (g_Config.Visuals.Players.outOfFOVArrow) {
                InsertSliderWithoutText("##arrow size", g_Config.Visuals.Players.arrowSize, 0.f, 30.f, "%1.fpx");
                InsertSliderWithoutText("##arrow distance", g_Config.Visuals.Players.arrowDistance, 0.f, 100.f, "%1.f%%");
            }
            InsertCheckbox("Show teammates", g_Config.Visuals.ColoredModels.teammates);
            InsertColorPicker("##Teammates color", g_Config.Color.ColoredModels.teammates, true);
            InsertCheckbox("Shadow", g_Config.Visuals.ColoredModels.shadow);
            InsertColorPicker("##Shadow color", g_Config.Color.ColoredModels.shadow, true);
            InsertColorPicker("##Reflectivity color", g_Config.Color.ColoredModels.playerReflectivityColor, false);
            InsertCheckbox("Disable model occlusion", g_Config.Visuals.ColoredModels.disableModelOcclusion);
        }
        style->ItemSpacing = ImVec2(0, 0);
        style->WindowPadding = ImVec2(6, 6);
    } InsertEndGroupBoxLeft("Players Cover", "Players");
    ImGui::NextColumn();
    InsertGroupBoxRight("View", 506.f); {
        style->ItemSpacing = ImVec2(4, 2);
        style->WindowPadding = ImVec2(4, 4);
        ImGui::CustomSpacing(9.f);
        InsertCheckbox("Override scope", g_Config.Visuals.Effects.removeScopeOverlay);
        InsertCombo("Visual recoil adjustment", g_Config.Visuals.Effects.visualRecoilAdjustment, visualRecoilAdjustment);
        InsertCheckbox("Hit marker", g_Config.Visuals.Players.hitmarker);
        InsertCheckbox("Hit marker sound", g_Config.Visuals.Players.hitmarkerSound);
        InsertCheckbox("Bullet tracers", g_Config.Visuals.Effects.bulletTracers);
        InsertCheckbox("Bullet impacts", g_Config.Visuals.Effects.bulletImpacts);
        InsertCheckbox("Force third person", g_Config.Visuals.Effects.forceThirdPerson);
        InsertCheckbox("Remove fog", g_Config.Visuals.Effects.removeFog);
        InsertCheckbox("Remove grass", g_Config.Visuals.Effects.removeGrass);
        InsertCheckbox("Remove skybox", g_Config.Visuals.Effects.removeSkybox);
        InsertCheckbox("Crosshair", g_Config.Visuals.Other.crosshair);
        if (ImGui::CollapsingHeader("More view options")) {
            InsertSlider("Override FOV", g_Config.Misc.overrideFov, 0.f, 120.f, "%1.f");
            InsertCheckbox("Radar", g_Config.Visuals.Other.radar);
            InsertCombo("Loot drops", g_Config.Visuals.Other.droppedWeapons, droppedWeapons);
            InsertCheckbox("Loot contents", g_Config.Visuals.Other.droppedWeaponsAmmo);
            InsertCheckbox("Grenades", g_Config.Visuals.Other.grenades);
            InsertCheckbox("Glow grenades", g_Config.Visuals.Other.glowGrenades);
            InsertColorPicker("##Glow grenades color", g_Config.Color.Other.glowGrenades, true);
            InsertColorPicker("##Grenades color", g_Config.Color.Other.grenades, false);
            InsertCheckbox("Inaccuracy overlay", g_Config.Visuals.Other.inaccuracyOverlay);
            InsertColorPicker("##Inaccuracy overlay color", g_Config.Color.Other.inaccuracyOverlay, true);
            InsertCheckbox("Recoil overlay", g_Config.Visuals.Other.recoilOverlay);
            InsertCheckbox("Grenade trajectory", g_Config.Visuals.Other.grenadeTrajectory);
            InsertColorPicker("##Grenade trajectory color", g_Config.Color.Other.grenadeTrajectory, false);
            InsertCheckbox("Grenade proximity warning", g_Config.Visuals.Other.grenadeProximityWarning);
            InsertCheckbox("Dead players", g_Config.Visuals.Other.spectators);
            InsertCheckbox("Penetration reticle", g_Config.Visuals.Other.penetrationReticle);
            InsertCheckbox("Shot sounds", g_Config.Visuals.Players.visualizeSounds);
            InsertColorPicker("##Sounds color", g_Config.Color.Players.visualizeSounds, false);
            InsertCheckbox("Remove flashbang effects", g_Config.Visuals.Effects.removeFlashbangEffects);
            InsertCheckbox("Remove smoke grenades", g_Config.Visuals.Effects.removeSmokeGrenades);
            InsertSlider("Transparent walls", g_Config.Visuals.Effects.transparentWalls, 0.f, 100.f, "%1.f%%");
            InsertSlider("Transparent props", g_Config.Visuals.Effects.transparentProps, 0.f, 100.f, "%1.f%%");
            InsertMultiCombo("Brightness adjustment", brightnessAdjustment, g_Config.Visuals.Effects.brightnessAdjustment, 2);
            InsertCheckbox("Disable post processing", g_Config.Visuals.Effects.disablePostProcessing);
            InsertCheckbox("Disable rendering of teammates", g_Config.Visuals.Effects.disableRenderingOfTeammates);
        }
        style->ItemSpacing = ImVec2(0, 0);
        style->WindowPadding = ImVec2(6, 6);
    } InsertEndGroupBoxRight("View Cover", "View");
}

void Menu::Misc() {
    auto* style = &ImGui::GetStyle();
    InsertSpacer("Top Spacer");
    ImGui::Columns(2, NULL, false);
    InsertGroupBoxLeft("Movement", 506.f); {
        style->ItemSpacing = ImVec2(4, 2);
        style->WindowPadding = ImVec2(4, 4);
        ImGui::CustomSpacing(9.f);
        InsertCheckbox("Bunny hop", g_Config.Misc.bunnyHop);
        InsertCheckbox("Air strafe", g_Config.Misc.airStrafe);
        BrowserGroup("Browser Misc");
        style->ItemSpacing = ImVec2(0, 0);
        style->WindowPadding = ImVec2(6, 6);
    } InsertEndGroupBoxLeft("Movement Cover", "Movement");
    ImGui::NextColumn();
    InsertGroupBoxRight("Settings and configs", 506.f); {
        BrowserGroup("Settings");
        if (ImGui::CollapsingHeader("Opponent overrides")) BrowserGroup("Players");
        InsertCheckbox("Automatic weapons", g_Config.Misc.automaticWeapons);
        InsertCheckbox("Persistent Killfeed", g_Config.Misc.persistentKillfeed);
        InsertCheckbox("Low FPS warning", g_Config.Misc.lowFpsWarning);
    } InsertEndGroupBoxRight("Settings Cover", "Settings and configs");
}
