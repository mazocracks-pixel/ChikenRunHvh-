#include "Menu.h"
#include "MenuControls.h"
#include "Dropdown.h"
#include "Config.h"

#include "imgui.h"
#include "imgui_internal.h"
#include <cmath>


extern ImFont* menuFont;
extern ImFont* tabFont;
extern ImFont* tabFont2;
extern ImFont* tabFont3;
extern ImFont* controlFont;
extern ImTextureID menuBg;
void BrowserGroup(const char* name);

static int tab = 0;

// The tab icons, drawn from lines and shapes (the original icon font is not available).
static void DrawTabIcon(int i, ImDrawList* d, ImVec2 c, ImU32 col) {
	switch (i) {
	case 0: // Rage: a crosshair
		d->AddCircle(c, 9.f, col, 24, 2.f);
		d->AddLine(ImVec2(c.x, c.y - 14.f), ImVec2(c.x, c.y - 5.f), col, 2.f);
		d->AddLine(ImVec2(c.x, c.y + 5.f), ImVec2(c.x, c.y + 14.f), col, 2.f);
		d->AddLine(ImVec2(c.x - 14.f, c.y), ImVec2(c.x - 5.f, c.y), col, 2.f);
		d->AddLine(ImVec2(c.x + 5.f, c.y), ImVec2(c.x + 14.f, c.y), col, 2.f);
		d->AddCircleFilled(c, 1.8f, col, 8);
		break;
	case 1: // Anti-aim: a shield, its left half filled
		d->PathLineTo(ImVec2(c.x, c.y - 12.f));
		d->PathLineTo(ImVec2(c.x + 10.f, c.y - 8.f));
		d->PathLineTo(ImVec2(c.x + 10.f, c.y));
		d->PathBezierCurveTo(ImVec2(c.x + 10.f, c.y + 7.f), ImVec2(c.x + 5.f, c.y + 11.f), ImVec2(c.x, c.y + 13.f));
		d->PathBezierCurveTo(ImVec2(c.x - 5.f, c.y + 11.f), ImVec2(c.x - 10.f, c.y + 7.f), ImVec2(c.x - 10.f, c.y));
		d->PathLineTo(ImVec2(c.x - 10.f, c.y - 8.f));
		d->PathStroke(col, true, 2.f);
		d->PathLineTo(ImVec2(c.x, c.y - 12.f));
		d->PathLineTo(ImVec2(c.x, c.y + 13.f));
		d->PathBezierCurveTo(ImVec2(c.x - 5.f, c.y + 11.f), ImVec2(c.x - 10.f, c.y + 7.f), ImVec2(c.x - 10.f, c.y));
		d->PathLineTo(ImVec2(c.x - 10.f, c.y - 8.f));
		d->PathFillConvex(col);
		break;
	case 2: // Legit: a pistol, muzzle to the left
		d->AddRectFilled(ImVec2(c.x - 13.f, c.y - 8.f), ImVec2(c.x + 11.f, c.y - 2.f), col, 1.5f);
		d->AddRectFilled(ImVec2(c.x - 12.f, c.y - 10.f), ImVec2(c.x - 10.f, c.y - 8.f), col);
		d->AddQuadFilled(ImVec2(c.x + 3.f, c.y - 2.f), ImVec2(c.x + 10.f, c.y - 2.f), ImVec2(c.x + 13.f, c.y + 10.f), ImVec2(c.x + 6.f, c.y + 10.f), col);
		d->PathArcTo(ImVec2(c.x + 0.5f, c.y - 2.f), 3.5f, 0.f, IM_PI, 8);
		d->PathStroke(col, false, 1.5f);
		break;
	case 3: // Visuals: an eye
		d->PathLineTo(ImVec2(c.x - 14.f, c.y));
		d->PathBezierCurveTo(ImVec2(c.x - 7.f, c.y - 10.f), ImVec2(c.x + 7.f, c.y - 10.f), ImVec2(c.x + 14.f, c.y));
		d->PathBezierCurveTo(ImVec2(c.x + 7.f, c.y + 10.f), ImVec2(c.x - 7.f, c.y + 10.f), ImVec2(c.x - 14.f, c.y));
		d->PathStroke(col, true, 2.f);
		d->AddCircleFilled(c, 4.5f, col, 16);
		d->AddCircleFilled(c, 1.8f, IM_COL32(10, 10, 10, 255), 8);
		break;
	case 4: // Misc: a gear
		d->AddCircle(c, 6.5f, col, 20, 3.f);
		for (int k = 0; k < 8; k++) {
			const float a = k * IM_PI / 4.f, x = cosf(a), y = sinf(a);
			auto at = [&](float r, float w) { return ImVec2(c.x + x * r - y * w, c.y + y * r + x * w); };
			d->AddQuadFilled(at(7.f, -2.5f), at(12.f, -1.8f), at(12.f, 1.8f), at(7.f, 2.5f), col);
		}
		break;
	case 5: // Skins: a paint drop
		d->AddCircleFilled(ImVec2(c.x, c.y + 3.f), 8.f, col, 20);
		d->AddTriangleFilled(ImVec2(c.x, c.y - 13.f), ImVec2(c.x + 6.93f, c.y - 1.f), ImVec2(c.x - 6.93f, c.y - 1.f), col);
		break;
	case 6: // Players: a head and shoulders
		d->AddCircleFilled(ImVec2(c.x, c.y - 6.f), 5.f, col, 16);
		d->PathArcTo(ImVec2(c.x, c.y + 12.f), 10.f, IM_PI, 2.f * IM_PI, 16);
		d->PathFillConvex(col);
		break;
	}
}

