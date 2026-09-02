/**
 * useVoice - React hook wiring the VoiceClient into any React/Electron UI.
 *
 * const { listening, transcript, startListening, stopListening, speak, speaking } = useVoice();
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { VoiceClient, type TranscriptionResult } from "./VoiceClient";

export interface UseVoiceOptions {
  baseUrl?: string;
  /** Called with every finalized transcript (e.g. pipe it to your LLM). */
  onTranscript?: (result: TranscriptionResult) => void;
}

export function useVoice(options: UseVoiceOptions = {}) {
  const clientRef = useRef<VoiceClient | null>(null);
  const streamRef = useRef<ReturnType<VoiceClient["streamTranscribe"]> | null>(null);
  const onTranscriptRef = useRef(options.onTranscript);
  onTranscriptRef.current = options.onTranscript;

  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const getClient = useCallback(() => {
    if (!clientRef.current) clientRef.current = new VoiceClient({ baseUrl: options.baseUrl });
    return clientRef.current;
  }, [options.baseUrl]);

  // Ping the server once so the UI knows the voice backend is reachable.
  useEffect(() => {
    getClient()
      .health()
      .then(() => setReady(true))
      .catch((e) => setError(`Voice server unreachable: ${e.message}`));
  }, [getClient]);

  const startListening = useCallback(async () => {
    setError(null);
    setTranscript("");
    const stream = getClient().streamTranscribe(
      (result) => {
        setTranscript(result.text);
        onTranscriptRef.current?.(result);
      },
      (err) => setError(err),
    );
    try {
      await stream.startMic();
      streamRef.current = stream;
      setListening(true);
    } catch (e: any) {
      setError(e.message ?? "Could not start microphone");
    }
  }, [getClient]);

  const stopListening = useCallback(async () => {
    const stream = streamRef.current;
    streamRef.current = null;
    setListening(false);
    if (stream) await stream.stopMic();
  }, []);

  /** Toggle: click-to-talk. Returns the final transcript via onTranscript. */
  const toggleListening = useCallback(async () => {
    if (streamRef.current) await stopListening();
    else await startListening();
  }, [startListening, stopListening]);

  /** Speak a string through the assistant's voice. */
  const speak = useCallback(
    async (text: string, rate = 1.0) => {
      setError(null);
      setSpeaking(true);
      try {
        await getClient().speak(text, { rate });
      } catch (e: any) {
        setError(e.message ?? "TTS failed");
      } finally {
        setSpeaking(false);
      }
    },
    [getClient],
  );

  useEffect(() => {
    return () => {
      streamRef.current?.stopMic();
    };
  }, []);

  return {
    ready, listening, speaking, transcript, error,
    startListening, stopListening, toggleListening, speak,
    /** The raw SDK, in case you need advanced control. */
    client: clientRef.current,
  };
}

export default useVoice;
