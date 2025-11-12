// ===== Jersey Color Checker — Lambda proxy handler (Node 22 ready) =====

import { analyzeColors } from "./conflictDetect.js";

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

// ---------- Analysis proxy ----------
function handleAnalyze(body = {}) {
  const analysis = analyzeColors(body);
  if (analysis.status === "error") {
    return buildResponse(400, { error: analysis.error });
  }
  return buildResponse(200, analysis);
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
