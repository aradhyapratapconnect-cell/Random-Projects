/**
 * SystemSttAdapter (03 section 5.2): OS dictation hand-off. Capability-probed;
 * where no automation path exists it reports `unsupported` rather than
 * pretending (03 section 5.2) - which is exactly what lets the ladder report
 * an honest STT/NO_ENGINE instead of a silent hang.
 */
import type { Health, ProviderRow } from '../../types/provider.ts';
import type { STTProvider, SttSink, SttStreamConfig } from '../STTProvider.ts';

export class SystemSttProvider implements STTProvider {
  readonly row: ProviderRow;

  constructor(row: ProviderRow) {
    this.row = row;
  }

  async probe(timeoutMs: number): Promise<Health> {
    void timeoutMs;
    return {
      status: 'unsupported',
      detail: 'OS dictation automation is not available in this standalone build',
    };
  }

  startStream(cfg: SttStreamConfig, sink: SttSink): void {
    sink.onError({ code: 'STT/ENGINE_FAILED', cause: 'system dictation unsupported', sessionId: cfg.sessionId });
  }

  feed(): void {
    // unreachable while unsupported
  }

  finalize(): void {
    // unreachable while unsupported
  }

  stopStream(): void {}

  async dispose(): Promise<void> {}
}
