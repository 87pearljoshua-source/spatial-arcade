# Spatial Finger Tracker - Lightgun Phone Controller

> **Note:** this is the original documentation for the phone controller page that powers the light gun (served at `/tracker/`). It was written while the page was built and has not been fully re-checked against the final build. The main project README is `../README.md`. Where this file mentions an older game ("Warehouse Run"), that game is not part of this submission. The newer bat, golf, brawler, duel and tennis games use a different phone page (`/bat`); see the main README.
>
> **Handy for troubleshooting "BORDER LOST":** open the tracker with the phone held sideways, go to Settings, and use the exposure threshold slider or the four draggable corner handles (see section 6 below). The TV must show the bright border described under Known Limits.


The phone is **strictly a gun controller**. The game is played and displayed **only on the TV**. The phone camera tracks the TV border in the background to calculate aim in real-time, providing instant local audio/haptic feedback on trigger pull.

---

## Architecture & Layout

1. **Play Screen (Gun Controller Mode)**:
   - **Landscape, clean black background**: The video preview, crosshairs, targets, impact marks, and scoreboards are removed from the main screen (available only in Settings).
   - **TRIGGER (Right ~60% full-height)**:
     - Touch down sends `{"type":"fire_down"}`.
     - Immediate local feedback: vibrates `35 ms` and plays a synthesized 90 ms noise burst + 60 Hz thump (or a 15 ms dry click if TV ammo is 0).
     - Holding for >250 ms automatically repeats recoil vibration and sound every 110 ms until release (or until TV ammo is 0 or reloading).
     - Touch up / cancel sends `{"type":"fire_up"}`.
     - Label updates to **START** when the TV scene is `"menu"`.
   - **RELOAD (Large square button, left-middle)**:
     - Touch down sends `{"type":"reload"}`, vibrates `20 ms`, and plays a metallic reload clack.
     - Automatically dimmed and disabled when the TV scene is `"menu"`.
   - **HOME (HOLD) (Top-left corner)**:
     - Requires pressing and holding for 500 ms with an animated SVG circular progress ring.
     - On completion: sends `{"type":"home"}` and vibrates once for `60 ms`. Releasing early cancels it.
   - **Independent Pointer Tracking**: TRIGGER and RELOAD can be touched simultaneously with different fingers. Touches starting outside buttons do not affect aim or fire.
   - **Small Dim SETTINGS Button (Bottom-left corner)**:
     - Opens the Settings & Calibration modal.
   - **Single Status Line**:
     - Displays `CONNECTED` or `RECONNECTING`, and dim `AMMO 9/30`.

2. **Web Audio API Sound Synthesis (Zero Audio Files)**:
   - AudioContext initializes / resumes on the first user touch.
   - **Shot sound**: 90 ms burst of white noise with fast exponential fade-out + 60 Hz sine thump lasting 70 ms.
   - **Dry click**: 15 ms high-frequency noise tick (triggered when TV reports ammo is 0).
   - **Reload clacks**: 30 ms resonant metallic noise burst when reloading begins, and a second higher clack when TV state changes from `reloading: true` to `reloading: false`.
   - **SOUND Switch**: Toggleable in Settings (default ON, saved in `localStorage`).

3. **Follows Messages From The TV**:
   - `{"type":"state","scene":"menu"|"play","ammo":...,"mag":...,"assist":...,"reloading":...,"hits":...,"shots":...}`: Updates HUD status, button labels, and stops auto-repeat if ammo is 0 or reloading is true.
   - `{"type":"shot","hit":true}`: Vibrates `[20, 40, 50]` **only if no finger is currently touching down**.
   - `{"type":"lock","locked":true}`: Vibrates `15 ms` **only if no finger is currently touching down**.
   - `{"type":"reload"}`: Vibrates `[30, 60, 30]` and plays the reload clack.
   - `{"type":"hurt"}`: Vibrates `[60, 40, 60]` when the player is hit (used by an older game that is not part of this submission).
   - `{"type":"result",...}`: Ignored on the phone controller.

