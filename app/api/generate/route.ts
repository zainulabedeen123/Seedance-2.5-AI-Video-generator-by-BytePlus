import { NextResponse } from "next/server";
import {
  createVideoTask,
  ByteplusApiError,
  type Resolution,
  type AspectRatio,
  type OutputFormat,
} from "@/lib/byteplus";

interface GenerateRequestBody {
  prompt?: string;
  model?: string;
  imageUrl?: string;
  resolution?: Resolution;
  ratio?: AspectRatio;
  duration?: number | string;
  seed?: number | string;
  watermark?: boolean;
  cameraFixed?: boolean;
  generateAudio?: boolean;
  outputFormat?: OutputFormat;
  returnLastFrame?: boolean;
  priority?: number | string;
}

export async function POST(request: Request) {
  let body: GenerateRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ error: "A prompt is required." }, { status: 400 });
  }

  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model) {
    return NextResponse.json(
      { error: "A model id is required. Copy the exact Seedance model id from your BytePlus ModelArk console." },
      { status: 400 }
    );
  }

  const duration = body.duration !== undefined && body.duration !== "" ? Number(body.duration) : undefined;
  const seed = body.seed !== undefined && body.seed !== "" ? Number(body.seed) : undefined;
  const priority =
    body.priority !== undefined && body.priority !== "" ? Number(body.priority) : undefined;

  try {
    const { id } = await createVideoTask({
      model,
      prompt,
      imageUrl: body.imageUrl || undefined,
      resolution: body.resolution || undefined,
      ratio: body.ratio || undefined,
      duration,
      seed,
      watermark: typeof body.watermark === "boolean" ? body.watermark : undefined,
      cameraFixed: typeof body.cameraFixed === "boolean" ? body.cameraFixed : undefined,
      generateAudio: typeof body.generateAudio === "boolean" ? body.generateAudio : undefined,
      outputFormat: body.outputFormat || undefined,
      returnLastFrame: typeof body.returnLastFrame === "boolean" ? body.returnLastFrame : undefined,
      priority,
    });

    return NextResponse.json({ id });
  } catch (err) {
    if (err instanceof ByteplusApiError) {
      return NextResponse.json({ error: err.message, details: err.data }, { status: err.status || 502 });
    }
    console.error("Unexpected error creating BytePlus video task", err);
    return NextResponse.json({ error: "Unexpected error creating the video task." }, { status: 500 });
  }
}
