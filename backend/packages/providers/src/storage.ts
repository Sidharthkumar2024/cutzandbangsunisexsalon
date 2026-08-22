import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { StorageProvider } from "@cutz/types";

/** S3-compatible storage (AWS S3, Cloudflare R2, MinIO). Signed URLs only. */
export class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  private bucket = process.env.STORAGE_BUCKET ?? "cutz-media";

  constructor() {
    this.client = new S3Client({
      endpoint: process.env.STORAGE_ENDPOINT || undefined,
      region: process.env.STORAGE_REGION ?? "auto",
      forcePathStyle: !!process.env.STORAGE_ENDPOINT,
      credentials: {
        accessKeyId: process.env.STORAGE_ACCESS_KEY ?? "",
        secretAccessKey: process.env.STORAGE_SECRET_KEY ?? "",
      },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
    return key;
  }

  signedUrl(key: string, expiresInSec: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSec,
    });
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const bytes = await res.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch {
      return null;
    }
  }
}

/**
 * Local-disk storage used when no S3 credentials are configured (dev / VPS
 * without object storage). Files live under STORAGE_DIR; signedUrl returns an
 * API path served by the app. Never used when STORAGE_ACCESS_KEY is set.
 */
export class LocalStorageProvider implements StorageProvider {
  private root = resolve(process.env.STORAGE_DIR ?? ".storage");
  private publicBase = (process.env.FILES_PUBLIC_URL ?? "").replace(/\/$/, "");

  // Resolve a key to an absolute path INSIDE root, rejecting path traversal
  // (`..`, absolute paths) so a crafted key can never escape STORAGE_DIR.
  private resolveKey(key: string): string {
    const full = resolve(this.root, key);
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error("invalid_storage_key");
    }
    return full;
  }

  async put(key: string, body: Buffer): Promise<string> {
    const full = this.resolveKey(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
    return key;
  }

  async signedUrl(key: string): Promise<string> {
    this.resolveKey(key); // validate even if we only build a URL
    // The API serves stored files at `${FILES_PUBLIC_URL}/<key>`.
    return this.publicBase ? `${this.publicBase}/${key}` : `local://${key}`;
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolveKey(key));
    } catch {
      return null;
    }
  }
}
