import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDatabasePath } from "../src/server/config";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("Datenbankpfad", () => {
  it("verwendet für neue Archive den Namen archivhafen.sqlite", () => {
    const directory = temporaryDirectory();

    expect(resolveDatabasePath(directory)).toBe(path.join(directory, "archivhafen.sqlite"));
  });

  it("öffnet eine Datenbank der früheren Entwicklungsversion weiter", () => {
    const directory = temporaryDirectory();
    const legacyPath = path.join(directory, "mailstore.sqlite");
    fs.writeFileSync(legacyPath, "legacy");

    expect(resolveDatabasePath(directory)).toBe(legacyPath);
  });

  it("bevorzugt den neuen Namen, wenn beide Datenbanken existieren", () => {
    const directory = temporaryDirectory();
    const currentPath = path.join(directory, "archivhafen.sqlite");
    fs.writeFileSync(path.join(directory, "mailstore.sqlite"), "legacy");
    fs.writeFileSync(currentPath, "current");

    expect(resolveDatabasePath(directory)).toBe(currentPath);
  });
});

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "archivhafen-config-"));
  temporaryDirectories.push(directory);
  return directory;
}
