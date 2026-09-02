/**
 * VoiceClient - TypeScript SDK for the Pentrons Voice Server.
 * Works in the Electron main process (Node 18+) or the renderer
 * (browser APIs). No dependencies.
 */

export interface VoiceClientOptions {
  /** Base URL of the voice server. Default: http://127.0.0.1:8756 */
  baseUrl?: string;
}

export interface TranscriptionResult {
  text: string;
  language?: string | null;
  probability?: number | null;
}

export interface SynthesizeOptions {
  /** Speaking rate. 1.0 = normal, 1.5 = faster, 0.8 = slower. */
  rate?: number;
}

export class VoiceClient {
  readonly baseUrl: string;

  constructor(options: VoiceClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://127.0.0.1:8756").replace(/\/+$/, "");
  }

  /** Check the server is up. */
  async health(): Promise<{ status: string; stt_loaded: boolean; tts: string }> {
    const res = await fetch(`${this.baseUrl}/health`);
    if (!res.ok) throw new Error(`Health check failed (${res.status})`);
    return res.json();
  }

  /**
   * Speech -> text. Accepts any audio the browser can produce
   * (MediaRecorder blob, File from <input type="file">, raw ArrayBuffer).
   */
  async transcribe(
    audio: Blob | File | ArrayBuffer,
    opts: { language?: string; filename?: string } = {},
  ): Promise<TranscriptionResult> {
    const form = new FormData();
    const file =
      audio instanceof Blob
        ? new File([audio], opts.filename ?? "audio.webm", { type: audio.type })
        : new File([audio], opts.filename ?? "audio.wav");
    form.append("file", file);
    const url = new URL(`${this.baseUrl}/stt`);
    if (opts.language) url.searchParams.set("language", opts.language);
    const res = await fetch(url.toString(), { method: "POST", body: form });
    if (!res.ok) throw new Error(`STT failed (${res.status}): ${await res.text()}`);
    return res.json();
  }

  /**
   * Text -> speech. Resolves to a playable audio blob
   * (audio/wav with the offline Piper voice, audio/mp3 with the fallback).
   */
  async synthesize(text: string, opts: SynthesizeOptions = {}): Promise<Blob> {
    const res = await fetch(`${this.baseUrl}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, rate: opts.rate ?? 1.0 }),
    });
    if (!res.ok) throw new Error(`TTS failed (${res.status}): ${await res.text()}`);
    return res.blob();
  }

  /** Text -> speech, played immediately through the default output device. */
  async speak(text: string, opts: SynthesizeOptions = {}): Promise<void> {
    const blob = await this.synthesize(text, opts);
    const audio = new Audio(URL.createObjectURL(blob));
    await audio.play();
    await new Promise<void>((resolve) => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
    });
    URL.revokeObjectURL(audio.src);
  }

  /**
   * Streaming speech -> text over WebSocket. Feed it MediaRecorder chunks;
   * call `flush()` when the user stops talking to get the transcript.
   *
   * ```ts
   * const stream = client.streamTranscribe(t => console.log("heard:", t));
   * await stream.startMic();       // asks for mic permission
   * // ... user speaks ...
   * await stream.stopMic();        // stops capture and flushes
   * ```
   */
  streamTranscribe(onTranscript: (result: TranscriptionResult) => void,
                   onError?: (err: string) => void): VoiceStream {
    return new VoiceStream(this.baseUrl, onTranscript, onError);
  }
}

export class VoiceStream {
  private ws: WebSocket | null = null;
  private recorder: MediaRecorder | null = null;
  private micStream: MediaStream | null = null;

  constructor(
    private baseUrl: string,
    private onTranscript: (result: TranscriptionResult) => void,
    private onError?: (err: string) => void,
  ) {}

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = this.baseUrl.replace(/^http/, "ws") + "/ws/stt";
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("Could not connect to voice server WebSocket"));
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string);
          if (msg.type === "transcript") this.onTranscript(msg as TranscriptionResult);
          else if (msg.type === "error") this.onError?.(msg.message);
        } catch { /* ignore */ }
      };
      this.ws = ws;
    });
  }

  /** Ask for mic permission and start streaming to the server. */
  async startMic(): Promise<void> {
    await this.connect();
    this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus" : "audio/webm";
    const rec = new MediaRecorder(this.micStream, { mimeType: mime });
    rec.ondataavailable = (ev) => {
      if (ev.data.size > 0 && this.ws?.readyState === WebSocket.OPEN)
        this.ws.send(ev.data);
    };
    rec.start(250); // send a chunk every 250 ms
    this.recorder = rec;
  }

  /** Flush whatever is buffered server-side without stopping the mic. */
  flush(): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ action: "flush" }));
  }

  /** Stop capture, flush, and return the final transcript via onTranscript. */
  async stopMic(): Promise<void> {
    this.recorder?.stop();
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.recorder = null;
    this.micStream = null;
    // give the recorder a tick to emit its final chunk, then flush
    await new Promise((r) => setTimeout(r, 300));
    this.flush();
    await new Promise((r) => setTimeout(r, 1500)); // allow transcript to arrive
    this.ws?.close();
    this.ws = null;
  }
}

export default VoiceClient;
