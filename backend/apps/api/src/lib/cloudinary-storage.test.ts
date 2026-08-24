import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudinaryStorageProvider } from "@cutz/providers";

const originalEnv = {
  cloudName: process.env.CLOUDINARY_CLOUD_NAME,
  apiKey: process.env.CLOUDINARY_API_KEY,
  apiSecret: process.env.CLOUDINARY_API_SECRET,
  folder: process.env.CLOUDINARY_FOLDER,
};

beforeEach(() => {
  process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
  process.env.CLOUDINARY_API_KEY = "test-api-key";
  process.env.CLOUDINARY_API_SECRET = "test-api-secret";
  process.env.CLOUDINARY_FOLDER = "private-salon";
});

afterEach(() => {
  vi.useRealTimers();
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  restore("CLOUDINARY_CLOUD_NAME", originalEnv.cloudName);
  restore("CLOUDINARY_API_KEY", originalEnv.apiKey);
  restore("CLOUDINARY_API_SECRET", originalEnv.apiSecret);
  restore("CLOUDINARY_FOLDER", originalEnv.folder);
});

describe("Cloudinary storage privacy", () => {
  it("removes a legacy public twin and uploads the replacement as authenticated raw media", async () => {
    const chunks: Buffer[] = [];
    const destroy = vi.fn().mockResolvedValue({ result: "not found" });
    const uploadStream = vi.fn((options: unknown, callback: (error?: unknown, result?: unknown) => void) => {
      const stream = new PassThrough();
      stream.on("data", chunk => chunks.push(Buffer.from(chunk)));
      stream.on("finish", () => callback(undefined, { public_id: "private-salon/invoices/INV-1.pdf" }));
      return stream;
    });
    const client = {
      config: vi.fn(),
      uploader: { destroy, upload_stream: uploadStream },
      utils: { private_download_url: vi.fn() },
    };
    const provider = new CloudinaryStorageProvider(client as never);

    await expect(provider.put("invoices/INV-1.pdf", Buffer.from("private-pdf"), "application/pdf"))
      .resolves.toBe("invoices/INV-1.pdf");

    expect(destroy).toHaveBeenCalledWith("private-salon/invoices/INV-1.pdf", {
      resource_type: "raw",
      type: "upload",
      invalidate: true,
    });
    expect(uploadStream).toHaveBeenCalledWith(expect.objectContaining({
      resource_type: "raw",
      type: "authenticated",
      public_id: "private-salon/invoices/INV-1.pdf",
      overwrite: true,
      invalidate: true,
    }), expect.any(Function));
    expect(Buffer.concat(chunks).toString()).toBe("private-pdf");
  });

  it("generates an expiring authenticated download URL instead of a public delivery URL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T12:00:00.000Z"));
    const privateDownloadUrl = vi.fn().mockReturnValue("https://api.cloudinary.com/v1_1/test-cloud/raw/download?signed=opaque");
    const client = {
      config: vi.fn(),
      uploader: { destroy: vi.fn(), upload_stream: vi.fn() },
      utils: { private_download_url: privateDownloadUrl },
    };
    const provider = new CloudinaryStorageProvider(client as never);

    const url = await provider.signedUrl("invoices/INV-1.pdf", 600);

    expect(privateDownloadUrl).toHaveBeenCalledWith("private-salon/invoices/INV-1.pdf", "pdf", {
      resource_type: "raw",
      type: "authenticated",
      expires_at: Math.floor(Date.now() / 1000) + 600,
      attachment: false,
    });
    expect(url).not.toContain("/raw/upload/");
    await expect(provider.signedUrl("invoices/INV-1.pdf", 3_601)).rejects.toThrow("invalid_storage_url_expiry");
  });

  it("fails closed with a redacted error if a legacy public twin cannot be removed", async () => {
    const client = {
      config: vi.fn(),
      uploader: {
        destroy: vi.fn().mockRejectedValue(new Error("provider response with request details")),
        upload_stream: vi.fn(),
      },
      utils: { private_download_url: vi.fn() },
    };
    const provider = new CloudinaryStorageProvider(client as never);

    await expect(provider.put("invoices/INV-2.pdf", Buffer.from("private-pdf"), "application/pdf"))
      .rejects.toThrow("cloudinary_legacy_cleanup_failed");
    expect(client.uploader.upload_stream).not.toHaveBeenCalled();
  });
});
