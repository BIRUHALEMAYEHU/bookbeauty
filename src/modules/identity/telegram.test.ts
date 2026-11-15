import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  cleanTelegramUsername,
  displayNameFromTelegram,
  type TelegramAuthPayload,
  verifyTelegramLogin,
} from "./telegram";

const BOT_TOKEN = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";

function sign(payload: Omit<TelegramAuthPayload, "hash">): TelegramAuthPayload {
  const checkString = Object.entries(payload)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHash("sha256").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secretKey).update(checkString).digest("hex");
  return { ...payload, hash };
}

describe("verifyTelegramLogin", () => {
  it("accepts a valid, fresh payload", () => {
    const payload = sign({
      id: 42,
      first_name: "Hana",
      username: "hana",
      auth_date: Math.floor(Date.now() / 1000),
    });
    expect(verifyTelegramLogin(payload, BOT_TOKEN)).toBe(true);
  });

  it("rejects a tampered name", () => {
    const payload = sign({
      id: 42,
      first_name: "Hana",
      auth_date: Math.floor(Date.now() / 1000),
    });
    expect(
      verifyTelegramLogin({ ...payload, first_name: "Meron" }, BOT_TOKEN),
    ).toBe(false);
  });

  it("rejects an expired payload", () => {
    const payload = sign({
      id: 42,
      first_name: "Hana",
      auth_date: Math.floor(Date.now() / 1000) - 25 * 60 * 60,
    });
    expect(verifyTelegramLogin(payload, BOT_TOKEN)).toBe(false);
  });
});

describe("displayNameFromTelegram", () => {
  it("prefers the person's name", () => {
    expect(
      displayNameFromTelegram({
        id: 1,
        first_name: "Hana",
        last_name: "Kebede",
        auth_date: 0,
        hash: "",
      }),
    ).toBe("Hana Kebede");
  });
});

describe("cleanTelegramUsername", () => {
  it("accepts the bare name, the @name and the link", () => {
    for (const raw of [
      "BookBeautyBot",
      "@BookBeautyBot",
      "https://t.me/BookBeautyBot",
      "t.me/BookBeautyBot/",
      " https://telegram.me/BookBeautyBot?start=1 ",
    ]) {
      expect(cleanTelegramUsername(raw)).toBe("BookBeautyBot");
    }
  });

  it("gives nothing for empty or unusable values", () => {
    expect(cleanTelegramUsername(undefined)).toBeUndefined();
    expect(cleanTelegramUsername("")).toBeUndefined();
    expect(cleanTelegramUsername("https://t.me/")).toBeUndefined();
    expect(cleanTelegramUsername("not a name!")).toBeUndefined();
  });
});
