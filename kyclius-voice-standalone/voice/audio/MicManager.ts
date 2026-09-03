/**
 * MicManager (05 section 2): device enumeration, permission gates, capture
 * lifecycle. Only one input session is live at a time; concurrent opens
 * coalesce. Permission is requested at first arm (T1), never at app start.
 */
import { VoiceError } from '../types/errors.ts';
import type { AudioCaptureBackend, CaptureSession } from './AudioCapture.ts';

export interface MicDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface MicOpenOptions {
  sampleRate: number;
  frameMs: number;
  onFrame(frame: Int16Array, atMs: number): void;
}

export class MicManager {
  private backend: AudioCaptureBackend;
  private session: CaptureSession | null = null;
  private opening: Promise<CaptureSession> | null = null;

  // Test/permission hooks (T1 guards). In the real app these come from the OS.
  permissionDenied = false;
  devicesAvailable = true;

  constructor(backend: AudioCaptureBackend) {
    this.backend = backend;
  }

  async listDevices(): Promise<MicDevice[]> {
    if (!this.devicesAvailable) return [];
    return [{ id: 'default', name: 'Default microphone', isDefault: true }];
  }

  async open(opts: MicOpenOptions): Promise<CaptureSession> {
    if (this.session) return this.session;
    if (this.opening) return this.opening;
    if (!this.devicesAvailable) {
      throw new VoiceError({
        code: 'MIC/DEVICE_MISSING',
        message: 'No microphone found. Plug one in or pick another input.',
        recoverable: true,
        actions: ['Check devices'],
      });
    }
    if (this.permissionDenied) {
      throw new VoiceError({
        code: 'MIC/PERMISSION_DENIED',
        message: 'Microphone access is off for Kyclius. Enable it in your OS privacy settings.',
        recoverable: true,
        actions: ['Open settings'],
      });
    }
    this.opening = this.backend.start(opts).then((session) => {
      this.session = session;
      this.opening = null;
      return session;
    });
    return this.opening;
  }

  close(): void {
    this.session?.close();
    this.session = null;
  }
}
