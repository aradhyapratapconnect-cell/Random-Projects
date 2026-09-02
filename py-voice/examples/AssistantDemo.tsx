/**
 * Copy-paste demo: click-to-talk assistant widget for your Electron app.
 * Requires the voice server running (cd voice-server && python main.py).
 */
import React from "react";
import { useVoice } from "../client/src";

export function AssistantDemo({ onUserUtterance }: { onUserUtterance?: (text: string) => void }) {
  const {
    ready, listening, speaking, transcript, error,
    toggleListening, speak,
  } = useVoice({
    onTranscript: (r) => {
      if (!r.text) return;
      onUserUtterance?.(r.text);
      // Replace with your LLM call; then speak the reply:
      speak(`You said: ${r.text}`);
    },
  });

  if (!ready) {
    return <p>Starting voice engine... (is `python main.py` running?)</p>;
  }

  return (
    <div style={{ fontFamily: "sans-serif", padding: 16 }}>
      <button onClick={toggleListening} disabled={speaking}
        style={{ fontSize: 18, padding: "10px 24px", borderRadius: 24 }}>
        {listening ? "Listening... (click to stop)" : speaking ? "Speaking..." : "Hold a conversation"}
      </button>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {transcript && <p><b>Heard:</b> {transcript}</p>}
    </div>
  );
}

export default AssistantDemo;
