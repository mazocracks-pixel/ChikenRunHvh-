#pragma once
#include <string>
#include <cstdint>
using BYTE=unsigned char;
template<class T> class Singleton { public: static T& Get() { static T value; return value; } };
