# ANDI THE RAT SLAYER

Chicago After Dark · The rats were just the beginning.

Andi is a Chicago Public Schools teacher trying to get to first period. A rat, its extended family, and a deeply questionable research grant stand in her way. The fictionalized teacher is a slight woman in her early thirties with shoulder-length blonde hair, a rust cardigan, a staff lanyard, walking shoes and a book tote. The poster, 3D model and illustrated map sprite share those details.

## Play and develop

Open [the game](../andi-the-rat-slayer.html) directly in a browser, or run `python3 -m http.server 8000` from the repository root and open `http://localhost:8000/andi-the-rat-slayer.html`. The checked-in HTML, CSS, classic scripts, font and poster are the production build. Play works offline from the downloaded files. HTTPS pages load Junkdrawer's shared Analytics Lite script. The game saves locally at encounter entrances, victories, permanent rewards and settings changes.

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

Four prongs. Zero patience. Andi finds her telescoping dinner fork in her school tote after the car encounter. A thrust can scatter minions or trip the Dumpster King’s cart levers from outside the hand-operated interaction radius. Against Ratzilla, the Mega Fork reaches farther while Ratzilla is stunned. The Conductive Fork can short an incoming bolt or activate Ratington’s panels in sequence. The Fork of Destiny delivers the finishing thrust. Each retry restores the appropriate equipment. A fork-assisted boss defeat earns the encounter award.

On phones the fight uses a safe-area-aware playfield above a two-thumb control deck. Hold a direction while attacking or dodging, move the thumb around the pad to steer diagonally, or let go to stop. Help pauses combat. Switching apps pauses active combat and clears held input. Menu and briefing text retain browser zoom. The mobile renderer adjusts its pixel density and shadow cost in response to sustained frame times.

## Campaign

1. **The Commuter** follows a learnable route along the bins. Get into the blue car, watch where the rat pauses, then steer across its path. Loose carts telegraph their landing zones.
2. **The Dumpster King** sends minions after Andi. Activate both cart releases to topple his court.
3. **Ratzilla** targets the marked dumpster when Andi enters its ring. Step out or dodge at impact, then follow the gold star and strike. Repeat at the second marked dumpster. On Story the opening lasts until a successful hit. Standard gives nine seconds and Rush Hour gives six.
4. **Professor Ratington** defends three numbered panels with robotic projectiles. Enter the displayed panel sequence while avoiding the targeting rings.
5. **The Ratfather** loses his barricade, his powered suit, and finally his composure. Each phase changes the objective.

6. **The Stinkfather** fills the alley with expanding odor clouds. Release a charged Windmill Fork to scatter nearby clouds, turn on the ventilation fan, then strike the disoriented skunk.
7. **Trash Panda Supreme** steals the fork and ducks between bins while spring lids and flying lunchboxes disrupt the search. Recover the fork by hand, then use magnetism to repossess his getaway wagon.
8. **The Possum of Doom** fakes his own defeat and slips backstage. Follow the fork detector and seal all three escape routes. Checking a cardboard prop gives a clue.
9. **The Midnight Menagerie** builds a fog-powered contraption. Charge and release near its intake, recover the brake and open the catwalk. The cats take it from there.

Sir Chonkington offers nine seconds of protection, Madame Meatball restores two patience, and the Honorable Biscuit adds two metres of reach for fifteen seconds. Greet a nearby cat with E or the contextual button. Cats can ignore a greeting. Each night encounter has one collectible treat, saved when collected. A treat guarantees the next blessing. Cats never enter weapon or hazard hit lists.

## Saves, replay and returning players

**Continue campaign** starts at the latest campaign entrance with full patience. **New Game** starts from the first encounter while keeping earlier unlocks. **Level select** replays any unlocked encounter. Replaying can improve a best time without moving the campaign checkpoint backwards. The title screen offers a confirmed reset. Players who finished the original campaign before saves existed can choose **Played before saves?** once to unlock Chapter 2. This leaves their historical times and achievements unrecorded.

The bounded `andi.campaign` localStorage record holds a schema version, unlocked levels, checkpoint and chapter, best active-play time for each encounter, collectible flags, treats, permanent fork upgrades, achievements and preferences. Live attacks and temporary cat bonuses reset at the entrance. Progress belongs to this browser profile and device. Clearing site storage removes it. When storage is blocked or full the game keeps playing and shows a session-only warning. A future schema is preserved until the player explicitly resets.

## Rendering and assets

`game.js` owns the simulation, collision, encounter state, audio and input. `mission.js` derives briefings, progress, and projected markers from the encounter state. `render.js` draws the same game state with Three.js or a top-down Canvas 2D map when WebGL 2 context creation is unavailable. The 3D alley uses locally generated 1024-pixel road and brick textures with mipmaps, roughness and metalness materials, instanced architectural details, distance-dependent boss geometry, pooled debris, soft contact shadows and optional shadow maps. Low quality caps resolution at one device pixel per CSS pixel and switches off shadow maps.

`fork.js` implements the shared attack state and target contact checks. `fork-art.js` draws the equipment close-up, illustrated map character and bounded screen-space impact animation. `after-dark.js` runs the wildlife encounters and cat interactions. `wildlife-art.js` draws original animal and prop illustrations into shared Canvas tiles for the 3D alley and fallback map. `campaign.js` owns the save record and campaign menu. The title poster is original AI-generated artwork compressed as JPEG. The animated characters and alley are stylized procedural models. All environment markings, score stings and ambience are generated locally. The campaign omits the optional Ratcam replay.

- Three.js 0.160.1 is distributed under the [MIT license](THREE-LICENSE.txt).
- Barlow Condensed Black is distributed under the [SIL Open Font License](FONT-LICENSE.txt).

## Checks and deployment

From the repository root, with its Playwright test dependency, Chrome, and the matching Playwright WebKit browser installed:

```sh
npx playwright test tests/andi-the-rat-slayer.spec.js tests/andi-fork-mobile.spec.js tests/andi-after-dark.spec.js tests/storage-manager.spec.js --reporter=line
bash .agents/skills/junkdrawer-compliance-audit/scripts/audit.sh andi-the-rat-slayer.html
```

After Pages has built the release, run the two touch-only campaigns through the public landing page and check Continue after reloading:

```sh
ANDI_VERIFY_PAGES=1 npx playwright test tests/andi-fork-mobile.spec.js -g "touch-only campaign" --workers=1
```

The root entry is registered in `junk-drawer.json`. GitHub Pages serves the repository root on `main`. Follow the repository git-sync procedure before committing and pushing. Keep the entry page and this asset directory together.
