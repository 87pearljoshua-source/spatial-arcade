# Spatial Arcade

**Turn the phone you already own into a motion and aim controller for Fire TV. No extra hardware.**

Built by Josh Pearl for the Amazon "Build, Ship, Shape" Developer Hackathon, Fire TV track.

Fire TV has no built-in way to aim a gun or swing a bat. Light guns and motion controllers need extra hardware that costs money. This project uses the camera in an ordinary phone to follow a prop (a toy gun, a bat, a racket) or a hand, sends the movement to the TV over the internet, and lets Fire TV games react to it in real time.

The games are the proof. The product is the **input layer**: a small relay server plus a phone page that any Fire TV web game can listen to.

---

## Play the games

Every game runs as a web page on the Fire TV (open it in the **Amazon Web App Tester**) and is controlled by a web page on a phone. Open the TV page first, then the phone page.

Base address: `https://spatial-arcade.onrender.com`

| Game | What it is | Open on the Fire TV | Open on the phone |
|---|---|---|---|
| **Sky Delivery** | Light-gun shooter. Aim the phone at the screen, pull the trigger. | `/tv` | `/tracker/` (or scan the QR on the TV) |
| **Driving Range** | Golf. A full swing hits the ball; swing speed sets distance. | `/golf` | `/bat` |
| **Boulevard of Brawl** | First-person street brawler. Swing direction picks the move. Scan a real object to choose your weapon. | `/brawl` | `/bat` |
| **Boulevard Duel** | One-on-one fighter, best of three. Block, special move, finisher you choose yourself. | `/duel` | `/bat` |
| **Rooftop Rally** | First-person tennis against the computer. You serve too. | `/tennis` | `/posesend.html` (tracks your arm; the game draws the racket) |

Examples: Fire TV `https://spatial-arcade.onrender.com/tennis`, phone `https://spatial-arcade.onrender.com/bat`.

**Players and records:** each game shows the current player in the top-left corner. Press **Menu** on the Fire TV remote (in Sky Delivery, **Fast-forward**; on a keyboard, **P**) to pick a player, add a new one (up to 6), or see records. High scores and records are saved per player, per game, in the TV browser. They stay on that device and can be lost if the browser data is cleared.

**Easiest pairing:** the TV title screen shows a QR code. Scan it with the phone and it opens the right phone page already paired.

**Steps**
1. On the Fire TV, open the game's address in the Web App Tester.
2. On the phone (Chrome), open the phone address and allow the camera.
3. The TV changes from "WAITING FOR PHONE" to "PHONE CONNECTED".
4. Swing, or press OK on the Fire TV remote, to begin. The bat games ask for three warm-up swings so they can match your swing speed.

**Notes**
- The free server sleeps when unused. The first page load can take up to about a minute.
- Games use room code `ABCD` by default. If two TVs use the same room, they will hear each other's phones. Add `?room=XYZ1` to the address on both devices to use a different room.
- Phone page for hand and arm tracking (experimental, no prop needed): `/posesend.html`.

### Try it without a phone (for judges)

Add `?debug=1` to any game address and open it in a desktop browser. The mouse acts as the controller (move to aim or reach, click to swing or shoot). This tests the game logic but **not** the camera tracking.

Example: `https://spatial-arcade.onrender.com/tennis?debug=1`

---

## How it works

```
Phone (camera)  --WebSocket-->  Relay server (Render)  --WebSocket-->  Fire TV (game page)
  tracks a prop                   pairs devices by                       draws the game and
  or a hand, sends                room code and passes                   reacts to the movement
  position + speed                messages along
```

- **Relay** (`server.js`, Node + `ws`): pairs a phone and a TV by room code and forwards messages. It also serves the game pages.
- **Phone side** (details for the light-gun controller are in [docs/PHONE_TRACKER.md](docs/PHONE_TRACKER.md)):
  - `/tracker/` finds the TV screen in the camera view and converts where you point into a position on the screen. It also sends trigger, reload and home buttons.
  - `/bat` follows a bright-colored prop by color (tap the prop on the phone screen to teach it the color).
  - `/posesend.html` follows a hand or arm.
