import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { providers } from "@cutz/providers";
import { authorize } from "../../plugins/auth.js";
import { audit } from "../../lib/audit.js";
import { prisma } from "@cutz/db";

const MIME_EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export default async function mediaRoutes(app: FastifyInstance) {
  app.post("/media", { preHandler: authorize("OWNER", "ADMIN", "MANAGER", "RECEPTION", "STAFF") }, async (req, reply) => {
    const body = z.object({ purpose: z.enum(["attendance-selfie", "vendor-bill", "inbox", "campaign"]), contentType: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]), base64: z.string().min(4).regex(/^[A-Za-z0-9+/]+={0,2}$/), consent: z.boolean().optional() }).parse(req.body);
    if (body.purpose === "attendance-selfie" && body.consent !== true) return reply.code(400).send({ error: "explicit_consent_required" });
    if (body.purpose === "attendance-selfie" && body.contentType === "application/pdf") return reply.code(400).send({ error: "selfie_must_be_image" });
    let bytes: Buffer;
    try { bytes = Buffer.from(body.base64, "base64"); } catch { return reply.code(400).send({ error: "invalid_base64" }); }
    if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) return reply.code(413).send({ error: "upload_too_large", maxBytes: MAX_UPLOAD_BYTES });
    const signatures: Record<string, (buffer: Buffer) => boolean> = {
      "image/jpeg": buffer => buffer[0] === 0xff && buffer[1] === 0xd8,
      "image/png": buffer => buffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
      "image/webp": buffer => buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP",
      "application/pdf": buffer => buffer.subarray(0, 5).toString() === "%PDF-",
    };
    if (!signatures[body.contentType]?.(bytes)) return reply.code(400).send({ error: "content_signature_mismatch" });
    const key = `${body.purpose}/${req.user!.id}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${MIME_EXTENSIONS[body.contentType]}`;
    await providers.storage().put(key, bytes, body.contentType);
    await audit("media.upload", "Media", key, { actorUserId: req.user?.id, after: { purpose: body.purpose, contentType: body.contentType, sizeBytes: bytes.length }, ip: req.ip });
    return reply.code(201).send({ key, url: await providers.storage().signedUrl(key, 900), expiresIn: 900 });
  });

  app.get("/media/url", { preHandler: authorize("OWNER", "ADMIN", "MANAGER", "RECEPTION", "STAFF", "CUSTOMER") }, async (req, reply) => {
    const { key } = z.object({ key: z.string().min(3).max(512).regex(/^[a-zA-Z0-9/_\-.]+$/) }).parse(req.query);
    if (req.user?.role === "CUSTOMER") {
      const customer = await prisma.customer.findUnique({ where: { userId: req.user.id }, select: { id: true } });
      const invoice = customer ? await prisma.invoice.findFirst({ where: { customerId: customer.id, pdfUrl: key }, select: { id: true } }) : null;
      if (!invoice) return reply.code(403).send({ error: "forbidden" });
    } else if (!["OWNER", "ADMIN"].includes(req.user!.role)) {
      const ownObject = key.split("/")[1] === req.user!.id;
      if (req.user!.role === "STAFF" && !ownObject) return reply.code(403).send({ error: "forbidden" });
      if (!ownObject) {
        const scopedInvoice = req.user!.branchId
          ? await prisma.invoice.findFirst({ where: { branchId: req.user!.branchId, pdfUrl: key }, select: { id: true } })
          : null;
        const objectOwnerId = key.startsWith("attendance-selfie/") ? key.split("/")[1] : undefined;
        const scopedSelfie = objectOwnerId && req.user!.branchId
          ? await prisma.staff.findFirst({ where: { userId: objectOwnerId, branchId: req.user!.branchId, deletedAt: null }, select: { id: true } })
          : null;
        if (!scopedInvoice && !scopedSelfie) return reply.code(403).send({ error: "forbidden" });
      }
    }
    return { url: await providers.storage().signedUrl(key, 300), expiresIn: 300 };
  });
}
