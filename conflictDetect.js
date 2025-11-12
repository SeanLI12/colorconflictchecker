import DeltaE from "delta-e";
import convert from "color-convert";

const HUE_SIMILARITY_DEG = 25;
const SATURATION_SIMILARITY = 15;
const KIT_DISPLAY_NAMES = {
  homekit: "homekit",
  awaykit: "awaykit",
  thirdkit: "thirdkit",
};

function kitDisplayName(key) {
  return KIT_DISPLAY_NAMES[key] || "unknown";
}

function createMetricsEntry(stage, baseInfo, compareInfo, evaluation) {
  const { metrics, thresholds, diagnostics, conflict } = evaluation;
  return {
    stage,
    base: baseInfo,
    compare: compareInfo,
    conflict,
    metrics: {
      deltaE: Number(metrics.deltaE.toFixed(2)),
      contrastRatio: Number(metrics.contrastRatio.toFixed(2)),
      hueDifference: Number(metrics.hueDiff.toFixed(2)),
      saturationDifference: Number(metrics.saturationDiff.toFixed(2)),
      luminanceDifference: Number(metrics.luminanceDiff.toFixed(3)),
    },
    thresholds: {
      deltaE: Number(thresholds.deltaE.toFixed(2)),
      contrastRatio: Number(thresholds.contrastRatio.toFixed(2)),
    },
    diagnostics,
  };
}

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

export function computeColorMetrics(hex1, hex2) {
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

export function deriveDynamicThresholds(deltaE_threshold, contrast_threshold, metrics) {
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

export function isConflict(hex1, hex2, deltaE_threshold = 15, contrast_threshold = 2.5) {
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

function formatResult(base, alt, rule, evaluation, metaKits = {}) {
  const { metrics, thresholds, diagnostics } = evaluation;
  return {
    team1Color: base,
    team2Color: alt,
    team1KitUsed: metaKits.team1Kit || "unknown",
    team2KitUsed: metaKits.team2Kit || "unknown",
    deltaE: Number(metrics.deltaE.toFixed(2)),
    contrastRatio: Number(metrics.contrastRatio.toFixed(2)),
    hueDifference: Number(metrics.hueDiff.toFixed(2)),
    saturationDifference: Number(metrics.saturationDiff.toFixed(2)),
    luminanceDifference: Number(metrics.luminanceDiff.toFixed(3)),
    dynamicThresholds: {
      deltaE: Number(thresholds.deltaE.toFixed(2)),
      contrastRatio: Number(thresholds.contrastRatio.toFixed(2)),
    },
    rule,
    diagnostics,
  };
}

function buildKitOption(label, kitKey, color) {
  return color
    ? {
        label,
        kitKey,
        kit: kitDisplayName(kitKey),
        color,
      }
    : null;
}

export function findNonConflictingColors(team1, team2, deltaE_threshold = 15, contrast_threshold = 2.5) {
  const team1Primary = team1.homekit;
  const team2Set = [
    buildKitOption("team2", "homekit", team2.homekit),
    buildKitOption("team2", "awaykit", team2.awaykit),
    buildKitOption("team2", "thirdkit", team2.thirdkit),
  ].filter(Boolean);
  const metricsLog = [];

  for (const t2Kit of team2Set) {
    const evaluation = isConflict(team1Primary, t2Kit.color, deltaE_threshold, contrast_threshold);
    metricsLog.push(
      createMetricsEntry(
        "team1-homekit",
        { label: "team1", kit: kitDisplayName("homekit"), color: team1Primary },
        t2Kit,
        evaluation
      )
    );
    if (!evaluation.conflict) {
      return {
        result: formatResult(team1Primary, t2Kit.color, "Team2 kit selection avoided clashes", evaluation, {
          team1Kit: kitDisplayName("homekit"),
          team2Kit: t2Kit.kit,
        }),
        metricsLog,
      };
    }
  }

  const team1Alternates = [
    buildKitOption("team1Alt", "awaykit", team1.awaykit),
    buildKitOption("team1Alt", "thirdkit", team1.thirdkit),
  ].filter(Boolean);

  for (const t1Kit of team1Alternates) {
    for (const t2Kit of team2Set) {
      const evaluation = isConflict(t1Kit.color, t2Kit.color, deltaE_threshold, contrast_threshold);
      metricsLog.push(createMetricsEntry("team1-alternate", t1Kit, t2Kit, evaluation));
      if (!evaluation.conflict) {
        return {
          result: formatResult(t1Kit.color, t2Kit.color, "⚠️ Team1 kit switched to alternate (edge case)", evaluation, {
            team1Kit: t1Kit.kit,
            team2Kit: t2Kit.kit,
          }),
          metricsLog,
        };
      }
    }
  }

  return { result: null, metricsLog };
}

export function analyzeColors(body = {}) {
  const { team1, team2, deltaE_threshold, contrast_threshold } = body || {};
  if (!team1?.homekit || !team2?.homekit) {
    return {
      status: "error",
      error: "Please provide team1.homekit and team2.homekit color data",
    };
  }

  const { result, metricsLog } = findNonConflictingColors(
    team1,
    team2,
    deltaE_threshold ?? 15,
    contrast_threshold ?? 2.5
  );

  if (result) {
    return {
      status: "ok",
      message: "Found a non-conflicting combination",
      ...result,
      checks: metricsLog,
    };
  }

  return {
    status: "conflict",
    message: "All combinations still clash. Please review or adjust colors",
    checks: metricsLog,
  };
}
