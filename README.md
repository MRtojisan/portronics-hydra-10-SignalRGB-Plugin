# 🌈 Portronics Hydra 10 RGB Software Control (SignalRGB Plugin)

Finally! Software-level RGB control for the **Portronics Hydra 10 (POR-1607 / POR-2329)**. This project provides a custom plugin for **SignalRGB** to bypass the limited hardware presets and enable full desktop synchronization.

### 🔍 Hardware Compatibility
* **Device:** Portronics Hydra 10 (Mechanical Keyboard)
* **Vendor ID (VID):** `0x258A`
* **Product ID (PID):** `0x010C`
* **Controller:** SinoWealth Generic 68-Key HID
* **Status:** Verified Working (Wired Mode)

### 🛠 Installation
1. **Download:** Grab the `Portronics_Hydra10_SinoWealth.js` file from this repository.
2. **Locate Plugin Folder:** Open **SignalRGB**, go to **Settings** > **User Plugins**, and click the button **"Open Plugins Folder"**.
   * *Universal Path:* `%LocalAppData%\VortxEngine\app-VERSION\Signal-x64\Plugins\`
   *  or
   * `C:\Users\yourpcname\AppData\Local\VortxEngine\app-2.5.54\Signal-x64\Plugins\Sinowealth`
3. **Install:** Paste the `.js` file into that folder 
4. **Restart:** Restart SignalRGB.
5. **Mode:** Ensure your keyboard is in **Wired Mode** (the plugin cannot detect the keyboard over Bluetooth).

### 💡 Features
* **Software Control:** Change colors via your PC instead of clunky `Fn` keys.
* **Canvas Mode:** Sync your keyboard with your screen, music, or other RGB peripherals.
* **Forced Mode:** Set a solid custom color that isn't available in the factory presets.
* **Game Integration:** Works with SignalRGB’s game-sync features (e.g., flashing red on low health).

### 🤝 Contributing
If you find a bug or manage to get the 2.4GHz wireless dongle working with this protocol, feel free to open a Pull Request!
