import { styleText } from "node:util";
import type { ProgressEvent } from "../core/types.js";

function labelForPhase(phase: ProgressEvent["phase"]) {
  switch (phase) {
    case "request":
      return styleText("cyan", "request");
    case "resolve":
      return styleText("magenta", "resolve");
    case "repo":
      return styleText("blue", "repo");
    case "auth":
      return styleText("yellow", "auth");
    case "agent":
      return styleText("green", "agent");
    case "tool":
      return styleText("white", "tool");
    case "cleanup":
      return styleText("gray", "cleanup");
  }
}

function levelPrefix(level: ProgressEvent["level"]) {
  switch (level) {
    case "warn":
      return styleText("yellow", "warn");
    case "error":
      return styleText("red", "error");
    default:
      return styleText("green", "info");
  }
}

export function shouldDisplayProgressEvent(event: ProgressEvent) {
  if (event.phase === "auth" || event.phase === "cleanup") {
    return false;
  }

  if (
    event.phase === "request" &&
    event.message === "validated request"
  ) {
    return false;
  }

  if (
    event.phase === "agent" &&
    [
      "starting agent",
      "resolving model",
      "using model",
      "produced final answer",
    ].includes(event.message)
  ) {
    return false;
  }

  if (
    event.phase === "tool" &&
    ["starting", "executing", "completed"].includes(event.message)
  ) {
    return false;
  }

  if (
    event.phase === "tool" &&
    event.level === "error" &&
    ["PATH_NOT_FOUND", "INVALID_REQUEST"].includes(event.detail ?? "")
  ) {
    return false;
  }

  return true;
}

export function formatProgressEvent(event: ProgressEvent) {
  const parts = [
    styleText("gray", "["),
    levelPrefix(event.level),
    styleText("gray", "]"),
    " ",
    labelForPhase(event.phase),
  ];

  if (event.tool) {
    parts.push(styleText("gray", "/"), styleText("bold", event.tool));
  }

  if (event.repo) {
    parts.push(" ", styleText("blueBright", event.repo));
  }

  if (event.path) {
    parts.push(" ", styleText("dim", event.path));
  }

  parts.push(styleText("gray", " · "), event.message);

  if (event.detail) {
    parts.push(" ", styleText("dim", event.detail));
  }

  return parts.join("");
}
