# STRIKELINE — LAN third-person tactical shooter

A round-based, team-vs-team third-person shooter that runs in the browser. One PC hosts the server, and everyone on the same Wi-Fi joins by opening a link. Nobody else needs to install anything.

## Setting up on another computer

You only need **[Node.js](https://nodejs.org) 18 or newer** (the LTS version is fine). Then:

```
git clone <your repo url>
cd <folder>
npm install
npm start
```

On Windows you can just double-click **`start.bat`**. It runs `npm install` the first time by itself.

- `node_modules` isn't in the repo. `npm install` downloads it (about 30 MB, two packages: three.js and ws).
- All models, textures and the sky are in the repo (about 45 MB), so nothing else needs downloading.
- Blender and Python are only needed if you want to **rebuild** the weapons or props with the scripts in `tools/`. You don't need them to play.
- The players' computers only need a browser. They open the host's address, so they don't need to clone anything.

## Start a game

1. Double-click **`start.bat`**, or run `npm start` in this folder.
2. The window shows addresses like `http://192.168.x.x:3000`.
3. On the host PC, open `http://localhost:3000`.
4. On other PCs or laptops on the **same Wi-Fi**, open the `http://192.168.x.x:3000` address in Chrome or Edge.
5. The first time, Windows asks whether Node.js may use the network. Tick **Private networks** and click **Allow**. If you skip this, the other devices cannot connect.

## Waiting room and host settings

- **Joining:** enter your name and click **Join Room**. You land in the **waiting room**, which shows everyone (and the bots) by team. Anyone can switch teams there.
- **Host:** the first player to join is the **host** (★). Only the host can change the **map, mode, bots, bot skill** and the **rules**:
  - **Wall jump:** on or off.
  - **Dash (Q):** on or off.
- **Starting:** the host presses **Start Match**. When the match ends, everyone goes back to the waiting room. The host can also end a match early with **End match** in the pause menu (Esc).
- **Late joining:** players can still join a match that's already running, as long as the room isn't full. They join straight into the game (spawning in warmup, or spectating until the next round).
- **Room size:** 10 players (bots don't count). Change it with `MAX_PLAYERS=12 npm start`.
- **New host:** if the host leaves, the next player becomes host.

## Movement tricks

- **Bunny hop:** hold Space, or press it just before you land. Landing friction never touches you, so your speed carries over.
- **Air strafe:** in the air, hold **A** while turning the mouse **left** (or **D** while turning **right**). Each hop adds speed, up to 13 m/s. Dash can still burst past that.
- **Crouch jump:** jump, then crouch at the top. Your legs tuck up 0.55 m, so you clear higher ledges.
- **Hands-off in the air:** if you let go of every movement key mid-air, you slowly drift to a stop. That's how you land on a roof after a wall jump.
- **Browser shortcuts:** while you play, game keys never reach the browser, so Ctrl+D (bookmark) is blocked. Browsers don't let a page block **Ctrl+W** (close tab) outside fullscreen, so if you crouch while pressing W, crouch with **C** instead of Ctrl.

`node tools/test_bhop.mjs` checks bunny hop, air strafing and crouch jumps.

## If the game is laggy

Press **F3** in game to show FPS. If it says `SOFTWARE GL`, or the lobby shows a red "not using your graphics card" box, the browser is drawing on the CPU instead of the GPU, which makes it very slow:

1. Open Chrome or Edge **Settings → System**.
2. Turn on **Use graphics acceleration when available**.
3. Click **Relaunch**.

If it is already on, open `chrome://gpu`. If WebGL says "Software only", update your Intel/NVIDIA graphics driver.

The game also lowers its resolution automatically when the frame rate drops. Choosing **Graphics: Low** in the lobby helps on weak laptops.

## Maps

The host picks the map in the waiting room, or presses **N** in game (which restarts the match).

- **Dustline Yard:** the classic tactical layout, with A and B sites, lanes and a hut.
- **Updraft:** a vertical parkour arena built for **wall jumps and dashes**. Every **orange wall** is meant for wall-jumping.
  - **Chimneys:** 2 m slots in the corner towers (6 m), the center tower (7 m) and the fins under the high middle platform. Bounce wall to wall to climb them.
  - **Rooftop bridges:** the first gap is a normal jump, the second one **needs a dash**. One more jump and dash takes you to the high middle platform.
  - **Wall-jump alley:** two tall fins with walkways on top, running along the outer wall.
  - **Jump staircase:** 1 m steps up each corner tower, for players who don't wall jump.
  - The map is mirrored, so both teams get identical routes.

- **Pinnacle:** about 3× the height of Updraft. Corner towers rise in three stages to **18 m**, and a center spire peaks at **20 m**.
  - **Stacked chimneys:** every stage has its own 2 m chimney opening onto a ledge, so you climb 6 m at a time.
  - **Jump pads:** glowing cyan pads throw you up a whole stage. One launches you from the ground straight onto the 12 m sky course.
  - **Sky course (12 m):** floating platforms from each tower to the spire. Most gaps need a dash.
  - **Tall walls:**
    - The **spine chimney** behind each tower climbs all 18 m in one go.
    - The **sky alley** is two 18 m fins with a **ridge walkway** on top along the outer wall, a dash away from the tower top.
    - **Monoliths** are 9–10 m concrete walls that give ground players cover from people up high.
  - **Middle walls** around the spire:
    - The **mid-gate chimney** is two 12 m walls with a walkway that bridges onto the spire's 12 m stage.
    - **20 m lane blockers** cross the center lane, and **16 m inner monoliths** stand beside the sky course.
    - Both are orange climbing walls.
  - **Single-wall climbing:** spam wall jump, then press **Q** to dash back into the wall, and repeat. This climbs any wall, including the 20 m ones.

- **Trenchline:** a compact arena built for **Grenades Only**.
  - **Berms and trenches:** chest-high earth berms (1.4 m) cut by trenches. Jump up to get a view, drop into a trench to hide. Grenades still bounce and roll in after you.
  - **Center bunker:** a roofed bunker with slit windows (a grenade can go through a slit) and doors facing each team.
  - **Bank-shot walls:** walls in the courtyard for bouncing grenades around corners.

Bots walk the ground floor on every map (they don't wall jump), so the rooftops are your advantage.

`node tools/test_updraft.mjs`, `node tools/test_pinnacle.mjs` and `node tools/test_trenchline.mjs` check every route with the real movement physics. `tools/parkour-rig.mjs` is a scripted player you can reuse to test your own maps.

## Modes and weapons

The host picks the mode in the waiting room, or presses **M** in game (which restarts the match).

| Mode | Weapons (keys 1–4 / mouse wheel) |
|---|---|
| **Standard** | Vanguard AR, Longbow SR (sniper), Sidewinder P9 (pistol), knife |
| **AR Only** | Vanguard AR, knife |
| **Snipers Only** | Longbow SR, knife |
| **Knife Only** | knife |
| **Grenades Only** | frag grenades (unlimited) |

- **Longbow SR (sniper):** bolt action, 5 rounds. A hit to the head or body kills in one shot, and so does a leg shot (120 damage). Right click to look through the scope. It's very inaccurate unscoped or on the move, and you move a bit slower carrying it.
- **Knife:** left click to slash (50 damage), right click for a heavy stab (100). Hits from behind do 1.5×. You run 15% faster holding it.

- **Frag grenade:** left click throws, right click lobs short. It bounces and rolls, then explodes after 1.6 s.
  - Blast damage is 120 at the center, falling to 0 at 6 m, and walls block it.
  - Your own grenades do half damage to you, and there's no team damage.
  - **Explosions knock players back**, so a grenade at your feet launches you about 3.5 m up (grenade-jumping).

Bots follow the mode. In Standard about a quarter of them carry a sniper. In Knife Only they chase you down and stab. In Grenades Only they calculate lobs with the real grenade physics, including blind throws over cover at where they last saw you.

## Practice bots

The host picks **Practice bots: 1 / 3 / 5** and a skill level (Easy, Normal or Hard) in the waiting room, or presses **B** in game to change how many bots there are. Bots fill whichever team has fewer players, so even alone you get full rounds.

Bots find their way around the map and only shoot what they can actually see, so smoke blocks them. They react after a short delay and miss more at long range. They go to the sites, hold angles, turn toward gunfire and hunt down the last players late in a round.

## How a match works

- **Warmup:** while only one team has players, you respawn 3 seconds after dying.
- When **both teams have at least one player**, rounds start:
  - **Prep (6 s):** you can look around but not move.
  - **Live (100 s):** wipe out the other team to win the round. If time runs out, Defenders win.
  - First team to **7 rounds** wins the match. A new match then starts.
- If you join mid-round, you spectate until the next round.

## Controls

| Key | Action |
|---|---|
| WASD | Move |
| Mouse | Look |
| Left click | Shoot |
| Right click | Aim down sights (zoom, tighter spread, walk speed) |
| Shift | Walk (no footstep sound, more accurate) |
| Ctrl / C | Crouch. Crouch in the air to tuck your legs up (**crouch jump**: clears about 2 m ledges instead of 1.5 m) |
| Space | Jump. **Hold to bunny hop**: you jump again the instant you land, so you keep your speed. In the air, press again against a wall to **wall-jump** |
| A/D + mouse | **Air strafe**: while hopping, hold A and turn left (or D and turn right) to build speed, up to 13 m/s |
| Q | **Dash** in the direction you're moving (unlimited, works in the air) |
| R | Reload |
| 1–4 / mouse wheel | Switch weapon (depends on mode) |
| M | Change mode |
| N | Change map |
| E | Throw smoke (2 per round) |
| V | Swap camera shoulder |
| Tab | Scoreboard |
| T | Switch team |
| B | Change number of bots |
| F3 | FPS / performance meter |

Damage works like a tactical shooter. A rifle headshot (140) kills in one hit. A body shot does 38 and a leg shot 32. Accuracy is best when you stand still, crouch or aim. Running footsteps can be heard by enemies.

## Project layout

```
server.js              Node server: serves the game files and runs the match (WebSockets)
bots.js                Practice bots: pathfinding, vision, aiming
public/index.html      Page, lobby and HUD
public/js/shared.js    Map layout, weapons and ray tests (used by server AND client)
public/js/main.js      Client: networking, HUD, minimap, game loop
public/js/player.js    Local movement, collision, camera, shooting
public/js/character.js Animated soldier, aiming, arm/leg IK
public/js/world.js     Builds the map: PBR textures, HDRI sky, shadows, props
public/js/fx.js        Tracers, muzzle flash, impacts, bullet holes, smoke
public/js/audio.js     Synthesised gun and footstep sounds (no audio files)
tools/make_weapons.py  Blender script that models the rifle and pistol
tools/optimize_props.py Blender script that makes low-poly game versions of the props
tools/test_movement.mjs Headless test for dash and wall jump (node tools/test_movement.mjs)
```

## Editing the map

The whole map is defined in `public/js/shared.js` → `MAP`.
- `boxes`: walls and platforms, written as `[x, bottomY, z, width, height, depth, material]`. The material is `wall`, `brick` or `floor`.
- `props`: downloaded 3D models, written as `[model, x, y, z, rotationDeg, scale]`.
- `spawns`: spawn points for each team.

Restart the server after you edit the map.

## Rebuilding the guns in Blender

```
"C:\Program Files\Blender Foundation\Blender 5.3\blender.exe" -b -P tools/make_weapons.py
```

You can also open the exported `public/assets/models/rifle.glb` in Blender, change it, and export it again as glTF Binary. Keep the empty named `Muzzle`.

## Adding your own 3D models

Download a model (glTF) into `public/assets/models/<name>/`, then add its size to `PROP_DIMS` and place it in `MAP.props` in `shared.js`. Add it to `BUDGET` in `tools/optimize_props.py` and run:

```
"C:\Program Files\Blender Foundation\Blender 5.3\blender.exe" -b -P tools/optimize_props.py
```

Scanned models are often 50k+ triangles. That is fine for renders but far too heavy for a game, and it was the main cause of lag before this script existed.

## Asset credits

- Props, textures and sky HDRI: [Poly Haven](https://polyhaven.com) (CC0)
  - Models: barrel_03, concrete_road_barrier, wooden_crate_02, wooden_military_crate, utility_box_01
  - Textures: asphalt_02, concrete_block_wall, brick_wall_02, brushed_concrete
  - HDRI: kloofendal_48d_partly_cloudy_puresky
- Soldier character and animations: `Soldier.glb` from the three.js examples (Mixamo character)
- Rifle and pistol: modelled with the Blender script in `tools/`
- Engine: [three.js](https://threejs.org) (MIT), [ws](https://github.com/websockets/ws) (MIT)