- **Game side:** each game is a single HTML file drawn on a canvas. The bat games turn the phone's position stream into swings: speed decides power, and the path decides the type of move.
- **Weapon scan (Boulevard of Brawl):** the phone measures the outline of an object held up to the camera, and the game ranks its best guesses (bat, 2x4, golf club, whip, nunchucks) for the player to pick. The rules are hand-tuned, not a trained model, so guesses are sometimes wrong. The player always gets to correct them.
- **Look:** games draw small and are stretched up for a retro look. `?px=1` on a game address gives a chunkier look.

### Repository layout

```
server.js            relay + page server
package.json         dependencies (ws)
public/
  tv.html            Sky Delivery (light-gun game)
  golf.html          Driving Range
  brawl.html         Boulevard of Brawl
  duel.html          Boulevard Duel
  tennis.html        Rooftop Rally
  batsend.html       phone page for prop tracking (served at /bat)
  posesend.html      phone page for hand/arm tracking
  tracker/           phone page for the light gun (screen finding + trigger)
  camtest.html       checks the phone camera works
  qr.js              QR code generator used for pairing
  profiles.js        player profiles and saved records (shared by all games)
```

---

## Status: what works and what doesn't

Being straight about this, since a demo can hide problems.

**Tested on real hardware (my phone and Fire TV):** the relay and pairing, the light gun (Sky Delivery) end to end, and golf and the brawler (weapon mode) loading and responding on a Fire TV.

**Tested only in a simulated browser (not yet on real hardware):** the full-swing detection in golf, swing-direction recognition in the brawler, Boulevard Duel and Rooftop Rally (menus, rules, scoring, finishers and match flow, driven by scripted input). Real camera tracking of fast swings may behave differently.

**Known limits**
- Tracking depends on lighting. Direct sun, glare on the TV, or a dim room can make the phone lose the prop or the TV border.
- The light gun needs the phone to see all four edges of the TV from several feet away. The TV border can be cropped if the Fire TV overscan is not calibrated.
- The prop tracker follows one bright color. Pale wood, silver, and thin frames (like a racket) track poorly without bright tape.
- Weapon scan guesses can be wrong, and the whip is the hardest to recognize.
- The light gun responds more slowly than it did in my first tests. I have not found the cause.
- Hand and arm tracking (`/posesend.html`) has not been tested with two hands.
- Runs on a free server: it sleeps when idle, and it is shared by every user on the same room code.
- Phone aiming by hand is awkward. A gun-shaped shell with a trigger would feel much better (see below).

**Measured results:** I have not measured aim accuracy or response time with instruments. All speed and accuracy statements here come from playing it by hand.

---

## Why Fire TV could use this

Amazon already makes game controllers. What Fire TV doesn't have is a way to aim or swing in a game without extra hardware. A phone camera is a low-cost proof that the input works. A first-party shell, like a light gun or paddle that holds a phone, could make it feel like a real controller. I'm not claiming there's proven demand; this project shows the technique works and what the rough edges are.

## What's next (ideas, not promises)

- Gun-shaped shell with a trigger that holds the phone.
- A family-game layer on the same pairing: phones as hands or controllers for party games, with an AI player.
- A reusable script or small library so other developers can add phone input to a Fire TV web game with a few lines.
- A tablet or a second phone as the display.

---

## Built with

HTML, JavaScript and canvas for the games; Node.js with the `ws` library for the relay; hosted on Render (free tier); phone pages use the browser camera. The light-gun phone page was prototyped in Google AI Studio (React and Vite). I built this with heavy AI assistance (Claude) and have no formal programming background. All five games are original, and none use anyone else's characters, art or music.

## Credits and licenses

- `ws` (Node WebSocket library): MIT.
- `qr.js` (QR Code Generator for JavaScript, Kazuhiko Arase): MIT license. The header comment is kept in the file.
- MediaPipe Tasks Vision (Google), used by `/posesend.html` for hand and arm tracking, loaded from a CDN: Apache 2.0.
- Game art and sound: drawn in code; no outside assets.

Project license: the source is in a private repository shared with the hackathon judges for evaluation. Copyright (c) 2026 Josh Pearl. All rights reserved.

## About

Built by Josh Pearl, Saint Paul, Minnesota. Solo project.

Repository: private, shared with the judges for evaluation (see the Devpost submission for access)
Demo video: [paste link before submitting]