// Icon and name on the tab just drawn: the menu colour when selected, brighter on hover.
static void DrawTab(int i, const char* name, bool selected) {
	ImDrawList* d = ImGui::GetWindowDrawList();
	const ImVec2 a = ImGui::GetItemRectMin(), b = ImGui::GetItemRectMax();
	const bool hovered = !selected && ImGui::IsItemHovered();
	const ImU32 icon = selected ? ImGui::GetColorU32(ImGuiCol_MenuTheme) : hovered ? IM_COL32(205, 205, 205, 255) : IM_COL32(92, 92, 92, 255);
	const ImU32 text = selected ? IM_COL32(220, 220, 220, 255) : hovered ? IM_COL32(180, 180, 180, 255) : IM_COL32(105, 105, 105, 255);
	const float cx = floorf((a.x + b.x) * 0.5f);
	DrawTabIcon(i, d, ImVec2(cx, a.y + 30.f), icon);
	const ImVec2 size = ImGui::CalcTextSize(name);
	d->AddText(ImVec2(floorf(cx - size.x * 0.5f), a.y + 52.f), text, name);
}

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
	// I4: the menu colour (ticks, sliders, the selected tab) comes from your config.
	style->Colors[ImGuiCol_MenuTheme] = ImVec4(g_Config.Misc.menuColor[0], g_Config.Misc.menuColor[1], g_Config.Misc.menuColor[2], 1.f);

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

                const char* tabs[] = {"Rage", "Anti-aim", "Legit", "Visuals", "Misc", "Skins", "Players"};
                // "##" hides the widgets' own text: DrawTab draws an icon and the name instead.
                const char* ids[] = {"##Rage", "##Anti-aim", "##Legit", "##Visuals", "##Misc", "##Skins", "##Players"};
                ImGui::TabSpacer("##Top Spacer", ImVec2(75.f, 10.f));
                for (int i = 0; i < 7; i++) {
                    const bool selected = i == tab;
                    if (selected) ImGui::SelectedTab(ids[i], ImVec2(75.f, 75.f));
                    else if (ImGui::Tab(ids[i], ImVec2(75.f, 75.f))) tab = i;
                    DrawTab(i, tabs[i], selected);
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
					Legit();
					break;
				case 3:
					Visuals();
					break;
				case 4:
					Misc();
					break;
				case 5:
					Skins();
					break;
				case 6:
					Players();
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

	ImGuiStyle* style = &ImGui::GetStyle();
	InsertSpacer("Top Spacer");

	ImGui::Columns(2, NULL, false); {

		InsertGroupBoxLeft("Aimbot", 506.f); {
 BrowserGroup("Aimbot");
 } InsertEndGroupBoxLeft("Aimbot Cover", "Aimbot");
	}
	ImGui::NextColumn(); {

		InsertGroupBoxRight("Other", 506.f); {
 BrowserGroup("Rage Other");
 } InsertEndGroupBoxRight("Other Cover", "Other");
	}
}

