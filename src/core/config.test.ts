import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveStorageDirs } from "./config.js";

describe("resolveStorageDirs", () => {
  it("uses LOCALAPPDATA defaults on Windows", () => {
    expect(
      resolveStorageDirs({
        platform: "win32",
        env: {
          LOCALAPPDATA: "C:\\Users\\kaf\\AppData\\Local",
        },
        homedir: "C:\\Users\\kaf",
      }),
    ).toEqual({
      dataDir: path.join("C:\\Users\\kaf\\AppData\\Local", "immanence", "data"),
      cacheDir: path.join(
        "C:\\Users\\kaf\\AppData\\Local",
        "immanence",
        "cache",
      ),
    });
  });

  it("falls back to AppData Local on Windows when LOCALAPPDATA is unset", () => {
    expect(
      resolveStorageDirs({
        platform: "win32",
        env: {},
        homedir: "C:\\Users\\kaf",
      }),
    ).toEqual({
      dataDir: path.join(
        "C:\\Users\\kaf",
        "AppData",
        "Local",
        "immanence",
        "data",
      ),
      cacheDir: path.join(
        "C:\\Users\\kaf",
        "AppData",
        "Local",
        "immanence",
        "cache",
      ),
    });
  });

  it("lets env var overrides win individually", () => {
    expect(
      resolveStorageDirs({
        platform: "win32",
        env: {
          IMMANENCE_DATA_DIR: "D:\\immanence-data",
          LOCALAPPDATA: "C:\\Users\\kaf\\AppData\\Local",
        },
        homedir: "C:\\Users\\kaf",
      }),
    ).toEqual({
      dataDir: "D:\\immanence-data",
      cacheDir: path.join(
        "C:\\Users\\kaf\\AppData\\Local",
        "immanence",
        "cache",
      ),
    });
  });

  it("keeps the existing non-Windows defaults", () => {
    expect(
      resolveStorageDirs({
        platform: "linux",
        env: {},
        homedir: "/home/kaf",
      }),
    ).toEqual({
      dataDir: "/home/kaf/.local/share/immanence",
      cacheDir: "/home/kaf/.cache/immanence",
    });
  });
});
