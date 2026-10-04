# StayAlive

A local Minecraft Java client that keeps several accounts connected without running the game window. Keep your spot.

## Run

Install Node.js 22 or newer, then run:

```powershell
npm.cmd install
npm.cmd start
```

Open http://127.0.0.1:3180. Keep the terminal open while the bots are connected. Closing the browser tab leaves bots running; stopping the Node process disconnects them. `start.bat` opens the client for you on Windows.

## Finding your way around

The sidebar has six screens. Number keys `1` to `6` switch between them.

- **Play**: the home screen. The big button does the next useful thing for the account you control: join the server, finish a Microsoft sign-in or open gameplay.
- **Multiplayer**: your server list, with ping, players, version, message of the day and how many of your accounts are on each server.
- **Accounts**: every account with its status, server, position, route, ping, health and food.
- **Map**: a live top-down radar around the account you control.
- **Routes**: the route planner, a movement overview for all accounts, and idle behavior with anti-AFK.
- **Settings**: client preferences, keyboard shortcuts and status.

Two ideas run through every screen:

- **The controlled account** is the one shown in the top bar. Map, gameplay and the Play screen follow it. Click any account (or its head on the map) to control it.
- **The selection** is the set of ticked accounts. While anything is selected, a bar at the bottom of every screen joins, disconnects, moves or stops them together. Shift-click a checkbox to select a range. Commands without a selection apply to the controlled account.

The top bar also shows the active server, how many accounts are online, the client's memory use and the console (`` ` ``), which lists chat, joins, kicks and route errors.

## Accounts and servers

Click **Add account** and paste account labels or emails, one per line, or load a `.txt` file. These are labels for separate sessions, not credentials. Click **Sign in** on a Microsoft account, copy the code it shows and finish login on Microsoft's website with the matching Microsoft account. Each account needs a Minecraft Java profile. Cached sessions live in `data/tokens/`; don't share that folder.

In **Multiplayer**, add servers by hostname with an optional port (`play.example.net:25570`). Leave the version on auto-detect, or pick one supported by Mineflayer. Choose who joins (the controlled account, the selection or every offline account) and click **Join server**. That server becomes the active one: accounts join it, spaced out by the join delay. Accounts already on another server stay there until you disconnect them. **Direct connect** joins a server without saving it. The server list, waypoints and route plans are stored in this browser.

Reconnecting is optional and retries after 15 seconds, backing off to about two minutes. It does not bypass server account limits, authentication plugins or AFK checks. Servers requiring mods or mandatory resource packs may refuse these clients.

Offline usernames are also available for your own servers with `online-mode=false`. They cannot join an authenticated server as a paid account.

## Gameplay

Press **Open gameplay** (or `G`) for the controlled account. The 3D view opens full screen inside the client, or in its own window if you choose that in Settings. Click **Take control**. WASD moves, the mouse looks, Space jumps, Ctrl sprints, and Shift sneaks. Use 1 to 9 or the wheel to choose a hotbar slot. Left click digs or attacks, right click uses items, opens containers or places blocks. E opens inventory, and T opens chat (including server commands). The HUD shows health, food, coordinates, ping and frame rate.

Esc releases the mouse and resumes the saved route and anti-AFK settings. **Back to StayAlive** returns to the client. Closing or unfocusing the gameplay view also releases controls. Only one window can control an account at a time. Inventory and chat pause movement while open. Left/right click inventory slots to move items, or shift-click to transfer them.

The 3D view draws the account's loaded chunks with Minecraft textures, players with their own skins and nameplates, mobs, holograms and your hand or held item. While you control the player, the camera follows your mouse directly. **Render distance** in the pause menu sets how many chunks around you are shown (4 to 16); while gameplay is open the account asks the server for that many, and it goes back to two chunks when you leave. Worlds from 1.8 to 1.12 are converted to modern block states so stairs, slabs and colored blocks render correctly. Graphics run in the browser only while gameplay is open. It is a lightweight client, so vanilla screens, sounds, lighting and animations are not all reproduced. Skins are downloaded from Mojang's texture server, as the game does.