void Menu::Antiaim() {

	ImGuiStyle* style = &ImGui::GetStyle();
	InsertSpacer("Top Spacer");

	ImGui::Columns(2, NULL, false); {

		InsertGroupBoxLeft("Anti-aimbot angles", 506.f); {
 BrowserGroup("Anti-aimbot angles");
 } InsertEndGroupBoxLeft("Anti-aimbot angles Cover", "Anti-aimbot angles");

	}
	ImGui::NextColumn(); {

		InsertGroupBoxRight("Fake lag", 331.f); {
 BrowserGroup("Fake lag");
 } InsertEndGroupBoxRight("Fake lag Cover", "Fake lag");

		InsertSpacer("Fake lag - Other Spacer");

		InsertGroupBoxRight("Other", 157.f); {
 BrowserGroup("Other");
 } InsertEndGroupBoxRight("Other Cover", "Other");
	}
}

void Menu::Legit() {

	ImGuiStyle* style = &ImGui::GetStyle();
	InsertSpacer("Top Spacer");

	InsertGroupBoxTop("Weapon Selection", ImVec2(535.f, 61.f)); {
 BrowserGroup("Weapon Selection");
 } InsertEndGroupBoxTop("Weapon Selection Cover", "Weapon Selection", ImVec2(536.f, 11.f));

	InsertSpacer("Weapon Selection - Main Group boxes Spacer");

	InsertGroupBoxTop("Triggerbot", ImVec2(535.f, 427.f)); {
 BrowserGroup("Trigger");
 } InsertEndGroupBoxTop("Triggerbot Cover", "Triggerbot", ImVec2(536.f, 11.f));
}

