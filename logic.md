// ===== Jersey Color Checker — Lambda proxy handler (Node 22 ready) =====

import DeltaE from "delta-e";
import convert from "color-convert";

const defaultHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
};

const healthMessage = "Jersey Color Checker API is running ✅\nUse POST /analyze to test colors.";

function buildResponse(statusCode, payload, extraHeaders = {}) {
  const isString = typeof payload === "string";
  return {
    statusCode,
    headers: {
      ...defaultHeaders,
      "Content-Type": isString ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
      ...extraHeaders,
    },
    body: isString ? payload : JSON.stringify(payload),
  };
}

function parseJsonBody(event) {
  if (!event?.body) {
    return {};
  }
  const decoded = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  try {
    return JSON.parse(decoded);
  } catch {
    throw new Error("INVALID_JSON");
  }
}

function getMethod(event) {
  return event?.httpMethod || event?.requestContext?.http?.method || "GET";
}

function normalizePath(path, stage) {
  if (!path) return "/";
  if (!stage) return path;
  const prefix = `/${stage}`;
  if (path === prefix) return "/";
  return path.startsWith(prefix) ? path.slice(prefix.length) || "/" : path;
}

function sanitizePath(path) {
  if (!path) return "/";
  let next = path.startsWith("/") ? path : `/${path}`;
  next = next.replace(/\/+$/, "");
  return next === "" ? "/" : next;
}

function resolvePaths(event) {
  const stage =
    event?.requestContext?.stage ||
    event?.requestContext?.http?.stage ||
    event?.stageVariables?.stage;
  const rawPath = event?.rawPath || event?.path || "/";
  const normalizedPath = sanitizePath(normalizePath(rawPath, stage));
  let resource = event?.resource && !event.resource.includes("{") ? sanitizePath(event.resource) : null;
  if (resource) {
    resource = sanitizePath(normalizePath(resource, stage));
  }
  const direct = resource || normalizedPath;
  const segments = direct === "/" ? [] : direct.split("/").filter(Boolean);
  const withoutBase = segments.length > 0 ? `/${segments.slice(1).join("/")}` || "/" : "/";
  return {
    direct,
    withoutBase,
  };
}

// ---------- Color conversion & analysis ----------
const HUE_SIMILARITY_DEG = 25;
const SATURATION_SIMILARITY = 15; // percentage points (0-100 scale)

function createMetricsEntry(stage, baseLabel, baseColor, compareLabel, compareColor, evaluation) {
  const { metrics, thresholds, diagnostics, conflict } = evaluation;
  return {
    stage,
    base: { label: baseLabel, color: baseColor },
    compare: { label: compareLabel, color: compareColor },
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

  if (metrics.hueDiff < 15) {
    deltaBoost += 2;
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

function formatResult(base, alt, rule, evaluation) {
  const { metrics, thresholds, diagnostics } = evaluation;
  return {
    homeColor: base,
    awayColor: alt,
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

// ---------- Home-first, away-kit swap logic ----------
function findNonConflictingColors(home, away, deltaE_threshold = 15, contrast_threshold = 2.5) {
  const homeColor = home.primary;
  const awaySet = [away.primary, away.secondary, away.third].filter(Boolean);
  const metricsLog = [];

  // Step 1: try every away kit in priority order
  for (const aColor of awaySet) {
    const evaluation = isConflict(homeColor, aColor, deltaE_threshold, contrast_threshold);
    metricsLog.push(createMetricsEntry("home-primary", "home", homeColor, "away", aColor, evaluation));
    if (!evaluation.conflict) {
      return { result: formatResult(homeColor, aColor, "Away kit swapped to avoid clashes", evaluation), metricsLog };
    }
  }

  // Step 2: if all away kits clash, try home alternates (rare)
  const homeSet = [home.secondary, home.third].filter(Boolean);
  for (const hColor of homeSet) {
    for (const aColor of awaySet) {
      const evaluation = isConflict(hColor, aColor, deltaE_threshold, contrast_threshold);
      metricsLog.push(createMetricsEntry("home-alternate", "homeAlt", hColor, "away", aColor, evaluation));
      if (!evaluation.conflict) {
        return {
          result: formatResult(hColor, aColor, "⚠️ Home kit switched to alternate (edge case)", evaluation),
          metricsLog,
        };
      }
    }
  }

  return { result: null, metricsLog };
}

function handleAnalyze(body = {}) {
  const { home, away, deltaE_threshold, contrast_threshold } = body;
  if (!home || !away) {
    return buildResponse(400, { error: "Please provide both home and away color data" });
  }

  const { result, metricsLog } = findNonConflictingColors(
    home,
    away,
    deltaE_threshold ?? 15,
    contrast_threshold ?? 2.5
  );

  if (result) {
    return buildResponse(200, {
      status: "ok",
      message: "Found a non-conflicting combination",
      ...result,
      checks: metricsLog,
    });
  }

  return buildResponse(200, {
    status: "conflict",
    message: "All combinations still clash. Please review or adjust colors",
    checks: metricsLog,
  });
}

// ---------- Lambda entry (AWS proxy integration) ----------
export async function handler(event) {
  const method = getMethod(event);
  const { direct, withoutBase } = resolvePaths(event);
  const matches = (target) => direct === target || withoutBase === target;

  if (method === "OPTIONS") {
    return buildResponse(204, "", { "Access-Control-Allow-Methods": "GET,POST,OPTIONS" });
  }

  if (method === "GET" && matches("/")) {
    return buildResponse(200, healthMessage);
  }

  if (method === "POST" && (matches("/analyze") || matches("/"))) {
    try {
      const body = parseJsonBody(event);
      return handleAnalyze(body);
    } catch (err) {
      if (err.message === "INVALID_JSON") {
        return buildResponse(400, { error: "Please provide valid JSON payload" });
      }
      console.error("Unexpected error during /analyze", err);
      return buildResponse(500, { error: "Unexpected server error, please try again later" });
    }
  }
  return buildResponse(404, {
    error: "Route not found",
    pathDebug: {
      method,
      direct,
      withoutBase,
      path: event?.path ?? null,
      rawPath: event?.rawPath ?? null,
      resource: event?.resource ?? null,
      proxy: event?.pathParameters?.proxy ?? null,
    },
  });
}
