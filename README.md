# Jersey Color Conflict Rules

This document is the IT handover guide for determining whether two jersey kits clash. It covers the high-level concept, the decision rules, and the JavaScript utilities you can reuse.

---

## 1. Evaluation Flow Overview
1. Convert the two hex codes into multiple color metrics (DeltaE, contrast, luminance difference, hue difference, saturation difference).
2. Dynamically adjust the DeltaE/contrast thresholds based on those metrics so that very similar hues or luminance levels require a larger gap before we consider them safe.
3. Diagnose each pair: check whether DeltaE is below the threshold, contrast is insufficient, hue/saturation are too close, or luminance is nearly identical.
4. Final rule: treat it as a conflict only when `DeltaE < dynamic threshold` **and** at least two supporting signals (contrast breach, hue & saturation both tight, luminance breach) are present.



## 2. Conflict Rules
1. **DeltaE breach**: compare your computed `deltaE` to the dynamic threshold above.
2. **Contrast breach**: compare `contrastRatio` to the dynamic contrast threshold.
3. **Hue / saturation breach**: set `hueBreach = hueDiff <= 25°`, `saturationBreach = saturationDiff <= 15`.
4. **Luminance breach**:
   - Start with `luminanceBreach = luminanceDiff < 0.2`.
   - Override to false if *any* of these protective conditions holds:  
     a) high-saturation split (`hueDiff < 12°` **and** `saturationDiff ≥ 60`)  
     b) hue separation (`hueDiff ≥ 28°`)  
     c) luminance protection (`luminanceDiff < 0.05` **and** `hueDiff ≥ 10°`)
5. **Supporting signals**: collect these booleans in an array `[contrastBreach, hueBreach && saturationBreach, luminanceBreach]` and count how many are true.
6. **Final decision**: the pair is a conflict only if `deltaEBreach` is true *and* supporting signals ≥ 2.

---

## 3. Example & Rules: Manual Walkthrough (Team1 `#ebeef0` vs Team2 `#00fffa`)

**`threshold.deltaE` defaults to 15, so any `deltaE > 15` means “no conflict.”** (A conflict can only occur if `deltaE` falls *below* the dynamic threshold.)

1. **Parse the colors**  
   - `#ebeef0` → RGB(235, 238, 240)  
   - `#00fffa` → RGB(0, 255, 250)

2. **Compute the metrics**  
   - LAB & DeltaE: convert RGB to LAB via `color-convert`, then use `delta-e` → `deltaE = 24.24`.  
   - Luminance:  
     - `#ebeef0` becomes `L1 ≈ 0.873`; `#00fffa` becomes `L2 ≈ 0.765` (the relative luminance of each color).  
     - `contrastRatio = (0.873 + 0.05) / (0.765 + 0.05) ≈ 1.08`. The `+0.05` term is WCAG’s constant offset to avoid dividing by zero when luminance is near zero.  
     - `luminanceDiff = |0.873 - 0.765| = 0.108`.  
   - HSL:  
     - `#ebeef0` hue ≈ 204°, saturation ≈ 15%; `#00fffa` hue ≈ 178°, saturation ≈ 100% (we now have hue H and saturation S).  
     - `hueDiff = min(|204 - 178|, 360 - |204 - 178|) = 26°` (shortest hue distance).  
     - `saturationDiff = |15 - 100| = 85` (difference in saturation).

3. **Dynamic DeltaE threshold (`threshold.deltaE`)**  
   Rules:  
   1. `hueDiff < 12° && saturationDiff ≥ 60` → +6  
   2. `luminanceDiff < 0.05 && hueDiff ≥ 10°` → +6  
   3. `luminanceDiff < 0.1` → if `hueDiff < 20°` add +10, else +6  
   4. `luminanceDiff < 0.25 && hueDiff < 28°` → +6  
   5. `luminanceDiff < 0.4` → +3  

   **In this example:**  
   - DeltaE: `luminanceDiff < 0.25` and `hueDiff < 28°` → +6; base threshold is 15 → `threshold.deltaE = 21`.  
   - Contrast: condition `hueDiff < 25°` fails (actual 26°), and there’s no large-distance relief, so `threshold.contrastRatio = 2.5`.

