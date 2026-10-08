/**
 * Images: visitors' photos and agents' illustrations (AGENTS.md, invariant 19). Every upload is
 * re-encoded by the Images binding to WebP, which drops every bit of metadata, GPS included, in two
 * sizes; only those are written to R2, never the bytes that were sent.
 *
 *   photos/{id}/full.webp, thumb.webp           a visitor's photo
 *   illustrations/{id}/full.webp, thumb.webp    an agent's illustration
 *
 * An object never moves: whether it is public is its record's status, checked when it is served
 * (one row, behind the edge cache). Pending images are served only to the maintainer holding their
 * task and to the admin.
 */

import { HttpError } from './types';

export type MediaKind = 'photo' | 'illustration';

export const PREFIX: Record<MediaKind, string> = { photo: 'photos', illustration: 'illustrations' };

export interface ImageRules {
  /** Accepted input formats, as the Images binding names them. */
  formats: readonly string[];
  /** Smallest shorter side, in pixels. */
  minSide: number;
  /** Width and height ratio bounds, when the shape matters. */
  aspect?: { min: number; max: number };
  /** Longest side of each stored size. */
  sizes: { full: number; thumb: number };
  /** WebP quality. */
  quality: number;
}

export const PHOTO_RULES: ImageRules = {
  formats: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'image/avif'],
  minSide: 400,
  sizes: { full: 1600, thumb: 480 },
  quality: 82,
};

export const ILLUSTRATION_RULES: ImageRules = {
  formats: ['image/jpeg', 'image/png', 'image/webp'],
  minSide: 768,
  aspect: { min: 0.8, max: 1.25 },
  sizes: { full: 768, thumb: 256 },
  quality: 84,
};

export interface Encoded {
  full: Uint8Array;
  thumb: Uint8Array;
  /** The stored full size's dimensions. */
  width: number;
  height: number;
}

const bytesOf = async (stream: ReadableStream<Uint8Array>): Promise<Uint8Array> => new Uint8Array(await new Response(stream).arrayBuffer());

/** The dimensions an image takes when scaled down to fit a square of `side`. */
export function scaledDown(width: number, height: number, side: number): { width: number; height: number } {
  const scale = Math.min(1, side / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Checks an upload against the rules and re-encodes it into the stored sizes. Errors say what to
 * change. `info` is free; each transformation is billed, so it runs only for a file that passed.
 */
export async function encodeImage(images: ImagesBinding, file: Blob, rules: ImageRules): Promise<Encoded> {
  let info: ImageInfoResponse;
  try {
    info = await images.info(file.stream());
  } catch {
    throw new HttpError(422, 'not_an_image', 'The file is not an image this site can read. Send a JPEG, PNG or WebP.');
  }
  if (!('width' in info) || !rules.formats.includes(info.format)) {
    throw new HttpError(422, 'invalid_image', `The image must be one of ${rules.formats.map((format) => format.replace('image/', '')).join(', ')}; got ${info.format}.`);
  }
  if (Math.min(info.width, info.height) < rules.minSide) {
    throw new HttpError(422, 'invalid_image', `The image must be at least ${rules.minSide} pixels on its shorter side; it is ${info.width} by ${info.height}.`);
  }
  if (rules.aspect) {
    const ratio = info.width / info.height;
    if (ratio < rules.aspect.min || ratio > rules.aspect.max) {
      throw new HttpError(422, 'invalid_image', `The image must be close to square (width to height between ${rules.aspect.min} and ${rules.aspect.max}); it is ${info.width} by ${info.height}.`);
    }
  }
  const output = { format: 'image/webp' as const, quality: rules.quality, anim: false };
  const full = await bytesOf(
    (await images.input(file.stream()).transform({ width: rules.sizes.full, height: rules.sizes.full, fit: 'scale-down' }).output(output)).image(),
  );
  const thumb = await bytesOf(
    (await images.input(new Blob([full]).stream()).transform({ width: rules.sizes.thumb, height: rules.sizes.thumb, fit: 'scale-down' }).output(output)).image(),
  );
  return { full, thumb, ...scaledDown(info.width, info.height, rules.sizes.full) };
}

export const keyOf = (kind: MediaKind, id: string, size: 'full' | 'thumb') => `${PREFIX[kind]}/${id}/${size}.webp`;

export async function storeImage(bucket: R2Bucket, kind: MediaKind, id: string, encoded: Encoded): Promise<void> {
  const httpMetadata = { contentType: 'image/webp' };
  await Promise.all([
    bucket.put(keyOf(kind, id, 'full'), encoded.full, { httpMetadata }),
    bucket.put(keyOf(kind, id, 'thumb'), encoded.thumb, { httpMetadata }),
  ]);
}

export async function deleteImage(bucket: R2Bucket, kind: MediaKind, id: string): Promise<void> {
  await bucket.delete([keyOf(kind, id, 'full'), keyOf(kind, id, 'thumb')]);
}

/** An image from R2 as a response, or null when it is not there. */
export async function imageResponse(bucket: R2Bucket, kind: MediaKind, id: string, size: 'full' | 'thumb', cacheControl: string): Promise<Response | null> {
  const object = await bucket.get(keyOf(kind, id, size));
  if (!object) return null;
  return new Response(object.body, {
    headers: {
      'content-type': 'image/webp',
      'cache-control': cacheControl,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    },
  });
}

/**
 * The same image as JPEG, for agents whose image tools do not read WebP. The Images binding writes
 * it without metadata ('none' is the default for every format but JPEG, so it is asked for here).
 */
export async function asJpeg(images: ImagesBinding, response: Response): Promise<Response> {
  const result = await images.input(response.body!).output({ format: 'image/jpeg', quality: 85 });
  return new Response(result.image(), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}
