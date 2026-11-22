# ANDI THE RAT SLAYER

One teacher. Five bosses. Zero patience.

Andi is a Chicago Public Schools teacher trying to get to first period. A rat, its extended family, and a deeply questionable research grant stand in her way. The residential alley and on-screen character design are fictional.

## Play and develop

Open [the game](../andi-the-rat-slayer.html) directly in a browser, or run `python3 -m http.server 8000` from the repository root and open `http://localhost:8000/andi-the-rat-slayer.html`. The checked-in HTML, CSS, classic scripts, font and poster are the production build. Play works offline from the downloaded files. HTTPS pages load Junkdrawer's shared Analytics Lite script. The game keeps checkpoint and preference data in memory for the current session.

| Action | Keyboard | Touch |
| --- | --- | --- |
| Walk or steer the car | WASD or arrows | Hold a direction |
| Enter car, release bin, operate panel, strike | E near the object | Act |
| Dodge | Space, optionally with movement | Dodge, optionally while holding a direction |
| Adjust camera distance | + or − | Settings → Camera distance |
| Pause or resume | P, Escape or Pause | Pause or Resume |
| Skip entrance or continue | Focus the button and press Enter | Tap the button |

Settings offers Story, Standard, and Rush hour difficulties. Story grants the longest warnings and the most patience. Each new encounter restores patience. Losing retries the current encounter. Sound can be toggled in the header.

## Campaign

1. **The Commuter** follows a learnable route along the bins. Get into the blue car, watch where the rat pauses, then steer across its path. Loose carts telegraph their landing zones.
2. **The Dumpster King** sends minions after Andi. Activate both cart releases to topple his court.
3. **Ratzilla** leaps toward Andi's marked position. Bait the stomp beside a bin, dodge, and activate the exposed gold weak point.
4. **Professor Ratington** defends three numbered panels with robotic projectiles. Enter the displayed panel sequence while avoiding the targeting rings.
5. **The Ratfather** loses his barricade, his powered suit, and finally his composure. Each phase changes the objective.

## Rendering and assets

`game.js` owns the simulation, collision, encounter state, audio and input. `render.js` draws the same game state with Three.js or a top-down Canvas 2D map when WebGL 2 context creation is unavailable. The 3D alley uses locally generated 1024-pixel road and brick textures with mipmaps, roughness and metalness materials, instanced architectural details, distance-dependent boss geometry, pooled debris, soft contact shadows and optional shadow maps. Low quality caps resolution at one device pixel per CSS pixel and switches off shadow maps.

The title poster is original AI-generated artwork compressed as JPEG. The animated characters and alley are stylized procedural models. All environment markings, score stings and ambience are generated locally. The campaign omits the optional Ratcam replay.

- Three.js 0.160.1 is distributed under the [MIT license](THREE-LICENSE.txt).
- Barlow Condensed Black is distributed under the [SIL Open Font License](FONT-LICENSE.txt).

## Checks and deployment

From the repository root, with its Playwright test dependency and Chrome installed:

```sh
npx playwright test tests/andi-the-rat-slayer.spec.js --reporter=line
bash .agents/skills/junkdrawer-compliance-audit/scripts/audit.sh andi-the-rat-slayer.html
```

The root entry is registered in `junk-drawer.json`. GitHub Pages serves the repository root on `main`. Follow the repository git-sync procedure before committing and pushing. Keep the entry page and this asset directory together.
