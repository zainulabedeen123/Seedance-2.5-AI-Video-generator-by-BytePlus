// Thin server-side client for the BytePlus ModelArk video generation API (Dreamina Seedance 2.5 and
// the Seedance 2.0/1.x family). Only import this from Route Handlers / server code — it reads the
// secret API key from process.env and must never be bundled into client JavaScript.
//
// Field names and behavior here are taken directly from BytePlus's own docs, read on 2026-09-29:
//   - Create a video generation task: https://docs.byteplus.com/en/docs/modelark/create-video-generation-task-api
//   - Retrieve a video generation task: https://docs.byteplus.com/en/docs/modelark/get-video-generation-task-api
//   - Dreamina Seedance 2.5 tutorial:  https://docs.byteplus.com/en/docs/modelark/seedance-2-5
//
// The API is a create-then-poll pattern: POST .../contents/generations/tasks returns a task id
// immediately, then GET .../contents/generations/tasks/{id} is polled until status is a terminal
// value. Parameters can be passed two ways — "conventional" (top-level JSON fields, strictly
// validated, recommended) or "legacy" (appended as --flags on the text prompt, weakly validated).
// This client always uses the conventional method.

const BASE_URL = (
  process.env.BYTEPLUS_API_BASE_URL || "https://ark.ap-southeast.bytepluses.com/api/v3"
).replace(/\/+$/, "");

export class ByteplusApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = "ByteplusApiError";
    this.status = status;
    this.data = data;
  }
}

function getApiKey(): string {
  const key = process.env.BYTEPLUS_API_KEY;
  if (!key) {
    throw new ByteplusApiError(
      "Missing BYTEPLUS_API_KEY. Add it to .env.local and restart the dev server.",
      500,
      null
    );
  }
  return key;
}

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    "Content-Type": "application/json",
  };
}

// Per docs: "error.code" / "error.message" on both the GET response and the create-time error body.
function extractErrorMessage(status: number, data: unknown): string {
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    const err = d.error;
    if (err && typeof err === "object") {
      const e = err as Record<string, unknown>;
      if (typeof e.message === "string") return e.message;
      if (typeof e.code === "string") return e.code;
    }
    if (typeof d.message === "string") return d.message;
  }
  return `BytePlus request failed with status ${status}`;
}

export type Resolution = "480p" | "720p" | "1080p" | "4k";
export type AspectRatio = "16:9" | "4:3" | "1:1" | "3:4" | "9:16" | "21:9" | "adaptive";
export type OutputFormat = "mp4" | "mov";

export interface CreateVideoTaskInput {
  model: string;
  prompt: string;
  /** Reference image for image-to-video. Sent as content[].image_url with role "first_frame". */
  imageUrl?: string;
  resolution?: Resolution;
  ratio?: AspectRatio;
  /** Seconds, or -1 to let the model choose (Seedance 2.5/2.0 default). */
  duration?: number;
  /** Only supported by Seedance 1.0 pro / 1.0 pro fast per the docs; other models may ignore it. */
  seed?: number;
  watermark?: boolean;
  cameraFixed?: boolean;
  /** Default true. Supported by Seedance 2.5, 2.0 series, and 1.5 pro. */
  generateAudio?: boolean;
  /** Seedance 2.5 only. */
  outputFormat?: OutputFormat;
  /** Seedance 2.5 series only; jpeg last frame returned as content.last_frame_url. */
  returnLastFrame?: boolean;
  /** 0-9, higher runs first. Supported by Seedance 2.5 and 2.0 series. */
  priority?: number;
  callbackUrl?: string;
}

export interface CreateVideoTaskResult {
  id: string;
  raw: unknown;
}

