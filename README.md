# 🌈 Portronics Hydra 10 RGB Software Control (SignalRGB Plugin)

Finally! Software-level RGB control for the **Portronics Hydra 10 (POR-1607 / POR-2329)**. This project provides custom plugins for **SignalRGB** to bypass the limited hardware presets and enable full desktop synchronization.

### 🔍 Hardware Compatibility

**Wired USB**
* **Device:** Portronics Hydra 10 (Mechanical Keyboard)
* **Vendor ID (VID):** `0x258A`
* **Product ID (PID):** `0x010C`
* **Controller:** SinoWealth Generic 68-Key HID
* **Status:** Verified Working (Wired Mode)

**2.4 GHz dongle**
* **Receiver:** Compx Hydra 10
* **Vendor ID (VID):** `0x3554`
* **Product ID (PID):** `0xFA09`
* **Lighting channel:** output report `0x13` on vendor interface 1
* **Status:** Verified Working (2.4 GHz Mode)

### 🛠 Installation
1. Download the plugin(s) you need from this repository:
   * `zz_Portronics_Hydra10.js` — wired USB
   * `zz_Portronics_Hydra10_Dongle.js` — 2.4 GHz receiver
2. Put them in `%USERPROFILE%\Documents\WhirlwindFX\Plugins` (create the `Plugins` folder if it isn't there). Newer SignalRGB versions don't have the User Plugins button in Settings anymore, so just open the folder in Explorer.
   Don't put them in `%LocalAppData%\VortxEngine\app-VERSION\...`. That folder gets replaced every time SignalRGB updates.
3. Keep the file names as they are. See the note below for why the wired plugin starts with `zz_`.
4. Restart SignalRGB completely (right-click the tray icon, Exit, then open it again).
5. Connect the keyboard with the USB cable, **or** plug in the 2.4 GHz receiver and switch the board to 2.4 GHz mode. You can install both plugins and use either transport without changing anything in SignalRGB.
6. In Lighting > Layout, make sure the whole keyboard is inside the canvas. If part of it sits outside (for example X is negative), those keys stay stuck on one color. Setting X and Y to 0 fixes it.
7. On the wireless plugin only, open the device's lighting settings and pick a **Frame size** (see below). The default of 7 is the best mix of smoothness and colour; leave it alone unless you want to trade one for the other.

### 📡 2.4 GHz dongle
The receiver enumerates as a **separate USB device** and does not speak the wired 519-byte feature protocol, so it gets its own plugin file. It is picked up automatically by VID/PID; there is nothing extra to configure.

The radio tops out at about **60 chunks per second**, and every frame has to name all 68 keys, so a full-board frame can never be shorter than 6 chunks. That is the hard ceiling of roughly 10 fps for this transport; wired USB stays around 30 fps.

#### Frame size setting
The plugin exposes a **Frame size** slider (device page → Portronics Hydra 10 (2.4 GHz) → lighting, under Forced Color). A frame can carry all 68 keys, so every extra colour costs 4 bytes and pushes the frame into another 14-byte chunk. Smaller frames go out more often; bigger frames reproduce the canvas more accurately.

| Frame size | Colours per frame | Full-board rate | Avg colour error |
| --- | --- | --- | --- |
| 6 | 4 | ~9–10 fps | 35/255 (blocky) |
| **7 (default)** | 7 | ~8 fps | 19/255 |
| 8 | 11 | ~7 fps | 10/255 |
| 10 | 18 | ~6 fps | under 2/255 |

A 2D rainbow is the worst case. Waves, gradients and solid colours look much better at the same setting (about 5/255 at size 7) because they contain fewer distinct colours. Frames with few enough colours are sent losslessly, so a solid colour is never approximated.

How it works: each frame's colours are clustered (median cut, then k-means seeded with the previous frame's centres) down to the number of groups the chunk budget allows. Reusing the previous centres keeps the groups stable, so colours do not shimmer between frames.

A full keyframe covering all 96 LED slots is still sent every second (8–12 chunks, depending on the setting). The 68 mapped keys get their canvas colours; the 28 slots with no key are held black. That last part is important: if those slots are omitted, the keyboard's own firmware effect keeps running on them and flashes through the desktop colours. The keyframe reuses the palette picked for the 68 mapped keys, so colours do not pop when it goes out.

#### Tuning the radio
The pacing constants are at the top of `zz_Portronics_Hydra10_Dongle.js`:

| Constant | Default | Meaning |
| --- | --- | --- |
| `DONGLE_CHUNK_GAP_MS` | `13` | Delay between chunk starts (vendor minimum) |
| `DONGLE_CHUNKS_PER_SEC` | `60` | Frame budget; the measured clean ceiling is about 64 |
| `DONGLE_KEYFRAME_MS` | `1000` | How often the 96-slot keyframe is refreshed |
| `DONGLE_SMOOTH_MODE` | `true` | Cluster colours to fit the chunk budget |
| `DONGLE_DELTA_MODE` | `false` | Send only changed LEDs. Keep it off: LEDs left out of a frame fall back to the firmware effect and the board flashes |

