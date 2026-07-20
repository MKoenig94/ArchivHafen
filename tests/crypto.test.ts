import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CredentialVault } from "../src/server/crypto";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("CredentialVault", () => {
  it("verschlüsselt Zugangsdaten und kann sie nach einem Neustart wieder lesen", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "archivhafen-vault-"));
    temporaryDirectories.push(directory);

    const firstVault = new CredentialVault(directory);
    const payload = firstVault.encrypt("richtig-geheimes-app-passwort");

    expect(payload).not.toContain("richtig-geheimes-app-passwort");
    expect(payload.startsWith("v1.")).toBe(true);
    expect(new CredentialVault(directory).decrypt(payload)).toBe("richtig-geheimes-app-passwort");
    expect(fs.statSync(path.join(directory, "master.key")).mode & 0o777).toBe(0o600);
  });

  it("erkennt manipulierte Ciphertexte", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "archivhafen-vault-"));
    temporaryDirectories.push(directory);
    const vault = new CredentialVault(directory);
    const encrypted = vault.encrypt("passwort");
    const parts = encrypted.split(".");
    const ciphertext = Buffer.from(parts[3], "base64url");
    ciphertext[0] ^= 0x01;
    parts[3] = ciphertext.toString("base64url");

    expect(() => vault.decrypt(parts.join("."))).toThrow();
  });
});
