# stayalive

        A local dashboard for Minecraft Java accounts that stay connected without running the game window.

## Run

Install Node.js 22 or newer, then run:

```powershell
npm.cmd install
npm.cmd start
```

Open http://127.0.0.1:3180. Keep the terminal open while the bots are connected. Closing the browser tab leaves bots running; stopping the Node process disconnects them. `start.bat` opens the dashboard for you on Windows.

## Accounts and servers

Paste account labels or emails, one per line, or load a `.txt` file. These are labels for separate sessions, not credentials. Click **Sign in** on each account, copy its code, and finish login on Microsoft's website with the matching Microsoft account. Each account needs a Minecraft Java profile. Cached sessions live in `data/tokens/`; don't share that folder.

Enter the server hostname and port separately. Leave version empty to detect it automatically, or choose a version supported by Mineflayer. Select your accounts and click **Join selected**. Connections are spaced out using the join delay. Optional reconnect retries after 15 seconds and backs off to about two minutes. It does not bypass server account limits, authentication plugins or AFK checks. Servers requiring mods or mandatory resource packs may refuse these clients.

Offline usernames are also available for your own servers with `online-mode=false`. They cannot join an authenticated server as a paid account.

## Walking

Select accounts, choose a movement mode and enter integer coordinates, one `X Y Z` waypoint per line. Y is the block occupied by the player's feet, not the floor below it.

- **Stay AFK** stops movement.
- **Walk to a position** takes one waypoint and stops on arrival.
- **Keep walking a route** needs at least two different waypoints and repeats them until you stop it.

Routes are saved per account and resume after a reconnect or respawn. Bots avoid breaking or placing blocks. They can walk off sky platforms and fall to lower waypoints; normal server fall damage still applies. An unreachable waypoint retries every 10 seconds; use nearby reachable waypoints to guide longer walks. Headless clients still receive chunks and simulate physics for pathfinding, so memory and CPU use grow with the number of accounts. No renderer, textures, audio or resource pack downloads are used. A two-chunk view distance is requested, but the server controls how much it sends.

Settings and account labels are saved in `data/settings.json`. Restarting the app does not automatically join servers. The dashboard binds to loopback only and rejects foreign origins. Removing an account deletes its cached Microsoft session.

## Actions and anti-AFK

Select accounts to set yaw and pitch in Minecraft degrees, choose hotbar slots 1 to 9, or keep sneaking while idle. The buttons trigger a jump, a brief sneak/stand gesture, or an arm swing. Swinging does not attack entities or break blocks.

Anti-AFK repeats your selected actions every 5 to 3600 seconds. Options are jumping, sneaking/standing, swinging, turning the head and cycling hotbar slots. Settings survive a reconnect or respawn; timers stop when an account disconnects. Use **Disable anti-AFK** to stop the repeating actions without changing the other settings.

While walking, the pathfinder controls rotation, jump and sneak. Only arm swings and hotbar cycling run alongside the route. Saved rotation and sneak settings resume when walking stops. Server AFK detection may still kick a connected client.

## Checks

```powershell
npm.cmd run check
npm.cmd test
```

The clients use [Mineflayer](https://github.com/PrismarineJS/mineflayer), [Prismarine Auth](https://github.com/PrismarineJS/prismarine-auth) and [Mineflayer Pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder).
