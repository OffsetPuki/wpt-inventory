import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { Response, Request } from "express";
import { uploadsDir } from "./storage";

export function saveLeadPhoto(data: string): string {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(
    data,
  );
  if (!match) throw new Error("Use JPG, PNG or WebP photos.");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 1_000_000)
    throw new Error("Photos must be no larger than 1 MB each.");
  const kind = match[1];
  const valid =
    kind === "jpeg"
      ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : kind === "png"
        ? bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : bytes.toString("ascii", 0, 4) === "RIFF" &&
          bytes.toString("ascii", 8, 12) === "WEBP";
  if (!valid) throw new Error("The photo contents do not match its file type.");
  const name = `${crypto.randomBytes(16).toString("hex")}.${kind === "jpeg" ? "jpg" : kind}`;
  fs.writeFileSync(path.join(uploadsDir, name), bytes, { flag: "wx" });
  return `/uploads/${name}`;
}
export function setMediaCookie(
  req: Request,
  res: Response,
  token: string | null,
) {
  res.cookie("cjm_media", token || "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/uploads",
    maxAge: token ? 12 * 60 * 60 * 1000 : 0,
  });
}
