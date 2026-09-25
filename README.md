# 🌈 Portronics Hydra 10 RGB Software Control (SignalRGB Plugin)

Finally! Software-level RGB control for the **Portronics Hydra 10 (POR-1607 / POR-2329)**. This project provides a custom plugin for **SignalRGB** to bypass the limited hardware presets and enable full desktop synchronization.

### 🔍 Hardware Compatibility
* **Device:** Portronics Hydra 10 (Mechanical Keyboard)
* **Vendor ID (VID):** `0x258A`
* **Product ID (PID):** `0x010C`
* **Controller:** SinoWealth Generic 68-Key HID
* **Status:** Verified Working (Wired Mode)

### 🛠 Installation
1. Download `zz_Portronics_Hydra10.js` from this repository.
2. Put it in `%USERPROFILE%\Documents\WhirlwindFX\Plugins` (create the `Plugins` folder if it isn't there). Newer SignalRGB versions don't have the User Plugins button in Settings anymore, so just open the folder in Explorer.
   Don't put it in `%LocalAppData%\VortxEngine\app-VERSION\...`. That folder gets replaced every time SignalRGB updates.
3. Keep the file name as it is. See the note below for why.
4. Restart SignalRGB completely (right-click the tray icon, Exit, then open it again).
5. Connect the keyboard with the USB cable. The plugin can't detect it over Bluetooth or the 2.4GHz dongle.
6. In Lighting > Layout, make sure the whole keyboard is inside the canvas. If part of it sits outside (for example X is negative), those keys stay stuck on one color. Setting X and Y to 0 fixes it.

### ⚠️ Why the file is named zz_
SignalRGB ships its own SinoWealth plugin (`Sinowealth_Keyboard_Controller.js`) that claims the same VID/PID. It doesn't know the Hydra 10 (the keyboard reports model 133), so when that plugin gets picked the keyboard shows up as "Sinowealth Device" and the device console says:

```
Unknown Device ID: [133]. Reach out to support@signalrgb.com, or visit our Discord to get it added.
Model not found in library!
Unknown protocol for 133
```

SignalRGB only keeps one plugin per VID/PID. From my logs it looks like it goes through plugins in alphabetical order and the last one wins, so a file called `Portronics_Hydra10_SinoWealth.js` gets replaced by the built-in one. The `zz_` prefix makes this plugin sort after `Sinowealth`. Installing the repo as a SignalRGB add-on didn't work for me either. I worked this out on SignalRGB 2.5.74 and it isn't documented anywhere, so an update could change it.

To check which plugin got picked, open the newest log in `%LocalAppData%\WhirlwindFX\SignalRgb\Logs`. You should see:

```
HID plugin with id 0x258A:0x010C already exists. Overwriting with new path: C:/Users/<you>/Documents/WhirlwindFX/Plugins/zz_Portronics_Hydra10.js
```

and the keyboard should show up in SignalRGB as "Portronics Hydra 10".

### 💡 Features
* **Software Control:** Change colors via your PC instead of clunky `Fn` keys.
* **Canvas Mode:** Sync your keyboard with your screen, music, or other RGB peripherals.
* **Forced Mode:** Set a solid custom color that isn't available in the factory presets.
* **Game Integration:** Works with SignalRGB’s game-sync features (e.g., flashing red on low health).

### 🤝 Contributing
If you find a bug or manage to get the 2.4GHz wireless dongle working with this protocol, feel free to open a Pull Request!
