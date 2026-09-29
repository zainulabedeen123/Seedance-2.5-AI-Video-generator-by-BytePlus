import { NextResponse } from "next/server";
import { getVideoTask, ByteplusApiError } from "@/lib/byteplus";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Missing task id." }, { status: 400 });
  }

  try {
    const status = await getVideoTask(id);
    return NextResponse.json(status);
  } catch (err) {
    if (err instanceof ByteplusApiError) {
      return NextResponse.json({ error: err.message, details: err.data }, { status: err.status || 502 });
    }
    console.error("Unexpected error polling BytePlus video task", err);
    return NextResponse.json({ error: "Unexpected error checking task status." }, { status: 500 });
  }
}