Only lower `DONGLE_CHUNK_GAP_MS` or raise `DONGLE_CHUNKS_PER_SEC` if you are willing to watch the log for `2.4GHz write failed`. A failed write makes the plugin back off for 100 ms instead of retrying on every render.

Wired USB remains the smoother option (~30 fps). Use the cable for fast whole-board animation; static colours and sparse effects work well over radio.

#### If the wireless plugin shows no lighting
1. Make sure the receiver's plugin was actually picked. The device should appear as **Portronics Hydra 10 (2.4 GHz)**, not as a generic HID device or a keyboard.
2. Open the newest log in `%LocalAppData%\WhirlwindFX\SignalRgb\Logs` and look for:
   ```
   HID plugin with id 0x3554:0xFA09 already exists. Overwriting with new path: ...\zz_Portronics_Hydra10_Dongle.js
   Hydra 10 2.4GHz initialized (output report 0x13, cmd 0x88)
   2.4GHz frame sent: 9 chunks (full 96-slot keyframe)
   ```
   A `2.4GHz write failed: ...` line means the endpoint was opened but the write was rejected.
3. If the plugin line is missing, SignalRGB did not load the file. Check that it is in the `Plugins` folder with the `.js` extension and restart SignalRGB from the tray icon, not just close the window.
4. Make sure only one file claims `3554:FA09`. Like the wired plugin, the `zz_` prefix wins over anything that sorts earlier.
5. Confirm the keyboard is awake and its switch is on **2.4 GHz**, and that the receiver is in a working USB port. Re-seat the receiver if needed.
6. The plugin only writes the verified live-lighting channel (output report `0x13`, command `0x88`). It never sends the config command `0x04`, so a failed experiment cannot leave the keyboard in a bad state.

### ⚠️ Why the wired file is named zz_
SignalRGB ships its own SinoWealth plugin (`Sinowealth_Keyboard_Controller.js`) that claims the same VID/PID (`258A:010C`). It doesn't know the Hydra 10 (the keyboard reports model 133), so when that plugin gets picked the keyboard shows up as "Sinowealth Device" and the device console says:

```
Unknown Device ID: [133]. Reach out to support@signalrgb.com, or visit our Discord to get it added.
Model not found in library!
Unknown protocol for 133
```

SignalRGB only keeps one plugin per VID/PID. From my logs it looks like it goes through plugins in alphabetical order and the last one wins, so a file called `Portronics_Hydra10_SinoWealth.js` gets replaced by the built-in one. The `zz_` prefix makes this plugin sort after `Sinowealth`. Installing the repo as a SignalRGB add-on didn't work for me either. I worked this out on SignalRGB 2.5.74 and it isn't documented anywhere, so an update could change it.

The receiver has a different VID/PID (`3554:FA09`), so there is no built-in plugin to fight with. Its file keeps the `zz_` prefix only for consistency.

To check which plugin got picked, open the newest log in `%LocalAppData%\WhirlwindFX\SignalRgb\Logs`. You should see:

```
HID plugin with id 0x258A:0x010C already exists. Overwriting with new path: C:/Users/<you>/Documents/WhirlwindFX/Plugins/zz_Portronics_Hydra10.js
```

and the keyboard should show up in SignalRGB as "Portronics Hydra 10" (wired) or "Portronics Hydra 10 (2.4 GHz)" (receiver).

### 🔬 2.4 GHz protocol (verified on hardware)
The receiver carries lighting on **output report `0x13`** (19 data bytes) of its vendor interface. Each frame is chunked:

```
[0x88][totalChunks][chunkIndex][0x10 + len][14 payload bytes][checksum]
```

The checksum is `(0x13 + sum(bytes 0..18)) & 0xff`. The payload is a sequence of groups, `[R, G, B, count, ledIndex...]`, using the same LED indices as the wired board (`1..95`, 68 mapped keys).

Only the live-lighting command `0x88` is ever sent. The config command `0x04` writes non-volatile storage and is deliberately not implemented.

Chunks are spaced 13 ms apart and budgeted at 60 chunks/second, below the measured clean ceiling of about 64. The budget is measured from the start of a frame, not the end, because the writes themselves already take around 13 ms per chunk.

### 💡 Features
* **Software Control:** Change colors via your PC instead of clunky `Fn` keys.
* **Canvas Mode:** Sync your keyboard with your screen, music, or other RGB peripherals.
* **Forced Mode:** Set a solid custom color that isn't available in the factory presets.
* **Game Integration:** Works with SignalRGB’s game-sync features (e.g., flashing red on low health).
* **Wireless Support:** Drive the keyboard through the 2.4 GHz dongle, no cable required.
* **Frame size control:** Trade wireless frame rate for colour accuracy on the fly, 6–10 chunks per frame.

### 🤝 Contributing
If you find a bug, open an issue or a Pull Request with your SignalRGB version, the transport you used, and the relevant log lines from `%LocalAppData%\WhirlwindFX\SignalRgb\Logs`.