4. **Supporting-signal checks**  
   Rules:  
   1. Contrast threshold starts at 2.5:  
      - `hueDiff < 25° && saturationDiff < 15` → +0.5  
      - `hueDiff ≥ 35° && saturationDiff ≥ 40` → −0.7 (not below 1.5)  
   2. Hue & saturation: only when both `hueDiff <= 25` and `saturationDiff <= 15` are true do we count this signal.  
   3. Luminance: check `luminanceDiff < 0.2`. Force it to false if:  
      - high-saturation split (`hueDiff < 12° && saturationDiff ≥ 60`)  
      - hue separation (`hueDiff ≥ 28°`)  
      - luminance protection (`luminanceDiff < 0.05 && hueDiff ≥ 10°`)

   **In this example:**  
   - `deltaE = 24.24 < 21 ? false` → `deltaEBreach = false` (DeltaE exceeds the dynamic threshold).  
   - `contrastRatio = 1.08 < 2.5` → `contrastBreach = true`.  
   - `hueDiff = 26 <= 25 ? false` → `hueBreach = false`.  
   - `saturationDiff = 85 <= 15 ? false` → `saturationBreach = false`.  
   - `luminanceDiff = 0.108 < 0.2` → provisional true; `hueDiff = 26°` is not ≥ 28°, so none of the protection rules apply → `luminanceBreach = true`.

4.1 **Counting supporting signals**  
   Rules:  
   1. `contrastBreach`  
   2. `hueBreach && saturationBreach` (both must be true simultaneously)  
   3. `luminanceBreach`

   **In this example:**  
   - `contrastBreach = true`, `hueBreach && saturationBreach = false`, `luminanceBreach = true` → 2 supporting signals.

**Final decision**  
Rules:  
1. `deltaEBreach = false` → automatically no conflict.  
2. If `deltaEBreach = true`, then we must check supporting signals; only when the count ≥ 2 is it a conflict.

**In this example:**  
- Because `deltaEBreach = false`, the pair is **not** a conflict even though two supporting signals fired.

---

## 4. Reference Implementation
See `conflictDetect.js` for the production-ready functions.

---

## 5. Core Functions & Usage

IT only needs to import `conflictDetect.js` to reuse the logic.

### 6.1 Quick Start (IT must call `analyzeColors`)
```js
import { analyzeColors } from "./conflictDetect.js";

const payload = {
  team1: { homekit: "#ebeef0", awaykit: "#7f7f7f", thirdkit: "#f3c7c7" },
  team2: { homekit: "#e4e4d9", awaykit: "#00fffa", thirdkit: "#c52a2a" },
};

const summary = analyzeColors(payload);

if (summary.status === "ok") {
  console.log("Usable kits:", summary.team1KitUsed, summary.team2KitUsed);
  // IT rule: schedule kits exactly as summary.team1KitUsed / summary.team2KitUsed
} else if (summary.status === "conflict") {
  console.log("Still clashing — show no kit and review checks:", summary.checks);
} else {
  console.error(summary.error);
}
```

### 6.2 IT Operating Guidelines
1. **Kit decision**  
   - If `summary.status === "ok"`, *immediately* use `summary.team1KitUsed` and `summary.team2KitUsed` (value is always `homekit`, `awaykit`, or `thirdkit`) for that match.  
   - If `summary.status === "conflict"` or `summary` is null/undefined, **do not** display any kit for the match.
2. **Color source**  
   - Feed the `base` color from the Competitor Profile API into each `homekit` / `awaykit` / `thirdkit` field for both teams.  
   - Example: `team1: { homekit: "#ebeef0", awaykit: "#7f7f7f" }` means those are exactly the base colors returned by the API; team2 follows the same rule.

---

### 6.3 Recommended Input JSON
```jsonc
{
  "team1": {
    "homekit": "#112233",        // Team 1 home base
    "awaykit": "#445566",        // Team 1 away base
    "thirdkit": "#778899"        // Team 1 third base
  },
  "team2": {
    "homekit": "#aa0000",        // Team 2 home base
    "awaykit": "#bb2222",        // Team 2 away base
    "thirdkit": "#cc4444"        // Team 2 third base
  },
  "deltaE_threshold": 15,        // optional, default 15
  "contrast_threshold": 2.5      // optional, default 2.5
}
```

Notes:
- `team1.homekit` and `team2.homekit` must be six-digit hex strings (optional `#`).
- `awaykit` / `thirdkit` reflect priority order: the system tests `team2.homekit → team2.awaykit → team2.thirdkit`, then falls back to team1 alternates if needed.
- Threshold overrides are for testing; notify the design/standards owner before changing them.
- **Color-source requirement**: always pass the Competitor Profile API’s kit `base` colors into these fields.

