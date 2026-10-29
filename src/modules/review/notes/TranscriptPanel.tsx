// The Transcript tab: what's said in this version, line by line, pinned to frames. Click a line to jump there.
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useShareArgs, useViewer } from "../../../lib/viewer";
import { RotateCw } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { TranscriptFile } from "../../../../convex/lib/transcript";
import { useFrame, type FrameClock } from "../player/useFramePlayer";
import { Spinner } from "../../../ui/kit";

export function TranscriptList({ versionId, clock, tc, onSeek }: { versionId: Id<"versions">; clock: FrameClock; tc: (f: number) => string; onSeek: (frame: number) => void }) {
  const shareArgs = useShareArgs();
  const { can } = useViewer();
  const info = useQuery(api.transcripts.forVersion, { versionId, ...shareArgs });
  const retry = useMutation(api.transcripts.retry);
  const [file, setFile] = useState<TranscriptFile | null>(null);
  const [loadError, setLoadError] = useState(false);
  const url = info?.url ?? null;
  useEffect(() => {
    setFile(null); setLoadError(false);
    if (!url) return;
    let live = true;
    fetch(url).then((r) => r.json()).then((j) => { if (live) setFile(j as TranscriptFile); }).catch(() => { if (live) setLoadError(true); });
    return () => { live = false; };
  }, [url]);

  const frame = useFrame(clock);
  const segs = file?.segments ?? [];
  const here = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < segs.length; i++) { if (segs[i].in <= frame) idx = i; else break; }
    return idx >= 0 && frame <= segs[idx].out + 12 ? idx : -1;
  }, [segs, frame]);
  const hereRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { hereRef.current?.scrollIntoView({ block: "nearest" }); }, [here]);

  if (info === undefined) return <p className="caption" style={{ padding: 12 }}>Loading…</p>;
  if (!info || info.status === "pending" || info.status === "running") {
    return (
      <div className="tempty rect">
        <span className="rlabel">Transcript</span>
        <div className="rbold busyline">{info && <Spinner size={18} />}{info ? "Transcribing" : "Not yet"}</div>
        <p className="caption" style={{ margin: 0 }}>{info ? "ElevenLabs is transcribing this version. It shows up here by itself in a minute or two." : "Versions are transcribed after they finish processing."}</p>
        {!info && can === "owner" && <button className="btn sm" onClick={() => void retry({ versionId })}><RotateCw size={14} />Transcribe now</button>}
      </div>
    );
  }
  if (info.status === "failed" || loadError) {
    return (
      <div className="tempty rect">
        <span className="rlabel">Transcript</span>
        <div className="rbold">Didn't work</div>
        <p className="caption" style={{ margin: 0 }}>{info.error ?? "The transcript file couldn't be loaded."}</p>
        {can === "owner" && <button className="btn sm" onClick={() => void retry({ versionId })}><RotateCw size={14} />Try again</button>}
      </div>
    );
  }
  if (!file) return <p className="caption" style={{ padding: 12 }}>Loading…</p>;
  if (!segs.length) return <div className="tempty rect"><span className="rlabel">Transcript</span><div className="rbold">No speech</div><p className="caption" style={{ margin: 0 }}>Nobody talks in this version.</p></div>;
  const many = file.speakers.length > 1;
  return (
    <div className="tlist">
      {segs.map((s, i) => (
        <button key={i} ref={i === here ? hereRef : undefined} className={`tline${i === here ? " here" : ""}`} onClick={() => onSeek(s.in)}>
          <span className="ttc">{tc(s.in)}{many && <span className="tsp"> · Speaker {s.speaker + 1}</span>}</span>
          <span className="ttx">{s.text}</span>
        </button>
      ))}
    </div>
  );
}