void Menu::Visuals() {

	ImGuiStyle* style = &ImGui::GetStyle();
	InsertSpacer("Top Spacer");

	ImGui::Columns(2, NULL, false); {

		InsertGroupBoxLeft("Player ESP", 331.f); {

			style->ItemSpacing = ImVec2(4, 2);
			style->WindowPadding = ImVec2(4, 4);
			ImGui::CustomSpacing(9.f);

			// to do : activation hotkey
			InsertCheckbox("Teammates", g_Config.Visuals.Players.teammates);
			InsertCheckbox("Dormant", g_Config.Visuals.Players.dormant);
			InsertCheckbox("Bounding box", g_Config.Visuals.Players.boundingBox);
			InsertColorPicker("##Bounding box color", g_Config.Color.Players.boundingBox, false);
			InsertCheckbox("Health bar", g_Config.Visuals.Players.healthBar);
			InsertCheckbox("Name", g_Config.Visuals.Players.name);
			InsertColorPicker("##Name color", g_Config.Color.Players.name, false);
			InsertCheckbox("Flags", g_Config.Visuals.Players.flags);
			InsertCheckbox("Weapon text", g_Config.Visuals.Players.weaponText);
			InsertCheckbox("Weapon icon", g_Config.Visuals.Players.weaponIcon);
			InsertColorPicker("##Weapon color", g_Config.Color.Players.weaponIcon, false);
			InsertCheckbox("Ammo", g_Config.Visuals.Players.ammo);
			InsertColorPicker("##Ammo color", g_Config.Color.Players.ammo, false);
			InsertCheckbox("Distance", g_Config.Visuals.Players.distance);
			InsertCheckbox("Glow", g_Config.Visuals.Players.glow);
			InsertColorPicker("##Glow color", g_Config.Color.Players.glow, true);
			InsertCheckbox("Hit marker", g_Config.Visuals.Players.hitmarker);
			InsertCheckbox("Hit marker sound", g_Config.Visuals.Players.hitmarkerSound);
			InsertCheckbox("Shot sounds", g_Config.Visuals.Players.visualizeSounds);
			InsertColorPicker("##Sounds color", g_Config.Color.Players.visualizeSounds, false);
			InsertCheckbox("Line of sight", g_Config.Visuals.Players.lineOfSight);
			InsertColorPicker("##Line of sight color", g_Config.Color.Players.lineOfSight, false);
			InsertCheckbox("Skeleton", g_Config.Visuals.Players.skeleton);
			InsertColorPicker("##Skeleton color", g_Config.Color.Players.skeleton, false);
			InsertCheckbox("Out of FOV arrow", g_Config.Visuals.Players.outOfFOVArrow);
			InsertColorPicker("##Out of FOV arrow color", g_Config.Color.Players.outOfFOVArrow, false);

			if (g_Config.Visuals.Players.outOfFOVArrow) {

				InsertSliderWithoutText("##arrow size", g_Config.Visuals.Players.arrowSize, 0.f, 30.f, "%1.fpx");
				InsertSliderWithoutText("##arrow distance", g_Config.Visuals.Players.arrowDistance, 0.f, 100.f, "%1.f%%");
			}
			else {

				// nothing
			}

			style->ItemSpacing = ImVec2(0, 0);
			style->WindowPadding = ImVec2(6, 6);

		} InsertEndGroupBoxLeft("Player ESP Cover", "Player ESP");

		InsertSpacer("Player ESP - Colored models Spacer");

		InsertGroupBoxLeft("Colored models", 157.f); {

			style->ItemSpacing = ImVec2(4, 2);
			style->WindowPadding = ImVec2(4, 4);
			ImGui::CustomSpacing(9.f);	

			InsertCheckbox("Player", g_Config.Visuals.ColoredModels.player);
			InsertColorPicker("##Player color", g_Config.Color.ColoredModels.player, true);

			if (g_Config.Visuals.ColoredModels.player) {

				InsertCheckbox("Player behind wall", g_Config.Visuals.ColoredModels.playerBehindWall);
				ImGui::SameLine(219.f);
				ImGui::ColorEdit4("##reeeeeeeeeee", g_Config.Color.ColoredModels.playerBehindWall, ImGuiColorEditFlags_NoInputs);
				//InsertColorPicker("##Player behind wall color", g_Config.Color.ColoredModels.playerBehindWall, true);
				InsertComboWithoutText("##player material", g_Config.Visuals.ColoredModels.playerMaterial, chamsMaterials);

				if (g_Config.Visuals.ColoredModels.playerMaterial == 3) {

					InsertColorPicker("##Reflectivity color", g_Config.Color.ColoredModels.playerReflectivityColor, false);
				}
				else {

					// nothing
				}

				InsertCheckbox("Show teammates", g_Config.Visuals.ColoredModels.teammates);
				InsertColorPicker("##Teammates color", g_Config.Color.ColoredModels.teammates, true);
			}
			else {

				// nothing
			}
			



			InsertCheckbox("Weapons", g_Config.Visuals.ColoredModels.weapons);
			InsertColorPicker("##Weapons color", g_Config.Color.ColoredModels.weapons, true);

			if (g_Config.Visuals.ColoredModels.weapons) {

				InsertComboWithoutText("##weapons material", g_Config.Visuals.ColoredModels.weaponsMaterial, chamsMaterials);
			}
			else {

				// nothing
			}

			InsertCheckbox("Disable model occlusion", g_Config.Visuals.ColoredModels.disableModelOcclusion);
			InsertCheckbox("Shadow", g_Config.Visuals.ColoredModels.shadow);
			InsertColorPicker("##Shadow color", g_Config.Color.ColoredModels.shadow, true);
			InsertCheckbox("Local fake shadow", g_Config.Visuals.ColoredModels.localFakeShadow);
			InsertColorPicker("##Local fake shadow color", g_Config.Color.ColoredModels.localFakeShadow, true);

			style->ItemSpacing = ImVec2(0, 0);
			style->WindowPadding = ImVec2(6, 6);

		} InsertEndGroupBoxLeft("Colored models Cover", "Colored models");
	}
	ImGui::NextColumn(); {

		InsertGroupBoxRight("Other ESP", 199.f); {

			style->ItemSpacing = ImVec2(4, 2);
			style->WindowPadding = ImVec2(4, 4);
			ImGui::CustomSpacing(9.f);

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
			InsertCheckbox("Crosshair", g_Config.Visuals.Other.crosshair);

			InsertCheckbox("Grenade trajectory", g_Config.Visuals.Other.grenadeTrajectory);
			InsertColorPicker("##Grenade trajectory color", g_Config.Color.Other.grenadeTrajectory, false);
			InsertCheckbox("Grenade proximity warning", g_Config.Visuals.Other.grenadeProximityWarning);
			InsertCheckbox("Dead players", g_Config.Visuals.Other.spectators);
			InsertCheckbox("Penetration reticle", g_Config.Visuals.Other.penetrationReticle);


			style->ItemSpacing = ImVec2(0, 0);
			style->WindowPadding = ImVec2(6, 6);

		} InsertEndGroupBoxRight("Other ESP Cover", "Other ESP");

		InsertSpacer("Other ESP - Effects Spacer");

		InsertGroupBoxRight("Effects", 289.f); {

			style->ItemSpacing = ImVec2(4, 2);
			style->WindowPadding = ImVec2(4, 4);
			ImGui::CustomSpacing(9.f);

			InsertCheckbox("Remove flashbang effects", g_Config.Visuals.Effects.removeFlashbangEffects);
			InsertCheckbox("Remove smoke grenades", g_Config.Visuals.Effects.removeSmokeGrenades);
			InsertCheckbox("Remove fog", g_Config.Visuals.Effects.removeFog);
			InsertCheckbox("Remove grass", g_Config.Visuals.Effects.removeGrass);
			InsertCheckbox("Remove skybox", g_Config.Visuals.Effects.removeSkybox);
			InsertCombo("Visual recoil adjustment", g_Config.Visuals.Effects.visualRecoilAdjustment, visualRecoilAdjustment);
			InsertSlider("Transparent walls", g_Config.Visuals.Effects.transparentWalls, 0.f, 100.f, "%1.f%%");
			InsertSlider("Transparent props", g_Config.Visuals.Effects.transparentProps, 0.f, 100.f, "%1.f%%");
			InsertMultiCombo("Brightness adjustment", brightnessAdjustment, g_Config.Visuals.Effects.brightnessAdjustment, 2);
			InsertCheckbox("Remove scope overlay", g_Config.Visuals.Effects.removeScopeOverlay);
			InsertCheckbox("Disable post processing", g_Config.Visuals.Effects.disablePostProcessing);
			InsertCheckbox("Force third person", g_Config.Visuals.Effects.forceThirdPerson);
			InsertCheckbox("Disable rendering of teammates", g_Config.Visuals.Effects.disableRenderingOfTeammates);
			InsertCheckbox("Bullet tracers", g_Config.Visuals.Effects.bulletTracers); // only enemy
			InsertCheckbox("Bullet impacts", g_Config.Visuals.Effects.bulletImpacts);

			style->ItemSpacing = ImVec2(0, 0);
			style->WindowPadding = ImVec2(6, 6);

		} InsertEndGroupBoxRight("Effects Cover", "Effects");
	}
}

