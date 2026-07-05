import { S3Client } from '@aws-sdk/client-s3';

// Cloudflare R2 is S3-compatible, so the AWS SDK works against it unmodified —
// just point it at the account's R2 endpoint instead of an AWS region.
// Serverless functions have a read-only filesystem outside /tmp, so
// attachments live here rather than on local disk.
const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;

if (!ACCOUNT_ID || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) {
  console.error('[R2] R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, or R2_SECRET_ACCESS_KEY not set — attachment storage will fail.');
}

export const r2 = new S3Client({
  region: 'auto',
  endpoint: ACCOUNT_ID ? `https://${ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined,
  credentials: {
    accessKeyId: ACCESS_KEY_ID ?? '',
    secretAccessKey: SECRET_ACCESS_KEY ?? '',
  },
  // R2 needs path-style addressing (bucket in the URL path), not S3's
  // virtual-hosted-style (bucket as a subdomain) — and doesn't support the
  // request/response checksum headers newer AWS SDK versions send by default.
  forcePathStyle: true,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

export const ATTACHMENTS_BUCKET = process.env.R2_BUCKET || 'latech';
