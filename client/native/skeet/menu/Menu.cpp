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

                const char* tabs[] = {"Rage", "Anti-aim", "Legit", "Visuals", "Misc", "Skins", "Players"};
                ImGui::TabSpacer("##Top Spacer", ImVec2(75.f, 10.f));
                for (int i = 0; i < 7; i++) {
                    if (i == tab) ImGui::SelectedTab(tabs[i], ImVec2(75.f, 75.f));
                    else if (ImGui::Tab(tabs[i], ImVec2(75.f, 75.f))) tab = i;
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

	ImGui::Columns(2, NULL, false); {

		InsertGroupBoxLeft("Aimbot", 427.f); {
 BrowserGroup("Trigger");
 } InsertEndGroupBoxLeft("Aimbot Cover", "Aimbot");
	}
	ImGui::NextColumn(); {

		InsertGroupBoxRight("Triggerbot", 277.f); {
 BrowserGroup("Triggerbot");
 } InsertEndGroupBoxRight("Triggerbot Cover", "Triggerbot");

		InsertSpacer("Triggerbot - Other Spacer");

		InsertGroupBoxRight("Other", 132.f); {
 BrowserGroup("Other");
 } InsertEndGroupBoxRight("Other Cover", "Other");
	}
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
			ImGui::TextDisabled("Money: unavailable in HvH");
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
			
			ImGui::TextDisabled("Hands: no hand model");


			if (g_Config.Visuals.ColoredModels.hands) {

				InsertComboWithoutText("##hands material", g_Config.Visuals.ColoredModels.handsMaterial, chamsMaterials);
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
			ImGui::TextDisabled("Bomb: unavailable in HvH");

			InsertCheckbox("Grenade trajectory", g_Config.Visuals.Other.grenadeTrajectory);
			InsertColorPicker("##Grenade trajectory color", g_Config.Color.Other.grenadeTrajectory, false);
			InsertCheckbox("Grenade proximity warning", g_Config.Visuals.Other.grenadeProximityWarning);
			InsertCheckbox("Dead players", g_Config.Visuals.Other.spectators);
			InsertCheckbox("Penetration reticle", g_Config.Visuals.Other.penetrationReticle);
			ImGui::Spacing(); ImGui::TextDisabled("Hostages (unavailable)");
			ImGui::Spacing(); ImGui::TextDisabled("Upgrade tablet (unavailable)");
			ImGui::Spacing(); ImGui::TextDisabled("Danger Zone items (unavailable)");

			if (g_Config.Visuals.Other.dangerZoneItems) {

				InsertCheckbox("Drone gun", g_Config.Visuals.DangerZone.droneGun);
				InsertCheckbox("Blackhawk", g_Config.Visuals.DangerZone.blackhawk);
				InsertCheckbox("Drone", g_Config.Visuals.DangerZone.drone);
				InsertCheckbox("Random case", g_Config.Visuals.DangerZone.randomCase);
				InsertCheckbox("Tool case", g_Config.Visuals.DangerZone.toolCase);
				InsertCheckbox("Pistol case", g_Config.Visuals.DangerZone.pistolCase);
				InsertCheckbox("Explosive case", g_Config.Visuals.DangerZone.explosiveCase);
				InsertCheckbox("Heavy weapon case", g_Config.Visuals.DangerZone.heavyWeaponCase);
				InsertCheckbox("Dufflebag", g_Config.Visuals.DangerZone.dufflebag);
				InsertCheckbox("Jammer", g_Config.Visuals.DangerZone.jammer);
				InsertCheckbox("Ammo box", g_Config.Visuals.DangerZone.ammoBox);
				InsertCheckbox("Armor", g_Config.Visuals.DangerZone.armor);
				InsertCheckbox("Parachute pack", g_Config.Visuals.DangerZone.parachutePack);
				InsertCheckbox("Briefcase", g_Config.Visuals.DangerZone.briefcase);
				InsertCheckbox("Tablet upgrade zone", g_Config.Visuals.DangerZone.tabletUpgradeZone);
				InsertCheckbox("Tablet upgrade drone", g_Config.Visuals.DangerZone.tabletUpgradeDrone);
				InsertCheckbox("Cash stack", g_Config.Visuals.DangerZone.cashStack);
			}
			else {

				// nothing
			}

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

			ImGui::Spacing(); ImGui::TextDisabled("Knifebot (unavailable)");

			if (g_Config.Misc.knifeBot) {

				InsertMultiComboWithoutText("##knifebot settings", knifebotSettings, g_Config.Misc.knifeBotSettings, 2);			
			}
			else {

				// nothing
			}

			ImGui::Spacing(); ImGui::TextDisabled("Zeusbot (unavailable)");

			if (g_Config.Misc.knifeBot) {

				// add slider for hitchance
			}
			else {

				// nothing
			}

			ImGui::Spacing(); ImGui::TextDisabled("Blockbot (unavailable)");
			InsertCheckbox("Automatic weapons", g_Config.Misc.automaticWeapons);
			ImGui::Spacing(); ImGui::TextDisabled("Jump at edge (unavailable)");
			ImGui::Spacing(); ImGui::TextDisabled("Ragdoll force (unavailable)");
			ImGui::Spacing(); ImGui::TextDisabled("Ragdoll gravity (unavailable)");
			ImGui::Spacing(); ImGui::TextDisabled("Reveal competitive ranks (unavailable)");
			ImGui::Spacing(); ImGui::TextDisabled("Auto-accept matchmaking (unavailable)");
			ImGui::Spacing(); ImGui::TextDisabled("Clan tag spammer (unavailable)");
			ImGui::TextDisabled("Purchases: no shop in HvH");
			InsertCheckbox("Log damage dealt", g_Config.Misc.logDamageDealt);
			ImGui::Spacing(); ImGui::TextDisabled("Fast walk (unavailable)");
			ImGui::Spacing(); ImGui::TextDisabled("Free look (unavailable)");
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

			ImGui::Spacing(); ImGui::TextDisabled("Anti-untrusted (unavailable)");
			ImGui::Spacing(); ImGui::TextDisabled("Anti-screenshot (unavailable)");
			InsertCheckbox("Low FPS warning", g_Config.Misc.lowFpsWarning); BrowserGroup("Settings");

			style->ItemSpacing = ImVec2(0, 0);
			style->WindowPadding = ImVec2(6, 6);

		} InsertEndGroupBoxRight("Settings Cover", "Settings");

		InsertSpacer("Settings - Other Spacer");

		InsertGroupBoxRight("Other", 332.f); {
 BrowserGroup("Other");
 } InsertEndGroupBoxRight("Other Cover", "Other");
	}
}

void Menu::Skins() {

	ImGuiStyle* style = &ImGui::GetStyle();
	InsertSpacer("Top Spacer");

	ImGui::Columns(2, NULL, false); {

		InsertGroupBoxLeft("Knife options", 112.f); {
 BrowserGroup("Knife options");
 } InsertEndGroupBoxLeft("Knife options Cover", "Knife options");

		InsertSpacer("Fake lag - Other Spacer");

		InsertGroupBoxLeft("Glove options", 376.f); {
 BrowserGroup("Glove options");
 } InsertEndGroupBoxLeft("Glove options Cover", "Glove options");
	}
	ImGui::NextColumn(); {

		InsertGroupBoxRight("Weapon skin", 506.f); {
 BrowserGroup("Weapon skin");
 } InsertEndGroupBoxRight("Weapon skin Cover", "Weapon skin");
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
