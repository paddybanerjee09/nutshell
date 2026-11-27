import { loadConfig } from "@nutshell/server/config";

export function entryMode(): "local-alpha" | "live" | "unavailable" {
  try {
    return loadConfig().mode;
  } catch {
    return "unavailable";
  }
}