4. **Bluetooth Gamepad Integration (Gamepad API)**:
   - Connects to any standard paired Bluetooth controller (Xbox, PlayStation, 8BitDo, generic).
   - High-performance polling: every 8 ms via `setInterval` AND on every `requestAnimationFrame` on the play screen (disabled inside Settings).
   - **Trigger**: Button 7 (R2), Button 5 (R1), or Button 0 (A) triggers `fire_down` with recoil vibration, shot audio, and full-auto repeat. Multiple held trigger buttons share one state and send `fire_up` only when all are released.
   - **Reload**: Button 2 (X), Button 4 (L1), or Button 6 (L2) triggers reload (`20 ms` vibration and clack).
   - **Home (Hold)**: Button 3 (Y) or Button 9 (Start) held for 500 ms triggers Home (`60 ms` vibration and fills the on-screen progress ring).
   - **Menu Choice**: D-pad Left (button 14) sends `{"type":"menu_sel","v":0}`. D-pad Right (button 15) sends `{"type":"menu_sel","v":1}`.
   - **Camera Authoritative**: Gamepad sticks are ignored completely; optical tracking solely controls aiming.
   - Disconnecting gamepad while trigger is held sends `fire_up`.
   - In Settings: includes `"GAMEPAD: connected / not connected"` status line with device name.

5. **XIT AR Blaster Integration (Web Bluetooth)**:
   - Connects to the XIT AR Blaster (Bluetooth name prefix `"ARGUN"`, service `0xFFF0`, characteristic `0xFFF3`).
   - Tapping the **BLASTER** button on the play screen (next to SETTINGS) or inside the Settings modal prompts the browser Bluetooth device picker.
   - Subscribes to characteristic notifications (`startNotifications()`), decodes incoming packet values as ASCII text via `TextDecoder`, trims whitespace, and fires the gun (same as the on-screen TRIGGER).
   - Displays `"BLASTER NOT SUPPORTED IN THIS BROWSER"` if Web Bluetooth is unavailable. All operations are safely wrapped in `try/catch`.

6. **Settings & Calibration Screen**:
   - Camera & CV debug view with detected quad border overlay and binary threshold mask toggle.
   - Exposure threshold slider (40–240) and smoothing alpha slider (0.05–0.95).
   - "Set Aim Point" tool: tap directly on the camera preview in Settings to calibrate sights offset.
   - Draggable 4-corner handles for manual quad calibration.
   - Homography Self-Test and Resolution Benchmark runners.
   - WebSocket relay URL and 4-letter Room Code inputs (auto-saved to device).
   - Direct toggle to switch into **Fire TV Receiver Mode** (`?mode=tv`).

---

## How to Set Relay URL and Room Code

1. Click the **Settings** icon (gear icon) in the top-right header of the phone tracker interface.
2. In the settings modal:
   - **Relay URL**: Enter your secure WebSocket relay endpoint (e.g., `wss://my-relay.onrender.com/ws` or `wss://<host>/ws`).
   - **Room Code**: Enter a 4-letter room code (e.g., `ABCD`; the games in this repo default to `ABCD`).
3. Click **Save & Connect**. The tracker immediately connects to:
   ```
   <RELAY_URL>?room=<ROOM_CODE>&role=phone
   ```
4. **Persistent Device Storage**:
   - Both the **Relay URL** and **Room Code** are automatically saved to `localStorage` on your phone, along with your calibrated Aim Offset, Exposure Threshold, and Corner Smoothing Alpha.
   - When you refresh the page or return later, your configured settings are preserved and reconnected automatically without needing to re-enter them.
5. The status pill in the top bar will display:
   - `connected` (green indicator with live round-trip latency in ms)
   - `reconnecting` (amber indicator, retrying every 1s)

You can also pre-populate these parameters via URL query parameters:
```
https://<your-app-url>/?room=TV01&relay=wss://my-relay.onrender.com/ws
```

To view the Fire TV Receiver display test scene on a TV or second screen:
```
https://<your-app-url>/?mode=tv
```

---

## Known Limits

1. **Room Lighting & Exposure**:
   - Extreme direct glare or direct sunlight reflecting off the television screen can wash out the high-contrast white border. Use the **Threshold Slider** in the sidebar to calibrate for ambient room lighting.
2. **TV Border Contrast**:
   - The television or monitor must display a clear, high-contrast white rectangular border (around 3.5% of screen height) against a dark or black screen bezel.
3. **Camera Framing & Distance**:
   - The phone camera must be positioned such that all four outer corners of the TV border remain within the camera's field of view. Extreme close-ups that clip one or more corners will trigger the `LOST` state.
4. **WebSocket Network Jitter**:
   - Optimal responsiveness requires low LAN or regional relay latency. If using a remote free cloud relay, round-trip time depends on network distance and host sleep states.
