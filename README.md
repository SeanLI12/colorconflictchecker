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


## 5. 參考實作（JavaScript）
請參考conflictDetect.js

## 6. 核心函式與使用方式

IT 只要匯入 `conflictDetect.js` 即可直接取得結果。

### 6.1 快速上手範例（IT 請統一使用 `analyzeColors`）
```js
import { analyzeColors } from "./conflictDetect.js";

const payload = {
  team1: { homekit: "#ebeef0", awaykit: "#7f7f7f" },
  team2: { homekit: "#e4e4d9", awaykit: "#00fffa", thirdkit: "#c52a2a" },
};

const summary = analyzeColors(payload);

if (summary.status === "ok") {
  console.log("可使用組合:", summary.team1KitUsed, summary.team2KitUsed);
  // IT 要求：直接依照 summary.team1KitUsed / summary.team2KitUsed 安排本場比賽的 kit
} else if (summary.status === "conflict") {
  console.log("仍衝突，請勿安排任何 kit，並檢視 checks:", summary.checks);
} else {
  console.error(summary.error);
}
```

### 6.2 IT 作業指引

1. **Kit 決策**  
   - 當 `summary.status === "ok"` 時，請直接依 `summary.team1KitUsed`、`summary.team2KitUsed`（只會是 `homekit` / `awaykit` / `thirdkit`）安排本場比賽的球衣套件。  
   - 當 `summary.status === "conflict"` 或 `summary` 為 `null` / 未定義時，請勿顯示任何 kit，該場比賽不要顯示球衣。
2. **顏色輸入來源**  
   - `team1`、`team2` 的 `homekit` / `awaykit` / `thirdkit` 欄位，請直接填入 Competitor Profile API 回傳的對應 kit `base` 顏色。  
   - 例如：`team1: { homekit: "#ebeef0", awaykit: "#7f7f7f" }` 代表 homekit 的 base 為 `#ebeef0`、awaykit 的 base 為 `#7f7f7f`；team2 亦相同。
---
 

### 6.3 輸入 JSON（建議格式）
```jsonc
{
  "team1": {
    "homekit": "#112233",        // Team1 home base
    "awaykit": "#445566",        // Team1 away base
    "thirdkit": "#778899"        // Team1 third base
  },
  "team2": {
    "homekit": "#aa0000",        // Team2 home base
    "awaykit": "#bb2222",        // Team2 away base
    "thirdkit": "#cc4444"        // Team2 third base
  },
  "deltaE_threshold": 15,        // 選填：不提供則預設 15
  "contrast_threshold": 2.5      // 選填：不提供則預設 2.5
}
```

欄位說明：
- `team1.homekit` 與 `team2.homekit` 必須是 6 碼 HEX（可含 `#`）。
- `awaykit`、`thirdkit` 代表不同套件的優先順序：系統會依序嘗試 `team2.homekit → team2.awaykit → team2.thirdkit`，如仍衝突才嘗試 `team1` 的備用套件。
- 客製門檻主要用於測試；若值偏離預設，記得同步告知設計/規範負責人。
- **顏色來源要求**：輸入的各 kit 值（`homekit`、`awaykit`、`thirdkit`）請直接使用 Competitor Profile API 回傳的該 kit `base` 顏色。