### 6.4 Successful Response Shape (`analyzeColors`)
```json
{
  "status": "ok",
  "message": "Found a non-conflicting combination",
  "team1Color": "#112233",
  "team2Color": "#bb2222",
  "team1KitUsed": "homekit",
  "team2KitUsed": "awaykit",
  "deltaE": 21.37,
  "contrastRatio": 2.88,
  "hueDifference": 34.21,
  "saturationDifference": 18.45,
  "luminanceDifference": 0.256,
  "dynamicThresholds": {
    "deltaE": 18.00,
    "contrastRatio": 2.50
  },
  "rule": "Team2 kit selection avoided clashes",
  "diagnostics": {
    "deltaEBreach": false,
    "contrastBreach": false,
    "hueBreach": false,
    "saturationBreach": false,
    "luminanceBreach": false,
    "supportingSignals": 0
  },
  "checks": [
    {
      "stage": "team1-homekit",
      "base": { "label": "team1", "kit": "homekit", "color": "#112233" },
      "compare": { "label": "team2", "kit": "homekit", "color": "#aa0000" },
      "conflict": true,
      "metrics": { "...": "omitted" },
      "thresholds": { "...": "omitted" },
      "diagnostics": { "...": "omitted" }
    },
    {
      "stage": "team1-homekit",
      "base": { "label": "team1", "kit": "homekit", "color": "#112233" },
      "compare": { "label": "team2", "kit": "awaykit", "color": "#bb2222" },
      "conflict": false,
      "metrics": { "...": "omitted" },
      "thresholds": { "...": "omitted" },
      "diagnostics": { "...": "omitted" }
    }
  ]
}
```

Key fields:
- Advanced users calling `findNonConflictingColors` receive `{ result, metricsLog }`; `result` matches the block above but lacks `status/message`.
- `team1Color` / `team2Color`: final recommended colors.
- `team1KitUsed` / `team2KitUsed`: chosen kits (`homekit`, `awaykit`, `thirdkit`).
- `checks`: detailed log of every attempt for debugging/audits.
- `diagnostics`: which rules triggered (contrast, hue/saturation, luminance).
- `checks[].base.kit` / `checks[].compare.kit`: explicitly records which kit combo was evaluated.

If every combination clashes, `status` becomes `"conflict"` (or `result` is `null` when using `findNonConflictingColors`), and `checks` still lists all attempts for troubleshooting.

---

## 7. Examples

### 7.1 Light Gray vs. Neon Cyan
```json
{
  "team1": { "homekit": "#ebeef0" },
  "team2": { "homekit": "#e4e4d9", "awaykit": "#00fffa" }
}
```
`team1-homekit` vs `team2-awaykit (#00fffa)`: `deltaE = 24.24`, `contrast = 1.08`, `hueDiff = 25°`.  
Dynamic DeltaE threshold drops to 21 (`deltaEBreach = false`). Contrast is low but has only one supporting signal → **no conflict**, `team2KitUsed = awaykit`.

### 7.2 Dark Green vs. Neon Green
```json
{
  "team1": { "homekit": "#586a58" },
  "team2": { "homekit": "#648b7d", "awaykit": "#238113" }
}
```
`team1-homekit` vs `team2-homekit`: `deltaE = 13.49`, `contrast = 1.53`, `luminanceDiff = 0.096`.  
Boosted DeltaE threshold is 21, so this pairing **conflicts**.  
`team1-homekit` vs `team2-awaykit (#238113)`: high saturation gap (65) and slight hue diff (9°) suppress the luminance signal, leaving only contrast → **no conflict**, `team2KitUsed = awaykit`.

### 7.3 All Combinations Clash
```json
{
  "team1": { "homekit": "#1a1a1a", "awaykit": "#2a2a2a" },
  "team2": { "homekit": "#151515", "awaykit": "#202020" }
}
```
`team1-homekit` vs `team2-homekit`: luminance diff 0.01, `deltaE = 4.12`, multiple supporting signals → **conflict**.  
Switching `team2.awaykit` only nudges luminance (`deltaE = 5.35`) → still **conflict**.  
Trying team1’s away kit doesn’t help, so the final response is:
```json
{
  "status": "conflict",
  "message": "All combinations still clash. Please review or adjust colors",
  "checks": [
    { "stage": "team1-homekit", "base": { "kit": "homekit", "color": "#1a1a1a" }, "compare": { "kit": "homekit", "color": "#151515" }, "conflict": true },
    { "stage": "team1-homekit", "base": { "kit": "homekit", "color": "#1a1a1a" }, "compare": { "kit": "awaykit", "color": "#202020" }, "conflict": true },
    { "stage": "team1-alternate", "base": { "kit": "awaykit", "color": "#2a2a2a" }, "compare": { "kit": "homekit", "color": "#151515" }, "conflict": true },
    { "stage": "team1-alternate", "base": { "kit": "awaykit", "color": "#2a2a2a" }, "compare": { "kit": "awaykit", "color": "#202020" }, "conflict": true }
  ]
}
```
