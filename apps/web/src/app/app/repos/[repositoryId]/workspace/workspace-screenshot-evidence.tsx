"use client";

import Image from "next/image";
import type { ScreenshotAsset } from "@nutshell/server/screenshot-assets";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { WorkspaceData } from "./workspace-data";
import "./workspace-screenshot-evidence.css";

type Change = WorkspaceData["changes"][number];
type Screenshot = Change["evidence"][number];
type ScreenshotResponse = { status: "ready"; asset: ScreenshotAsset };

const screenshotTypes = { png: "image/png", jpeg: "image/jpeg", jpg: "image/jpeg", webp: "image/webp" } as const;
const acceptedTypes: ReadonlySet<string> = new Set(Object.values(screenshotTypes));

function endpoint(repositoryId: string) {
  return `/api/repos/${encodeURIComponent(repositoryId)}/screenshots`;
}

function fileType(file: File) {
  if (file.type) return acceptedTypes.has(file.type) ? file.type : undefined;
  const suffix = file.name.split(".").at(-1)?.toLowerCase();
  return suffix && Object.hasOwn(screenshotTypes, suffix) ? screenshotTypes[suffix as keyof typeof screenshotTypes] : undefined;
}

async function uploadFailure(response: Response) {
  if (response.status === 400) {
    const result = await response.json().catch(() => null) as { message?: string } | null;
    if (result?.message) return result.message;
  }
  if (response.status === 403) return "Current write access is required to upload screenshots.";
  if (response.status === 404) return "Screenshot upload is unavailable.";
  if (response.status === 413) return "The screenshot exceeds the supported size.";
  if (response.status === 415) return "Choose a PNG, JPEG, or WebP screenshot.";
  return "Couldn’t upload the screenshot. Try again.";
}

export function WorkspaceScreenshotUpload({ repositoryId }: { repositoryId: string }) {
  const labelId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const copyInput = useRef<HTMLInputElement>(null);
  const request = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || request.current) return;
    const mime = fileType(file);
    if (!mime) {
      setError("Choose a PNG, JPEG, or WebP screenshot.");
      return;
    }
    request.current = true;
    setPending(true);
    setStatus("");
    setError("");
    try {
      const response = await fetch(endpoint(repositoryId), {
        method: "POST", headers: { "Content-Type": mime }, body: file, signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        setError(await uploadFailure(response));
        return;
      }
      const { asset } = await response.json() as ScreenshotResponse;
      setAssetId(asset.id);
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setStatus("Screenshot uploaded");
    } catch {
      setError("Couldn’t upload the screenshot. Try again.");
    } finally {
      request.current = false;
      setPending(false);
    }
  }

  async function copyAssetId() {
    if (!assetId) return;
    try {
      await navigator.clipboard.writeText(assetId);
      setStatus("Asset ID copied");
    } catch {
      copyInput.current?.focus();
      copyInput.current?.select();
      setStatus("Asset ID selected for copying");
    }
  }

  return <section className="workspace-screenshot-upload" aria-labelledby={labelId}>
    <h2 id={labelId}>Screenshot evidence</h2>
    <form onSubmit={(event) => void upload(event)}>
      <label>Screenshot file<input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,.png,.jpeg,.jpg,.webp"
        disabled={pending} onChange={(event) => { setFile(event.currentTarget.files?.[0] ?? null); setError(""); }} /></label>
      <button type="submit" disabled={!file || pending}>Upload screenshot</button>
    </form>
    {(pending || status) && <p role="status">{pending ? "Uploading screenshot…" : status}</p>}
    {error && <p role="alert">{error}</p>}
    {assetId && <>
      <div className="workspace-screenshot-upload-result">
        <label>Evidence asset ID<input ref={copyInput} readOnly value={assetId} /></label>
        <button type="button" onClick={() => void copyAssetId()}>Copy asset ID</button>
      </div>
      <p>Add this as <code>asset_id</code> in a change record under <code>.nutshell/changes/</code>.</p>
    </>}
  </section>;
}

function isMatchingFixtureCapture(shot: Screenshot, asset: ScreenshotAsset) {
  const declared = asset.declaration;
  return asset.provenance === "fixture_capture" && declared !== null && Boolean(shot.capture_ref) && asset.captureRef === shot.capture_ref &&
    declared.sourceRevision.toLowerCase() === shot.source_revision.toLowerCase() && declared.route === shot.route &&
    declared.state === shot.state && declared.environment === shot.environment && declared.viewport.width === shot.viewport.width &&
    declared.viewport.height === shot.viewport.height && declared.capturedAt === shot.captured_at;
}

function DeclaredScreenshot({ repositoryId, shot }: { repositoryId: string; shot: Screenshot }) {
  const [asset, setAsset] = useState<ScreenshotAsset | "unavailable" | null>(null);
  const [loaded, setLoaded] = useState(false);
  const url = endpoint(repositoryId) + "/" + encodeURIComponent(shot.asset_id);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(url, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        if (!response.ok) throw new Error("Screenshot unavailable");
        const result = await response.json() as ScreenshotResponse;
        if (!controller.signal.aborted) setAsset(result.status === "ready" && result.asset.id === shot.asset_id ? result.asset : "unavailable");
      } catch {
        if (!controller.signal.aborted) setAsset("unavailable");
      }
    }
    void load();
    return () => controller.abort();
  }, [url, shot.asset_id]);

  const available = asset !== null && asset !== "unavailable";
  return <li className="workspace-declared-screenshot">
    <p>{loaded && available && isMatchingFixtureCapture(shot, asset) ? "Fixture capture" : "Declared screenshot"}</p>
    {asset === "unavailable" ? <p role="status">Evidence unavailable</p> : <>
      {!loaded && <p role="status">Loading screenshot…</p>}
      {available && <Image alt={"Screenshot for " + shot.state} src={url + "/image"} width={asset.width} height={asset.height}
        unoptimized loading="eager" hidden={!loaded} className="workspace-private-screenshot"
        onLoad={() => setLoaded(true)} onError={() => setAsset("unavailable")} />}
    </>}
    <dl>
      <dt>Asset ID</dt><dd><code>{shot.asset_id}</code></dd>
      <dt>Source revision</dt><dd><code>{shot.source_revision}</code></dd>
      <dt>Route</dt><dd><code>{shot.route}</code></dd>
      <dt>State</dt><dd>{shot.state}</dd>
      <dt>Viewport</dt><dd>{shot.viewport.width} × {shot.viewport.height}</dd>
      <dt>Environment</dt><dd>{shot.environment}</dd>
      <dt>Capture time</dt><dd><time dateTime={shot.captured_at}>{shot.captured_at}</time></dd>
      {shot.capture_ref && <><dt>Capture reference</dt><dd><code>{shot.capture_ref}</code></dd></>}
    </dl>
  </li>;
}

export function WorkspaceDeclaredScreenshots({ repositoryId, change }: { repositoryId: string; change: Change }) {
  if (!change.evidence.length) return null;
  return <section className="workspace-declared-evidence" aria-label={"Evidence for " + change.summary}>
    <h3>Screenshot evidence</h3>
    <ul>{change.evidence.map((shot, index) => (
      <DeclaredScreenshot key={`${shot.asset_id}:${index}`} repositoryId={repositoryId} shot={shot} />
    ))}</ul>
  </section>;
}