export async function createVideoTask(
  input: CreateVideoTaskInput
): Promise<CreateVideoTaskResult> {
  const content: Array<Record<string, unknown>> = [{ type: "text", text: input.prompt }];

  if (input.imageUrl) {
    content.push({
      type: "image_url",
      image_url: { url: input.imageUrl },
      role: "first_frame",
    });
  }

  const body: Record<string, unknown> = { model: input.model, content };

  if (input.resolution) body.resolution = input.resolution;
  if (input.ratio) body.ratio = input.ratio;
  if (typeof input.duration === "number" && !Number.isNaN(input.duration)) {
    body.duration = input.duration;
  }
  if (typeof input.seed === "number" && !Number.isNaN(input.seed)) {
    body.seed = input.seed;
  }
  if (typeof input.watermark === "boolean") body.watermark = input.watermark;
  if (typeof input.cameraFixed === "boolean") body.camera_fixed = input.cameraFixed;
  if (typeof input.generateAudio === "boolean") body.generate_audio = input.generateAudio;
  if (input.outputFormat) body.output_format = input.outputFormat;
  if (typeof input.returnLastFrame === "boolean") body.return_last_frame = input.returnLastFrame;
  if (typeof input.priority === "number" && !Number.isNaN(input.priority)) {
    body.priority = input.priority;
  }
  if (input.callbackUrl) body.callback_url = input.callbackUrl;

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/contents/generations/tasks`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (err) {
    throw new ByteplusApiError(
      `Could not reach BytePlus (${err instanceof Error ? err.message : "network error"}).`,
      502,
      null
    );
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ByteplusApiError(extractErrorMessage(res.status, data), res.status, data);
  }

  // Docs: the create response body is just `{ "id": "..." }`.
  const id = data && typeof data === "object" ? (data as Record<string, unknown>).id : undefined;

  if (typeof id !== "string" || !id) {
    throw new ByteplusApiError(
      "BytePlus accepted the request but the response didn't include a task id.",
      502,
      data
    );
  }

  return { id, raw: data };
}

// Docs list exactly these five terminal/non-terminal values for the GET response's `status` field.
// "expired" only appears as a possible *callback* status (a task that timed out while queued/running),
// so it's kept here defensively in case a given account/model surfaces it the same way when polled.
export type NormalizedStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "expired"
  | "unknown";

function normalizeStatus(status: unknown): NormalizedStatus {
  const s = typeof status === "string" ? status.toLowerCase() : "";
  switch (s) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "expired":
      return "expired";
    default:
      return "unknown";
  }
}

export interface VideoTaskStatus {
  id: string;
  status: NormalizedStatus;
  rawStatus: unknown;
  /** content.video_url — valid for 24h, downloadable up to 100 times on Seedance 2.5. */
  videoUrl: string | null;
  /** content.last_frame_url — only present if return_last_frame was set on create. */
  lastFrameUrl: string | null;
  errorMessage: string | null;
  raw: unknown;
}

export async function getVideoTask(id: string): Promise<VideoTaskStatus> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/contents/generations/tasks/${encodeURIComponent(id)}`, {
      headers: authHeaders(),
      cache: "no-store",
    });
  } catch (err) {
    throw new ByteplusApiError(
      `Could not reach BytePlus (${err instanceof Error ? err.message : "network error"}).`,
      502,
      null
    );
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ByteplusApiError(extractErrorMessage(res.status, data), res.status, data);
  }

  const record = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const status = normalizeStatus(record.status);

  const content = record.content as Record<string, unknown> | undefined;
  const videoUrl = content && typeof content.video_url === "string" ? content.video_url : null;
  const lastFrameUrl =
    content && typeof content.last_frame_url === "string" ? content.last_frame_url : null;

  let errorMessage: string | null = null;
  const err = record.error;
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    errorMessage =
      (typeof e.message === "string" && e.message) ||
      (typeof e.code === "string" && e.code) ||
      "Video generation failed.";
  } else if (status === "failed") {
    errorMessage = "Video generation failed.";
  }

  return {
    id,
    status,
    rawStatus: record.status,
    videoUrl,
    lastFrameUrl,
    errorMessage,
    raw: data,
  };
}
