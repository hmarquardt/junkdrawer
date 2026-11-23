# ANDI THE RAT SLAYER

One teacher. Five bosses. Zero patience.

Andi is a Chicago Public Schools teacher trying to get to first period. A rat, its extended family, and a deeply questionable research grant stand in her way. The fictionalized teacher is a slight woman in her early thirties with shoulder-length blonde hair, a rust cardigan, a staff lanyard, walking shoes and a book tote. The poster, 3D model and illustrated map sprite share those details.

## Play and develop

Open [the game](../andi-the-rat-slayer.html) directly in a browser, or run `python3 -m http.server 8000` from the repository root and open `http://localhost:8000/andi-the-rat-slayer.html`. The checked-in HTML, CSS, classic scripts, font and poster are the production build. Play works offline from the downloaded files. HTTPS pages load Junkdrawer's shared Analytics Lite script. The game keeps checkpoint and preference data in memory for the current session.

| Action | Keyboard | Touch |
| --- | --- | --- |
| Walk or steer the car | WASD or arrows | Slide or hold the direction pad |
| Enter car, release bin, operate panel, strike | E near the object | Enter car, Release, Activate or Strike |
| Extend or retract | F | Fork |
| Quick thrust | Tap J facing the target, or left-click the target in the alley | Tap Attack to auto-aim and extend |
| Charge | Hold J or the left mouse button until the chime, then release | Hold Attack until it fills, then release |
| Dodge | Space, optionally with movement | Dodge, optionally while holding a direction |
| Adjust camera distance | + or − | Settings → Camera distance |
| Pause or resume | P, Escape or Pause | Pause or Resume |
| Read the current mission (pauses combat) | ? or Help | ? Help |
| Begin fight or continue | Focus the button and press Enter | Tap the button |

Settings offers Story, Standard, and Rush hour difficulties. Story grants the longest warnings and the most patience. Each new encounter restores patience. Losing retries the current encounter. Sound can be toggled in the header.

## Mission guidance

Each encounter waits at its briefing until you choose **Begin Fight**. The Ratfather introduces each new phase as it begins. During play, the tracker shows progress, a direction relative to Andi, and the distance to the next objective. Follow the flagged cart-release levers and step inside a dashed interaction ring. The prompt switches to **Press E** or the name of the contextual touch button when the action is available. A check mark identifies a used control. The star marks a temporary weak point.

After roughly 15 seconds without progress, a hint appears between urgent prompts. After 30 seconds the objective marker gains a stronger outline. Approaching the target or completing a step resets the timer. Open **? Help** to reread the mission while combat is paused.

## The Fork of Fury

Four prongs. Zero patience. Andi finds her telescoping dinner fork in her school tote after the car encounter. A thrust can scatter minions or trip the Dumpster King’s cart levers from outside the hand-operated interaction radius. Against Ratzilla, the Mega Fork reaches farther during the short vulnerability window. The Conductive Fork can short an incoming bolt or activate Ratington’s panels in sequence. The Fork of Destiny delivers the finishing thrust. Each retry restores the appropriate equipment. A fork-assisted boss defeat earns the encounter award.

On phones the fight uses a safe-area-aware playfield above a two-thumb control deck. Hold a direction while attacking or dodging, move the thumb around the pad to steer diagonally, or let go to stop. Help pauses combat. Switching apps pauses active combat and clears held input. Menu and briefing text retain browser zoom. The mobile renderer adjusts its pixel density and shadow cost in response to sustained frame times.

## Campaign

1. **The Commuter** follows a learnable route along the bins. Get into the blue car, watch where the rat pauses, then steer across its path. Loose carts telegraph their landing zones.
2. **The Dumpster King** sends minions after Andi. Activate both cart releases to topple his court.
3. **Ratzilla** leaps toward Andi's marked position. Bait the stomp beside a bin, dodge, and activate the exposed gold weak point.
4. **Professor Ratington** defends three numbered panels with robotic projectiles. Enter the displayed panel sequence while avoiding the targeting rings.
5. **The Ratfather** loses his barricade, his powered suit, and finally his composure. Each phase changes the objective.

## Rendering and assets

`game.js` owns the simulation, collision, encounter state, audio and input. `mission.js` derives briefings, progress, and projected markers from the encounter state. `render.js` draws the same game state with Three.js or a top-down Canvas 2D map when WebGL 2 context creation is unavailable. The 3D alley uses locally generated 1024-pixel road and brick textures with mipmaps, roughness and metalness materials, instanced architectural details, distance-dependent boss geometry, pooled debris, soft contact shadows and optional shadow maps. Low quality caps resolution at one device pixel per CSS pixel and switches off shadow maps.

`fork.js` implements the shared attack state and target contact checks. `fork-art.js` draws the equipment close-up, illustrated map character and bounded screen-space impact animation. The title poster is original AI-generated artwork compressed as JPEG. The animated characters and alley are stylized procedural models. All environment markings, score stings and ambience are generated locally. The campaign omits the optional Ratcam replay.

- Three.js 0.160.1 is distributed under the [MIT license](THREE-LICENSE.txt).
- Barlow Condensed Black is distributed under the [SIL Open Font License](FONT-LICENSE.txt).

## Checks and deployment

From the repository root, with its Playwright test dependency, Chrome, and the matching Playwright WebKit browser installed:

```sh
npx playwright test tests/andi-the-rat-slayer.spec.js tests/andi-fork-mobile.spec.js --reporter=line
bash .agents/skills/junkdrawer-compliance-audit/scripts/audit.sh andi-the-rat-slayer.html
```

The root entry is registered in `junk-drawer.json`. GitHub Pages serves the repository root on `main`. Follow the repository git-sync procedure before committing and pushing. Keep the entry page and this asset directory together.