void Menu::Misc() {

	ImGuiStyle* style = &ImGui::GetStyle();
	InsertSpacer("Top Spacer");

	ImGui::Columns(2, NULL, false); {

		InsertGroupBoxLeft("Miscellaneous", 506.f); {

			style->ItemSpacing = ImVec2(4, 2);
			style->WindowPadding = ImVec2(4, 4);
			ImGui::CustomSpacing(9.f);

			InsertSlider("Override FOV", g_Config.Misc.overrideFov, 0.f, 120.f, "%1.f");
			InsertCheckbox("Bunny hop", g_Config.Misc.bunnyHop);
			InsertCheckbox("Air strafe", g_Config.Misc.airStrafe);

			if (g_Config.Misc.airStrafe) {

				ImGui::TextDisabled("Directional air strafing");
			}
			else {

				// nothing
			}





			InsertCheckbox("Automatic weapons", g_Config.Misc.automaticWeapons);
			InsertCheckbox("Log damage dealt", g_Config.Misc.logDamageDealt);
			InsertCheckbox("Persistent Killfeed", g_Config.Misc.persistentKillfeed); BrowserGroup("Browser Misc");

			style->ItemSpacing = ImVec2(0, 0);
			style->WindowPadding = ImVec2(6, 6);

		} InsertEndGroupBoxLeft("Miscellaneous Cover", "Miscellaneous");

	}
	ImGui::NextColumn(); {

		InsertGroupBoxRight("Settings", 156.f); {

			style->ItemSpacing = ImVec2(4, 2);
			style->WindowPadding = ImVec2(4, 4);
			ImGui::CustomSpacing(9.f);

			ImGui::Spacing(); ImGui::NewLine(); ImGui::SameLine(42.f); ImGui::AlignTextToFramePadding(); ImGui::TextUnformatted("Menu color");
			InsertColorPicker("Menu color", g_Config.Misc.menuColor, false);
			InsertCheckbox("Low FPS warning", g_Config.Misc.lowFpsWarning); BrowserGroup("Settings");

			style->ItemSpacing = ImVec2(0, 0);
			style->WindowPadding = ImVec2(6, 6);

		} InsertEndGroupBoxRight("Settings Cover", "Settings");

		InsertSpacer("Settings - Other Spacer");

		InsertGroupBoxRight("Other", 332.f); {
 BrowserGroup("Misc Other");
 } InsertEndGroupBoxRight("Other Cover", "Other");
	}
}

void Menu::Skins() {

	ImGuiStyle* style = &ImGui::GetStyle();
	InsertSpacer("Top Spacer");

	ImGui::Columns(2, NULL, false); {

		InsertGroupBoxLeft("Weapon skin", 506.f); {
 BrowserGroup("Weapon skin");
 } InsertEndGroupBoxLeft("Weapon skin Cover", "Weapon skin");
	}
	ImGui::NextColumn(); {

		InsertGroupBoxRight("Weapon stats", 506.f); {
 BrowserGroup("Weapon stats");
 } InsertEndGroupBoxRight("Weapon stats Cover", "Weapon stats");
	}
}

void Menu::Players() {

	ImGuiStyle* style = &ImGui::GetStyle();
	InsertSpacer("Top Spacer");

	ImGui::Columns(2, NULL, false); {

		InsertGroupBoxLeft("Players", 506.f); {
 BrowserGroup("Players");
 } InsertEndGroupBoxLeft("Players Cover", "Players");
	}
	ImGui::NextColumn(); {

		InsertGroupBoxRight("Adjustments", 506.f); {
 BrowserGroup("Adjustments");
 } InsertEndGroupBoxRight("Adjustments Cover", "Adjustments");
	}
}