### 6.4 結果格式（成功案例）
使用 `analyzeColors`時，成功的結果結構如下：
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
      "metrics": { "...": "略" },
      "thresholds": { "...": "略" },
      "diagnostics": { "...": "略" }
    },
    {
      "stage": "team1-homekit",
      "base": { "label": "team1", "kit": "homekit", "color": "#112233" },
      "compare": { "label": "team2", "kit": "awaykit", "color": "#bb2222" },
      "conflict": false,
      "metrics": { "...": "略" },
      "thresholds": { "...": "略" },
      "diagnostics": { "...": "略" }
    }
  ]
}
```
重要欄位：
- 進階使用者若直接呼叫 `findNonConflictingColors`，會拿到 `{ result, metricsLog }`；其中 `result` 的欄位與上例相同，但不包含 `status/message`。
- `team1Color` / `team2Color`：最終建議使用的配色。
- `team1KitUsed` / `team2KitUsed`：成功避開衝突時，分別說明 team1、team2 最終使用哪一套 kit（`homekit` / `awaykit` / `thirdkit`，與輸入欄位一致）。
- `checks`：每次嘗試的詳細紀錄，可用於偵錯、稽核或提供 PM 參考。
- `diagnostics`：命中哪些規則（對比不足、亮度過近等），方便判讀衝突原因。
- `checks[].base.kit` / `checks[].compare.kit`：就算判定結果為衝突，也會明確指出每次比較時 team1、team2 實際用的是哪一套 kit，名稱與輸入 JSON 保持一致。

若所有組合都衝突，`result` 會是 `null`（或 `status = "conflict"`），`message` 會提示需要人工調整；`checks` 依然會列出全部嘗試，方便追蹤。

---

## 7. 範例

### 7.1 亮灰 vs. 螢光藍
```json
{
  "team1": { "homekit": "#ebeef0" },
  "team2": { "homekit": "#e4e4d9", "awaykit": "#00fffa" }
}
```
- `team1-homekit` vs `team2-awaykit (#00fffa)`：`deltaE = 24.24`、`contrast = 1.08`、`hueDiff = 25°`。  
  動態 DeltaE 門檻降至 21 (`deltaEBreach = false`)，雖然對比偏低，但支援訊號僅 1 個 → **判定不衝突**，並回報 `team2KitUsed = awaykit`。

### 7.2 深綠 vs. 螢光綠
```json
{
  "team1": { "homekit": "#586a58" },
  "team2": { "homekit": "#648b7d", "awaykit": "#238113" }
}
```
- `team1-homekit` vs `team2-homekit (#648b7d)`：`deltaE = 13.49`、`contrast = 1.53`、`luminanceDiff = 0.096`。  
  DeltaE 門檻為 21（亮度 boost），`deltaE` 仍偏低且對比/亮度同時告警 → **判定衝突**。  
- `team1-homekit` vs `team2-awaykit (#238113)`：因屬於「飽和差 65、亮度極近但 hue 9°」的情況，亮度訊號被抑制，支援訊號只有對比一項 → **判定不衝突**，並回報 `team2KitUsed = awaykit`。


### 7.3 全部組合皆衝突
```json
{
  "team1": { "homekit": "#1a1a1a", "awaykit": "#2a2a2a" },
  "team2": { "homekit": "#151515", "awaykit": "#202020" }
}
```
- `team1-homekit`/`team2-homekit` 亮度差僅 0.01、`deltaE = 4.12`，支援訊號（對比 + 亮度）同時成立 → **衝突**。  
- 改試 `team2.awaykit` 仍僅是亮度微調，`deltaE = 5.35`、對比不足 → **衝突**。  
- `team1` 改用 `awaykit` 嘗試所有 `team2` kit 仍無法通過，最終回應範例：

```json
{
  "status": "conflict",
  "message": "All combinations still clash. Please review or adjust colors",
  "checks": [
    { "stage": "team1-homekit", "base": { "kit": "homekit", "color": "#1a1a1a" }, "compare": { "kit": "homekit", "color": "#151515" }, "conflict": true, "diagnostics": { "...": "略" } },
    { "stage": "team1-homekit", "base": { "kit": "homekit", "color": "#1a1a1a" }, "compare": { "kit": "awaykit", "color": "#202020" }, "conflict": true, "diagnostics": { "...": "略" } },
    { "stage": "team1-alternate", "base": { "kit": "awaykit", "color": "#2a2a2a" }, "compare": { "kit": "homekit", "color": "#151515" }, "conflict": true, "diagnostics": { "...": "略" } },
    { "stage": "team1-alternate", "base": { "kit": "awaykit", "color": "#2a2a2a" }, "compare": { "kit": "awaykit", "color": "#202020" }, "conflict": true, "diagnostics": { "...": "略" } }
  ]
}
```
- `checks` 陣列能清楚指出每次嘗試都衝突，方便追蹤需要調整的 kit。

藉由觀察 `checks` 陣列中的 `metrics` 與 `diagnostics`，即可解讀每次判斷是被哪些規則拒絕或放行。
