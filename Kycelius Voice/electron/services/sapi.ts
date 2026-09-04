import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);

export interface SapiVoice {
  name: string;
  description: string;
}

/**
 * Fully offline text-to-speech using the Windows SAPI engine
 * (System.Speech) — no network, no API keys, native OS voices.
 *
 * Flow: PowerShell synthesizes text -> temp .wav file -> read buffer ->
 * returned over IPC -> renderer plays it via Blob URL.
 */
export class SapiService {
  private voicesCache: SapiVoice[] | null = null;

  async listVoices(): Promise<SapiVoice[]> {
    if (this.voicesCache) return this.voicesCache;

    const script = [
      'Add-Type -AssemblyName System.Speech',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      '$s.GetInstalledVoices() | ForEach-Object {',
      '  $v = $_.VoiceInfo',
      '  "$($v.Name)|$($v.Description)"',
      '}',
    ].join('; ');

    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ]);

    this.voicesCache = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, description] = line.split('|');
        return { name: name ?? '', description: description ?? name ?? '' };
      });

    return this.voicesCache;
  }

  /**
   * @param text  Text to speak
   * @param voice Voice name (e.g. "Microsoft David Desktop"). Omit = system default.
   * @param rate  Speaking rate 0.5 – 2.0
   * @param pitch Pitch 0.5 – 2.0
   * @returns WAV file contents as a Buffer (send raw over IPC)
   */
  async synthesize(
    text: string,
    voice?: string,
    rate = 1.0,
    pitch = 1.0,
  ): Promise<Buffer> {
    const outFile = path.join(os.tmpdir(), `kycelius-tts-${Date.now()}.wav`);

    const esc = (s: string) => s.replace(/'/g, "''");
    // Note: System.Speech exposes Rate/Volume but no Pitch property —
    // pitch is accepted in the API surface for parity but ignored for SAPI.
    const script = [
      'Add-Type -AssemblyName System.Speech',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      `$s.SetOutputToWaveFile('${esc(outFile.replace(/'/g, "''"))}')`,
      `$s.Rate = ${Math.max(-10, Math.min(10, Math.round((rate - 1) * 10)))}`,
      voice ? `$s.SelectVoice('${esc(voice)}')` : '$null',
      `$s.Speak('${esc(text)}')`,
      '$s.Dispose()',
    ]
      .filter((l) => l !== '$null')
      .join('; ');

    try {
      await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        script,
      ]);
      return fs.readFileSync(outFile);
    } finally {
      fs.rm(outFile, { force: true }, () => undefined);
    }
  }
}
