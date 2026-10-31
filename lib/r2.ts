/** Private R2 S3 adapter. Never import this module in client components. */
import { createReadStream, createWriteStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import {
  AbortMultipartUploadCommand, CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand, DeleteObjectCommand, GetObjectCommand,
  HeadObjectCommand, ListPartsCommand, PutObjectCommand, S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { r2Config, type R2Config } from './r2-config.ts';

export type R2Part = { partNumber: number; etag: string };
export type R2ListedPart = R2Part & { bytes: number };
export type R2Object = { bytes: number; etag: string | null };

type Sender = Pick<S3Client, 'send'>;

export class R2Storage {
  private readonly client: Sender;
  private readonly config: R2Config;
  constructor(config: R2Config, client?: Sender) {
    this.config = config;
    this.client = client ?? new S3Client({ region: 'auto', endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } });
  }

  async createMultipart(key: string, contentType: string): Promise<string> {
    const result = await this.client.send(new CreateMultipartUploadCommand({
      Bucket: this.config.bucket, Key: key, ContentType: contentType,
    }));
    if (!result.UploadId) throw new Error('R2 did not start the multipart upload.');
    return result.UploadId;
  }

  async signPart(key: string, uploadId: string, partNumber: number, expiresIn = 300): Promise<string> {
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
      throw new Error('Invalid upload part number.');
    }
    return getSignedUrl(this.client as S3Client, new UploadPartCommand({
      Bucket: this.config.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber,
    }), { expiresIn });
  }

  async listParts(key: string, uploadId: string): Promise<R2ListedPart[]> {
    const all: R2ListedPart[] = [];
    let marker: string | undefined;
    do {
      const result = await this.client.send(new ListPartsCommand({
        Bucket: this.config.bucket, Key: key, UploadId: uploadId,
        PartNumberMarker: marker,
      }));
      for (const part of result.Parts ?? []) {
        if (part.PartNumber && part.ETag && Number.isSafeInteger(part.Size)) {
          all.push({ partNumber: part.PartNumber, etag: part.ETag, bytes: part.Size! });
        }
      }
      marker = result.IsTruncated ? result.NextPartNumberMarker : undefined;
      if (result.IsTruncated && !marker) throw new Error('R2 returned an incomplete parts list.');
    } while (marker);
    return all;
  }

  async complete(key: string, uploadId: string, parts: R2Part[]): Promise<void> {
    const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    if (ordered.length === 0 || ordered.some((part, i) =>
      part.partNumber !== i + 1 || !part.etag || /[\r\n]/.test(part.etag))) {
      throw new Error('Multipart upload has missing or duplicate parts.');
    }
    const result = await this.client.send(new CompleteMultipartUploadCommand({
      Bucket: this.config.bucket, Key: key, UploadId: uploadId,
      MultipartUpload: { Parts: ordered.map(part => ({ PartNumber: part.partNumber, ETag: part.etag })) },
    }));
    if (!result.ETag) throw new Error('R2 did not confirm the completed upload.');
  }

  async abort(key: string, uploadId: string): Promise<void> {
    await this.client.send(new AbortMultipartUploadCommand({
      Bucket: this.config.bucket, Key: key, UploadId: uploadId,
    }));
  }

  async head(key: string): Promise<R2Object | null> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return Number.isSafeInteger(result.ContentLength) && result.ContentLength! > 0
        ? { bytes: result.ContentLength!, etag: result.ETag ?? null } : null;
    } catch (error) {
      if (error && typeof error === 'object' && 'name' in error &&
        ['NotFound', 'NoSuchKey'].includes(String(error.name))) return null;
      throw error;
    }
  }

  async putFile(key: string, file: string, contentType: string): Promise<number> {
    const size = (await stat(file)).size;
    if (size <= 0) throw new Error('Cannot archive an empty media object.');
    await this.client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: key,
      Body: createReadStream(file), ContentLength: size, ContentType: contentType }));
    return size;
  }

  async downloadFile(key: string, target: string): Promise<number> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
    if (!result.Body) throw new Error('R2 returned an empty media object.');
    try {
      await pipeline(result.Body as NodeJS.ReadableStream, createWriteStream(target));
      const bytes = (await stat(target)).size;
      if (!bytes) throw new Error('R2 returned an empty media object.');
      return bytes;
    } catch (error) {
      await rm(target, { force: true }).catch(() => {});
      throw error;
    }
  }

  async signedGet(key: string, expiresIn = 300): Promise<string> {
    return getSignedUrl(this.client as S3Client,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }), { expiresIn });
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }
}

export function r2Storage(): R2Storage | null {
  const config = r2Config();
  return config ? new R2Storage(config) : null;
}
