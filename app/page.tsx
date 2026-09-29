"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Resolution = "480p" | "720p" | "1080p";
type AspectRatio = "adaptive" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16" | "21:9";
type OutputFormat = "mp4" | "mov";

type RunStatus =
  | "idle"
  | "submitting"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "expired"
  | "cancelled";

interface HistoryEntry {
  id: string;
  prompt: string;
  status: RunStatus;
  videoUrl: string | null;
  lastFrameUrl: string | null;
}

// Values below are taken directly from BytePlus's own docs (read 2026-09-29):
// https://docs.byteplus.com/en/docs/modelark/create-video-generation-task-api
// https://docs.byteplus.com/en/docs/modelark/seedance-2-5
const RATIOS: AspectRatio[] = ["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"];
const RESOLUTIONS: Resolution[] = ["480p", "720p", "1080p"];
const OUTPUT_FORMATS: OutputFormat[] = ["mp4", "mov"];
const POLL_INTERVAL_MS = 4000;

const DEFAULT_MODEL = process.env.NEXT_PUBLIC_BYTEPLUS_DEFAULT_MODEL ?? "";

function statusLabel(status: RunStatus): string {
  switch (status) {
    case "idle":
      return "Ready";
    case "submitting":
      return "Submitting…";
    case "queued":
      return "Queued";
    case "running":
      return "Rendering…";
    case "succeeded":
      return "Done";
    case "failed":
      return "Failed";
    case "expired":
      return "Expired";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

function statusColor(status: RunStatus): string {
  switch (status) {
    case "succeeded":
      return "bg-emerald-500";
    case "failed":
    case "expired":
    case "cancelled":
      return "bg-red-500";
    case "idle":
      return "bg-zinc-400";
    default:
      return "bg-amber-500";
  }
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [resolution, setResolution] = useState<Resolution>("720p");
  const [ratio, setRatio] = useState<AspectRatio>("adaptive");
  const [autoDuration, setAutoDuration] = useState(true);
  const [duration, setDuration] = useState(5);
  const [seed, setSeed] = useState("");
  const [watermark, setWatermark] = useState(false);
  const [cameraFixed, setCameraFixed] = useState(false);
  const [generateAudio, setGenerateAudio] = useState(true);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("mp4");
  const [returnLastFrame, setReturnLastFrame] = useState(false);
  const [priority, setPriority] = useState(0);
  const [imageUrl, setImageUrl] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [taskId, setTaskId] = useState<string | null>(null);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [lastFrameUrl, setLastFrameUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    pollRef.current = null;
    tickRef.current = null;
  }, []);

  const handleCopyTaskId = useCallback(async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can fail (e.g. insecure context); the id is still visible to copy by hand.
    }
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const isBusy = status === "submitting" || status === "queued" || status === "running";

  const updateHistory = useCallback((id: string, patch: Partial<HistoryEntry>) => {
    setHistory((prev) => prev.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  }, []);

  const pollTask = useCallback(
    (id: string) => {
      clearTimers();

      tickRef.current = setInterval(() => setNow(Date.now()), 1000);

      const check = async () => {
        try {
          const res = await fetch(`/api/status/${id}`, { cache: "no-store" });
          const data = await res.json();

          if (!res.ok) {
            setError(data?.error || "Failed to check generation status.");
            setStatus("failed");
            updateHistory(id, { status: "failed" });
            clearTimers();
            return;
          }

          const nextStatus = data.status as RunStatus;
          setStatus(nextStatus);

          if (nextStatus === "succeeded") {
            setVideoUrl(data.videoUrl);
            setLastFrameUrl(data.lastFrameUrl ?? null);
            updateHistory(id, {
              status: "succeeded",
              videoUrl: data.videoUrl,
              lastFrameUrl: data.lastFrameUrl ?? null,
            });
            clearTimers();
          } else if (nextStatus === "failed" || nextStatus === "expired" || nextStatus === "cancelled") {
            setError(data.errorMessage || "Video generation did not succeed.");
            updateHistory(id, { status: nextStatus });
            clearTimers();
          }
        } catch {
          setError("Lost connection while checking generation status.");
          setStatus("failed");
          clearTimers();
        }
      };

      check();
      pollRef.current = setInterval(check, POLL_INTERVAL_MS);
    },
    [clearTimers, updateHistory]
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || !model.trim() || isBusy) return;

    setError(null);
    setVideoUrl(null);
    setLastFrameUrl(null);
    setTaskId(null);
    setCopied(false);
    setStatus("submitting");
    setStartedAt(Date.now());
    setNow(Date.now());

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          model: model.trim(),
          resolution,
          ratio,
          duration: autoDuration ? -1 : duration,
          seed: seed === "" ? undefined : Number(seed),
          watermark,
          cameraFixed,
          generateAudio,
          outputFormat,
          returnLastFrame,
          priority,
          imageUrl: imageUrl.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data?.error || "Failed to submit the generation request.");
        setStatus("failed");
        return;
      }

      setTaskId(data.id);
      setStatus("queued");
      setHistory((prev) => [
        { id: data.id, prompt: prompt.trim(), status: "queued", videoUrl: null, lastFrameUrl: null },
        ...prev,
      ]);
      pollTask(data.id);
    } catch {
      setError("Could not reach the server. Is the dev server running?");
      setStatus("failed");
    }
  }

  const elapsed = startedAt && isBusy ? now - startedAt : null;

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-12 sm:px-10">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Seedance 2.5 Studio
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Text-to-video (and optional image-to-video) generation via the BytePlus ModelArk API.
          </p>
        </header>

        <div className="grid flex-1 grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* Form */}
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-5 rounded-2xl border border-black/[.08] bg-white p-6 dark:border-white/[.1] dark:bg-zinc-950"
          >
            <div className="flex flex-col gap-2">
              <label htmlFor="prompt" className="text-sm font-medium text-black dark:text-zinc-50">
                Prompt
              </label>
              <textarea
                id="prompt"
                required
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="A paper boat drifts across a quiet lake at sunrise, gentle ripples trailing behind it."
                className="resize-none rounded-lg border border-black/[.1] bg-transparent px-3 py-2 text-sm text-black outline-none focus:border-black/40 dark:border-white/[.15] dark:text-zinc-50 dark:focus:border-white/40"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="model" className="text-sm font-medium text-black dark:text-zinc-50">
                Model ID
              </label>
              <input
                id="model"
                required
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="dreamina-seedance-2-5-260628"
                className="rounded-lg border border-black/[.1] bg-transparent px-3 py-2 font-mono text-sm text-black outline-none focus:border-black/40 dark:border-white/[.15] dark:text-zinc-50 dark:focus:border-white/40"
              />
              <p className="text-xs text-zinc-500 dark:text-zinc-500">
                Current ModelArk ids: <code className="rounded bg-black/[.06] px-1 py-0.5 dark:bg-white/[.08]">dreamina-seedance-2-5-260628</code> (Seedance 2.5),{" "}
                <code className="rounded bg-black/[.06] px-1 py-0.5 dark:bg-white/[.08]">dreamina-seedance-2-0-260128</code> (2.0),{" "}
                <code className="rounded bg-black/[.06] px-1 py-0.5 dark:bg-white/[.08]">-fast-</code> / <code className="rounded bg-black/[.06] px-1 py-0.5 dark:bg-white/[.08]">-mini-</code> variants also available.
                Verify against your account&rsquo;s ModelArk console since BytePlus can roll out newer dated ids.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <label htmlFor="resolution" className="text-sm font-medium text-black dark:text-zinc-50">
                  Resolution
                </label>
                <select
                  id="resolution"
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value as Resolution)}
                  className="rounded-lg border border-black/[.1] bg-transparent px-3 py-2 text-sm text-black outline-none focus:border-black/40 dark:border-white/[.15] dark:text-zinc-50 dark:focus:border-white/40"
                >
                  {RESOLUTIONS.map((r) => (
                    <option key={r} value={r} className="bg-white dark:bg-zinc-950">
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor="ratio" className="text-sm font-medium text-black dark:text-zinc-50">
                  Aspect ratio
                </label>
                <select
                  id="ratio"
                  value={ratio}
                  onChange={(e) => setRatio(e.target.value as AspectRatio)}
                  className="rounded-lg border border-black/[.1] bg-transparent px-3 py-2 text-sm text-black outline-none focus:border-black/40 dark:border-white/[.15] dark:text-zinc-50 dark:focus:border-white/40"
                >
                  {RATIOS.map((r) => (
                    <option key={r} value={r} className="bg-white dark:bg-zinc-950">
                      {r}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label htmlFor="duration" className="text-sm font-medium text-black dark:text-zinc-50">
                  Duration{autoDuration ? "" : `: ${duration}s`}
                </label>
                <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                  <input
                    type="checkbox"
                    checked={autoDuration}
                    onChange={(e) => setAutoDuration(e.target.checked)}
                    className="accent-black dark:accent-white"
                  />
                  Let the model choose (recommended)
                </label>
              </div>
              <input
                id="duration"
                type="range"
                min={4}
                max={30}
                step={1}
                value={duration}
                disabled={autoDuration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="accent-black disabled:opacity-40 dark:accent-white"
              />
            </div>

            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="self-start text-xs font-medium text-zinc-600 underline decoration-dotted underline-offset-4 hover:text-black dark:text-zinc-400 dark:hover:text-white"
            >
              {showAdvanced ? "Hide advanced options" : "Show advanced options"}
            </button>

            {showAdvanced && (
              <div className="flex flex-col gap-4 rounded-lg border border-black/[.08] p-4 dark:border-white/[.1]">
                <div className="flex flex-col gap-2">
                  <label htmlFor="imageUrl" className="text-sm font-medium text-black dark:text-zinc-50">
                    Reference image URL (image-to-video, optional)
                  </label>
                  <input
                    id="imageUrl"
                    type="url"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="https://example.com/first-frame.jpg"
                    className="rounded-lg border border-black/[.1] bg-transparent px-3 py-2 text-sm text-black outline-none focus:border-black/40 dark:border-white/[.15] dark:text-zinc-50 dark:focus:border-white/40"
                  />
                  <p className="text-xs text-zinc-500 dark:text-zinc-500">
                    Sent as the first-frame image. Note: with a reference image, most models force{" "}
                    <code className="rounded bg-black/[.06] px-1 py-0.5 dark:bg-white/[.08]">ratio=adaptive</code> to match it.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <label htmlFor="outputFormat" className="text-sm font-medium text-black dark:text-zinc-50">
                      Output format
                    </label>
                    <select
                      id="outputFormat"
                      value={outputFormat}
                      onChange={(e) => setOutputFormat(e.target.value as OutputFormat)}
                      className="rounded-lg border border-black/[.1] bg-transparent px-3 py-2 text-sm text-black outline-none focus:border-black/40 dark:border-white/[.15] dark:text-zinc-50 dark:focus:border-white/40"
                    >
                      {OUTPUT_FORMATS.map((f) => (
                        <option key={f} value={f} className="bg-white dark:bg-zinc-950">
                          {f}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-zinc-500 dark:text-zinc-500">mov is Seedance 2.5 only.</p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label htmlFor="priority" className="text-sm font-medium text-black dark:text-zinc-50">
                      Priority (0–9)
                    </label>
                    <input
                      id="priority"
                      type="number"
                      min={0}
                      max={9}
                      value={priority}
                      onChange={(e) => setPriority(Number(e.target.value))}
                      className="rounded-lg border border-black/[.1] bg-transparent px-3 py-2 text-sm text-black outline-none focus:border-black/40 dark:border-white/[.15] dark:text-zinc-50 dark:focus:border-white/40"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <label htmlFor="seed" className="text-sm font-medium text-black dark:text-zinc-50">
                    Seed (optional)
                  </label>
                  <input
                    id="seed"
                    type="number"
                    value={seed}
                    onChange={(e) => setSeed(e.target.value)}
                    placeholder="Leave blank to randomize"
                    className="rounded-lg border border-black/[.1] bg-transparent px-3 py-2 text-sm text-black outline-none focus:border-black/40 dark:border-white/[.15] dark:text-zinc-50 dark:focus:border-white/40"
                  />
                  <p className="text-xs text-zinc-500 dark:text-zinc-500">
                    Per BytePlus&rsquo;s docs, only confirmed for Seedance 1.5 pro / 1.0 pro / 1.0 pro fast — Seedance 2.5/2.0 may ignore it.
                  </p>
                </div>

                <label className="flex items-center gap-2 text-sm text-black dark:text-zinc-50">
                  <input
                    type="checkbox"
                    checked={generateAudio}
                    onChange={(e) => setGenerateAudio(e.target.checked)}
                    className="accent-black dark:accent-white"
                  />
                  Generate audio
                </label>

                <label className="flex items-center gap-2 text-sm text-black dark:text-zinc-50">
                  <input
                    type="checkbox"
                    checked={cameraFixed}
                    onChange={(e) => setCameraFixed(e.target.checked)}
                    className="accent-black dark:accent-white"
                  />
                  Keep camera fixed
                </label>

                <label className="flex items-center gap-2 text-sm text-black dark:text-zinc-50">
                  <input
                    type="checkbox"
                    checked={watermark}
                    onChange={(e) => setWatermark(e.target.checked)}
                    className="accent-black dark:accent-white"
                  />
                  Add watermark
                </label>

                <label className="flex items-center gap-2 text-sm text-black dark:text-zinc-50">
                  <input
                    type="checkbox"
                    checked={returnLastFrame}
                    onChange={(e) => setReturnLastFrame(e.target.checked)}
                    className="accent-black dark:accent-white"
                  />
                  Also return the last frame as an image
                </label>
              </div>
            )}

            <button
              type="submit"
              disabled={isBusy || !prompt.trim() || !model.trim()}
              className="mt-2 flex h-11 items-center justify-center rounded-full bg-black text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
            >
              {isBusy ? "Generating…" : "Generate video"}
            </button>
          </form>

          {/* Result */}
          <div className="flex flex-col gap-4">
            {taskId && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-black/[.08] bg-white px-4 py-3 dark:border-white/[.1] dark:bg-zinc-950">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
                    Task ID
                  </span>
                  <span className="truncate font-mono text-sm text-black dark:text-zinc-50">{taskId}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopyTaskId(taskId)}
                  className="shrink-0 rounded-full border border-black/[.1] px-3 py-1.5 text-xs font-medium text-black transition-colors hover:bg-black/[.04] dark:border-white/[.15] dark:text-zinc-50 dark:hover:bg-white/[.08]"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            )}

            <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-2xl border border-black/[.08] bg-white p-6 dark:border-white/[.1] dark:bg-zinc-950">
              {status === "idle" && !videoUrl && (
                <p className="text-center text-sm text-zinc-500 dark:text-zinc-500">
                  Your generated video will appear here.
                </p>
              )}

              {isBusy && (
                <div className="flex flex-col items-center gap-3">
                  <div className="h-10 w-10 animate-spin rounded-full border-2 border-black/20 border-t-black dark:border-white/20 dark:border-t-white" />
                  <p className="text-sm font-medium text-black dark:text-zinc-50">{statusLabel(status)}</p>
                  {elapsed !== null && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-500">{formatElapsed(elapsed)} elapsed</p>
                  )}
                </div>
              )}

              {status === "succeeded" && videoUrl && (
                <div className="flex w-full flex-col gap-3">
                  <video src={videoUrl} controls autoPlay loop className="w-full rounded-lg bg-black" />
                  <a
                    href={videoUrl}
                    download
                    className="text-sm font-medium text-black underline underline-offset-4 dark:text-zinc-50"
                  >
                    Download video
                  </a>
                  <p className="text-xs text-zinc-500 dark:text-zinc-500">
                    Link expires 24h after generation — download it if you want to keep it.
                  </p>
                  {lastFrameUrl && (
                    <div className="flex items-center gap-3 border-t border-black/[.08] pt-3 dark:border-white/[.1]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={lastFrameUrl} alt="Last frame" className="h-16 w-auto rounded border border-black/[.08] dark:border-white/[.1]" />
                      <a
                        href={lastFrameUrl}
                        download
                        className="text-xs font-medium text-black underline underline-offset-4 dark:text-zinc-50"
                      >
                        Download last frame
                      </a>
                    </div>
                  )}
                </div>
              )}

              {!isBusy && error && (
                <div className="flex flex-col items-center gap-2 text-center">
                  <span className="h-2 w-2 rounded-full bg-red-500" />
                  <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
                </div>
              )}
            </div>

            {history.length > 0 && (
              <div className="flex flex-col gap-2 rounded-2xl border border-black/[.08] bg-white p-4 dark:border-white/[.1] dark:bg-zinc-950">
                <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
                  This session
                </h2>
                <ul className="flex flex-col gap-1">
                  {history.map((entry) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        onClick={() => {
                          if (entry.videoUrl) {
                            setVideoUrl(entry.videoUrl);
                            setLastFrameUrl(entry.lastFrameUrl);
                            setStatus("succeeded");
                            setTaskId(entry.id);
                            setError(null);
                          }
                        }}
                        className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-black/[.03] dark:hover:bg-white/[.06]"
                      >
                        <span className={`h-2 w-2 shrink-0 rounded-full ${statusColor(entry.status)}`} />
                        <span className="flex-1 truncate text-sm text-black dark:text-zinc-50">
                          {entry.prompt}
                        </span>
                        <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-500">
                          {statusLabel(entry.status)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
