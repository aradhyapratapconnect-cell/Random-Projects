import { contextBridge, ipcRenderer } from 'electron';

/**
 * Secure bridge between the Kycelius Voice engine (renderer) and the
 * Electron main process. Everything is explicit — no nodeIntegration.
 */
const api = {
  /** true when running inside Electron (vs. plain browser during web dev) */
  isElectron: true,

  settings: {
    get: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('kycelius:settings:get'),
    set: (patch: Record<string, unknown>): Promise<Record<string, unknown>> =>
      ipcRenderer.invoke('kycelius:settings:set', patch),
  },

  /** Offline Windows SAPI text-to-speech */
  sapi: {
    listVoices: (): Promise<string[]> =>
      ipcRenderer.invoke('kycelius:sapi:voices').then((vs: Array<{ name: string }>) =>
        vs.map((v) => v.name),
      ),
    speak: (req: {
      text: string;
      voice?: string;
      rate?: number;
      pitch?: number;
    }): Promise<ArrayBuffer> => ipcRenderer.invoke('kycelius:sapi:speak', req),
  },

  appInfo: (): Promise<{
    version: string;
    electron: string;
    chrome: string;
    node: string;
    platform: string;
    isDev: boolean;
  }> => ipcRenderer.invoke('kycelius:app:info'),
};

contextBridge.exposeInMainWorld('kycelius', api);
