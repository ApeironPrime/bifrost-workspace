import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const JPEG_DATA_URL_PREFIX = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/;
const MAX_AVATAR_BYTES = 256 * 1024;

export interface AvatarStorage {
  readonly mode: "s3" | "disk";
  storeAvatar(dataUrl: string): Promise<string>;
}

export function parseAndValidateJpegDataUrl(dataUrl: string): Buffer {
  const trimmed = dataUrl.trim();
  const match = JPEG_DATA_URL_PREFIX.exec(trimmed);
  if (!match) {
    throw new Error("Avatar phải là ảnh JPEG base64 hợp lệ.");
  }

  const buffer = Buffer.from(match[1], "base64");
  if (buffer.length < 4 || buffer.length > MAX_AVATAR_BYTES) {
    throw new Error("Kích thước ảnh avatar không hợp lệ (tối đa 256KB).");
  }

  // Verify JPEG SOI marker (0xFF 0xD8 0xFF)
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
    throw new Error("Dữ liệu ảnh không đúng định dạng JPEG.");
  }

  return buffer;
}

function sha256Hex(data: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmacSha256(key: crypto.BinaryLike, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data).digest();
}

export interface AwsV4PutParams {
  endpoint: string;
  bucket: string;
  key: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  body: Buffer;
  contentType: string;
  now?: Date;
}

export function signAwsV4PutRequest(params: AwsV4PutParams): {
  url: string;
  headers: Record<string, string>;
} {
  const now = params.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const baseEndpoint = params.endpoint.replace(/\/+$/, "");
  const encodedKey = params.key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const targetUrl = new URL(`${baseEndpoint}/${encodeURIComponent(params.bucket)}/${encodedKey}`);
  const host = targetUrl.host;
  const payloadHash = sha256Hex(params.body);

  const canonicalHeaders =
    `content-type:${params.contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    "PUT",
    targetUrl.pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${params.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmacSha256(`AWS4${params.secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, params.region);
  const kService = hmacSha256(kRegion, "s3");
  const kSigning = hmacSha256(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${params.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: targetUrl.toString(),
    headers: {
      "Content-Type": params.contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization: authorization,
    },
  };
}

export function resolveAvatarStorageDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.AVATAR_STORAGE_DIR?.trim() || path.join(process.cwd(), "uploads", "avatars"));
}

export function createAvatarStorageFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): AvatarStorage {
  const s3Endpoint = env.AVATAR_S3_ENDPOINT?.trim() || env.S3_ENDPOINT?.trim();
  const s3Bucket = env.AVATAR_S3_BUCKET?.trim() || env.S3_BUCKET?.trim();
  const s3AccessKeyId = env.AVATAR_S3_ACCESS_KEY_ID?.trim() || env.S3_ACCESS_KEY_ID?.trim();
  const s3SecretAccessKey =
    env.AVATAR_S3_SECRET_ACCESS_KEY?.trim() || env.S3_SECRET_ACCESS_KEY?.trim();

  if (s3Endpoint && s3Bucket && s3AccessKeyId && s3SecretAccessKey) {
    const region = env.AVATAR_S3_REGION?.trim() || env.S3_REGION?.trim() || "auto";
    const publicBaseUrl = (
      env.AVATAR_S3_PUBLIC_BASE_URL?.trim() ||
      `${s3Endpoint.replace(/\/+$/, "")}/${encodeURIComponent(s3Bucket)}`
    ).replace(/\/+$/, "");

    return {
      mode: "s3",
      async storeAvatar(dataUrl: string): Promise<string> {
        const buffer = parseAndValidateJpegDataUrl(dataUrl);
        const hash = sha256Hex(buffer);
        const key = `avatars/${hash}.jpg`;
        const signed = signAwsV4PutRequest({
          endpoint: s3Endpoint,
          bucket: s3Bucket,
          key,
          region,
          accessKeyId: s3AccessKeyId,
          secretAccessKey: s3SecretAccessKey,
          body: buffer,
          contentType: "image/jpeg",
        });

        const response = await fetchImpl(signed.url, {
          method: "PUT",
          headers: signed.headers,
          body: new Uint8Array(buffer),
        });
        if (!response.ok) {
          throw new Error(`Tải avatar lên object storage thất bại (${response.status}).`);
        }
        return `${publicBaseUrl}/${key}`;
      },
    };
  }

  const storageDir = resolveAvatarStorageDir(env);
  return {
    mode: "disk",
    async storeAvatar(dataUrl: string): Promise<string> {
      const buffer = parseAndValidateJpegDataUrl(dataUrl);
      const hash = sha256Hex(buffer);
      const filename = `${hash}.jpg`;
      await fs.mkdir(storageDir, { recursive: true });
      const filePath = path.join(storageDir, filename);
      try {
        await fs.access(filePath);
      } catch {
        await fs.writeFile(filePath, buffer);
      }
      return `/api/avatars/${filename}`;
    },
  };
}
