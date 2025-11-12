# Jersey Color Conflict Rules

本文件是給 IT 參考的交接說明，僅聚焦於「色彩是否衝突」的判斷方式。內容包含：概念流程、判斷方法，以及實際使用中的 JavaScript 函式。

---

## 1. 判斷流程概覽
1. 將兩個色碼轉成多種色彩指標（DeltaE、對比、亮度差、色相差、飽和差）。
2. 根據指標動態調整 DeltaE 與對比的門檻，使得「亮度很接近」或「色相極相似」的組合需要更高差異才不算衝突。
3. 進行診斷：檢查 DeltaE 是否低於門檻，對比是否不足，色相/飽和是否過近，亮度是否過近。
4. 最終條件：必須同時滿足 `DeltaE 低於門檻` 且 `支援訊號 >= 2` 才算衝突；其中支援訊號來自對比不足、(色相 && 飽和) 同時接近、亮度過近。

---

## 2. 指標與方法

| 指標 | 計算方式 |
| --- | --- |
| `deltaE` | 使用 DeltaE00（LAB 色差）衡量顏色距離。 |
| `contrastRatio` | 依 WCAG 公式，以相對亮度計算的對比。 |
| `luminanceDiff` | 兩色之亮度差（0–1）。 |
| `hueDiff` | RGB→HSL Hue 的最短圓距離（0–180°）。 |
| `saturationDiff` | RGB→HSL Saturation 差距（0–100）。 |

以上指標為後續動態門檻與判斷的基礎。

---

## 3. 動態門檻規則

### DeltaE 門檻調整
- **高飽和度分裂**：若 `hueDiff < 12°` 且 `saturationDiff ≥ 60`，亮度 boost 固定 +6。
- **亮度極接近但 hue ≥ 10°**：`luminanceDiff < 0.05` 且 `hueDiff ≥ 10°` 時，設定 boost = 6。
- **一般亮度條件**：
  - `luminanceDiff < 0.1`：在非特殊情況下，`hueDiff < 20°` 加 +10，否則 +6。
  - `luminanceDiff < 0.25` 且 `hueDiff < 28°`：+6。
  - `luminanceDiff < 0.4`：+3。
- 最終 DeltaE 門檻 = `deltaE_threshold（預設 15） + boost`。

### Contrast 門檻調整
- `hueDiff < 25°` 且 `saturationDiff < 15` → 對比門檻 +0.5。
- `hueDiff ≥ 35°` 且 `saturationDiff ≥ 40` → 對比門檻 −0.7（但最低不低於 1.5）。

---

## 4. 衝突判斷原則
1. **DeltaE 觸犯 (deltaEBreach)**：`deltaE < 動態 DeltaE 門檻`。
2. **對比觸犯 (contrastBreach)**：`contrastRatio < 動態對比門檻`。
3. **色相/飽和觸犯 (hueBreach, saturationBreach)**：`hueDiff <= 25°`、`saturationDiff <= 15`。
4. **亮度觸犯 (luminanceBreach)**：
   - `luminanceDiff < 0.2`，但若符合以下任一條件則不計：  
     a) 高飽和度分裂 (`hueDiff < 12°` 且 `saturationDiff ≥ 60`)  
     b) 色相分離 (`hueDiff ≥ 28°`)  
     c) 亮度保護 (`luminanceDiff < 0.05` 且 `hueDiff ≥ 10°`)
5. **支援訊號 (supportingSignals)**：計數 `contrastBreach`、`hueBreach && saturationBreach`、`luminanceBreach` 為 true 的個數。
6. **最終判定**：`deltaEBreach && supportingSignals >= 2` → 視為衝突；反之通過。

---

## 5. 參考實作（JavaScript）
以下程式碼節錄自 `index.mjs`，IT 可直接複製使用。