## Map and walking

The **Map** shows terrain from the controlled account's loaded chunks, refreshed every two seconds. Its head marks its position with a cone for its facing; your other accounts in the same world appear as heads too. Orange lines are saved routes, the dotted blue line is the path the pathfinder is following, the star is spawn and flags are your waypoints. Zoom with the buttons or the mouse wheel.

Click a surface to pick a destination; the panel shows its distance and travel time and sends the controlled account or the whole selection there. **Spread out** gives each selected account its own nearby block. Shift-click adds a point to the route plan, and right-click offers more actions. Destinations use the surface's standing height automatically.

**Surface** shows the highest terrain, including sky platforms. **Underground** hides terrain above the player, which is useful in caves and under roofs. Dark checkered areas have no loaded block data. A surface can still be unreachable if obstacles block the path.

In **Routes**, choose a movement mode and build a list of waypoints by clicking the map, adding the current position, pasting `X Y Z` lines or adding saved waypoints. Y is the block occupied by the player's feet, not the floor below it.

- **Stay AFK** stops movement.
- **Walk to** takes one waypoint and stops on arrival.
- **Patrol** needs at least two different waypoints and repeats them until you stop it.

Routes are saved per account and resume after a reconnect or respawn. Bots avoid breaking or placing blocks while following routes. They can walk off sky platforms and fall to lower waypoints; normal server fall damage still applies. An unreachable waypoint retries every 10 seconds; use nearby reachable waypoints to guide longer walks. Headless clients still receive chunks and simulate physics for pathfinding, so memory and CPU use grow with the number of accounts. AFK sessions run without rendering, textures or audio; opening gameplay adds a browser renderer. Server resource packs are not downloaded. A two-chunk view distance is requested, but the server controls how much it sends.

Settings and account labels are saved in `data/settings.json`. Restarting the app does not automatically join servers. The client binds to loopback only and rejects foreign origins. Removing an account deletes its cached Microsoft session.

## Idle behavior and anti-AFK

Under **Routes → Idle & anti-AFK**, set the facing direction (yaw and pitch in Minecraft degrees), the hotbar slot and whether to keep sneaking while idle. Quick actions trigger a jump, a brief sneak/stand gesture or an arm swing. Swinging does not attack entities or break blocks.

Anti-AFK repeats your selected actions every 5 to 3600 seconds. Options are jumping, sneaking/standing, swinging, turning the head and cycling hotbar slots. Settings survive a reconnect or respawn; timers stop when an account disconnects. **Disable anti-AFK** stops the repeating actions without changing the other settings.

While walking, the pathfinder controls rotation, jump and sneak. Only arm swings and hotbar cycling run alongside the route. Saved rotation and sneak settings resume when walking stops. Server AFK detection may still kick a connected client.

## Development

```powershell
npm.cmd run check
npm.cmd test
```

The client is plain ES modules in `public/js`, rendered with Preact and htm without a build step:

- `core/`: the store, API calls, live event stream and shared formatting.
- `ui/`: reusable pieces such as `McButton`, `GamePanel`, `PlayerHead`, `StatusBadge`, the pixel icons and the logo.
- `shell/`: the sidebar, top status bar, selection dock, console and gameplay overlay.
- `screens/` and `map/`: one module per screen, and the map renderer.
- `play/gameplay.js` with `css/gameplay.css`: the gameplay page (`public/play.html`) and its HUD.

Player heads are generated from the username, so no skins are downloaded. The pixel display face is built from the glyph art in `scripts/build-font.js`; run `npm.cmd run font` after changing it.

The clients use [Mineflayer](https://github.com/PrismarineJS/mineflayer), [Prismarine Auth](https://github.com/PrismarineJS/prismarine-auth) and [Mineflayer Pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder).
