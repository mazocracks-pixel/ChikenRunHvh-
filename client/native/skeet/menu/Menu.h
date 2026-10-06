#pragma once
#include "Interfaces.h"

class Menu : public Singleton<Menu> {

public:
	void Render();
	void Shutdown();
	void ColorPicker(const char* name, float* color, bool alpha);

	void Aimbot();
	void Antiaim();
	void Visuals();
	void Misc();

	bool isOpen = false;
};