```js
import DeltaE from "delta-e";
import convert from "color-convert";

const HUE_SIMILARITY_DEG = 25;
const SATURATION_SIMILARITY = 15;

function rgbToLab(rgb) {
  const lab = convert.rgb.lab(rgb);
  return { L: lab[0], A: lab[1], B: lab[2] };
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function hueDifference(h1 = 0, h2 = 0) {
  const hue1 = Number.isFinite(h1) ? h1 : 0;
  const hue2 = Number.isFinite(h2) ? h2 : 0;
  const diff = Math.abs(hue1 - hue2);
  return Math.min(diff, 360 - diff);
}

function computeColorMetrics(hex1, hex2) {
  const rgb1 = convert.hex.rgb(hex1);
  const rgb2 = convert.hex.rgb(hex2);
  const lab1 = rgbToLab(rgb1);
  const lab2 = rgbToLab(rgb2);

  const deltaEValue = DeltaE.getDeltaE00(lab1, lab2);
  const L1 = luminance(rgb1);
  const L2 = luminance(rgb2);
  const contrastRatioValue = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  const luminanceDiff = Math.abs(L1 - L2);

  const hsl1 = convert.rgb.hsl(rgb1);
  const hsl2 = convert.rgb.hsl(rgb2);
  const hueDiff = hueDifference(hsl1?.[0], hsl2?.[0]);
  const saturationDiff = Math.abs((hsl1?.[1] ?? 0) - (hsl2?.[1] ?? 0));

  return {
    deltaE: deltaEValue,
    contrastRatio: contrastRatioValue,
    luminanceDiff,
    hueDiff,
    saturationDiff,
  };
}

function deriveDynamicThresholds(deltaE_threshold, contrast_threshold, metrics) {
  const highSatHueSplit = metrics.hueDiff < 12 && metrics.saturationDiff >= 60;
  const hueSeparated = metrics.hueDiff >= 28;
  let deltaBoost = 0;
  if (metrics.luminanceDiff < 0.05 && metrics.hueDiff >= 10) {
    deltaBoost = 6;
  } else if (metrics.luminanceDiff < 0.1) {
    if (highSatHueSplit) {
      deltaBoost = 6;
    } else {
      deltaBoost = metrics.hueDiff < 20 ? 10 : 6;
    }
  } else if (metrics.luminanceDiff < 0.25 && !hueSeparated) {
    deltaBoost = 6;
  } else if (metrics.luminanceDiff < 0.4) {
    deltaBoost = 3;
  }

  const contrastBoost =
    metrics.hueDiff < HUE_SIMILARITY_DEG && metrics.saturationDiff < SATURATION_SIMILARITY ? 0.5 : 0;
  const contrastRelief =
    metrics.hueDiff >= 35 && metrics.saturationDiff >= 40 ? 0.7 : 0;
  const adjustedContrast = Math.max(contrast_threshold + contrastBoost - contrastRelief, 1.5);

  return {
    deltaE: deltaE_threshold + deltaBoost,
    contrastRatio: adjustedContrast,
  };
}

function isConflict(hex1, hex2, deltaE_threshold = 15, contrast_threshold = 2.5) {
  const metrics = computeColorMetrics(hex1, hex2);
  const thresholds = deriveDynamicThresholds(deltaE_threshold, contrast_threshold, metrics);
  const deltaEBreach = metrics.deltaE < thresholds.deltaE;
  const contrastBreach = metrics.contrastRatio < thresholds.contrastRatio;
  const hueBreach = metrics.hueDiff <= HUE_SIMILARITY_DEG;
  const saturationBreach = metrics.saturationDiff <= SATURATION_SIMILARITY;
  const highSatHueSplit = metrics.hueDiff < 12 && metrics.saturationDiff >= 60;
  const hueSeparated = metrics.hueDiff >= 28;
  const luminanceProtected = (metrics.luminanceDiff < 0.05 && metrics.hueDiff >= 10) || hueSeparated;
  const luminanceBreach = !highSatHueSplit && !luminanceProtected && metrics.luminanceDiff < 0.2;

  const supportingSignals = [contrastBreach, hueBreach && saturationBreach, luminanceBreach].filter(Boolean).length;
  const conflict = deltaEBreach && supportingSignals >= 2;

  return {
    conflict,
    metrics,
    thresholds,
    diagnostics: {
      deltaEBreach,
      contrastBreach,
      hueBreach,
      saturationBreach,
      luminanceBreach,
      supportingSignals,
    },
  };
}
```

IT 只需依序呼叫 `computeColorMetrics → deriveDynamicThresholds → isConflict` 即可獲得完整的判斷結果與診斷資訊。

---

## 6. 範例結果說明
以下列出幾筆常見測試案例，展示 `isConflict` 的輸出涵義：

### 6.1 亮灰 vs. 螢光藍
```json
{
  "home": { "primary": "#ebeef0" },
  "away": { "primary": "#e4e4d9", "secondary": "#00fffa" }
}
```
- `home-primary` vs `away-secondary (#00fffa)`：`deltaE = 24.24`、`contrast = 1.08`、`hueDiff = 25°`。  
  動態 DeltaE 門檻降至 21 (`deltaEBreach = false`)，雖然對比偏低，但支援訊號僅 1 個 → **判定不衝突**。

### 6.2 深綠 vs. 螢光綠
```json
{
  "home": { "primary": "#586a58" },
  "away": { "primary": "#648b7d", "secondary": "#238113" }
}
```
- `home-primary` vs `away-primary (#648b7d)`：`deltaE = 13.49`、`contrast = 1.53`、`luminanceDiff = 0.096`。  
  DeltaE 門檻為 21（亮度 boost），`deltaE` 仍偏低且對比/亮度同時告警 → **判定衝突**。  
- `home-primary` vs `away-secondary (#238113)`：因屬於「飽和差 65、亮度極近但 hue 9°」的情況，亮度訊號被抑制，支援訊號只有對比一項 → **判定不衝突**。

### 6.3 亮黃 vs. 青綠
```json
{
  "home": { "primary": "#ffff00" },
  "away": { "primary": "#99ff33", "secondary": "#99ff33" }
}
```
- hue 差 30°，亮度差 0.142 → DeltaE 門檻 18。`deltaE = 16.55 < 18`，但亮度訊號因 hue 差大而被關閉，支援訊號僅對比一項 → **判定不衝突**。

### 6.4 紅 vs. 橘
```json
{
  "home": { "primary": "#ff3300" },
  "away": { "primary": "#d86518", "secondary": "#d86518" }
}
```
- hue 差 12°、亮度差 0.003 → DeltaE 門檻 23，`deltaE = 11.34`。  
  由於「亮度極近但 hue ≥ 10°」觸發保護，`luminanceBreach = false`，支援訊號只有對比 → **判定不衝突**。

藉由觀察 `checks` 陣列中的 `metrics` 與 `diagnostics`，即可解讀每次判斷是被哪些規則拒絕或放行。
