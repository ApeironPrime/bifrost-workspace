import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import { resolveAvatarStorageDir } from "../lib/avatarStorage.js";

const VALID_AVATAR_FILENAME = /^[a-f0-9]{64}\.jpg$/i;

export function createAvatarRouter(storageDir = resolveAvatarStorageDir()): Router {
  const router = Router();

  router.get("/:filename", async (request, response) => {
    const filename = request.params.filename ?? "";
    if (!VALID_AVATAR_FILENAME.test(filename)) {
      response.status(404).json({ message: "Không tìm thấy ảnh đại diện." });
      return;
    }

    const filePath = path.join(storageDir, filename);
    try {
      const bytes = await fs.readFile(filePath);
      response.setHeader("Content-Type", "image/jpeg");
      response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.status(200).send(bytes);
    } catch {
      response.status(404).json({ message: "Không tìm thấy ảnh đại diện." });
    }
  });

  return router;
}
