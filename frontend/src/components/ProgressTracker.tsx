import React from 'react';
import { Loader2, CheckCircle2, AlertTriangle, Download, Zap } from 'lucide-react';
import type { TranslationResponse } from '../types';

interface ProgressTrackerProps {
  isTranslating: boolean;
  result: TranslationResponse | null;
  onDownload: () => void;
  onViewFailed: () => void;
}

export const ProgressTracker: React.FC<ProgressTrackerProps> = ({
  isTranslating,
  result,
  onDownload,
  onViewFailed,
}) => {
  if (!isTranslating && !result) return null;

  const formatLabel = result?.sourceFormat ? result.sourceFormat.toUpperCase() : 'DOCUMENT';
  const metrics = result?.profilerMetrics;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-5 shadow-sm space-y-4">
      <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400 flex items-center justify-between">
        <span>3. Translation Status & Performance</span>
        {result && metrics && (
          <span className="flex items-center space-x-1 text-xs text-blue-400 normal-case font-mono">
            <Zap className="h-3.5 w-3.5" />
            <span>Completed in {(metrics.tTotalMs / 1000).toFixed(1)}s</span>
          </span>
        )}
      </h2>

      {isTranslating && (
        <div className="space-y-3 rounded-md border border-blue-900/40 bg-blue-950/20 p-4 text-blue-200">
          <div className="flex items-center space-x-3">
            <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
            <div>
              <p className="text-sm font-medium">Batch Translation in Progress</p>
              <p className="text-xs text-blue-400">
                Processing structured segment batches via Gemini API...
              </p>
            </div>
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {/* Summary Box */}
          <div
            className={`rounded-md border p-4 ${
              result.success
                ? 'border-emerald-900/40 bg-emerald-950/20 text-emerald-200'
                : 'border-rose-900/40 bg-rose-950/20 text-rose-200'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                {result.success ? (
                  <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                ) : (
                  <AlertTriangle className="h-6 w-6 text-rose-400" />
                )}
                <div>
                  <h3 className="text-sm font-semibold">
                    {result.success ? `${formatLabel} Translation Completed` : 'Translation Completed with Errors'}
                  </h3>
                  <p className="text-xs opacity-80">
                    Format: <span className="font-semibold uppercase">{formatLabel}</span> | Total: {result.totalSegments} segments | Completed: {result.completed} | Failed: {result.failed}
                  </p>
                </div>
              </div>

              {result.success && result.downloadUrl && (
                <div className="flex flex-col items-end space-y-1">
                  {result.outputFileName && (
                    <span className="text-[10px] text-slate-400 font-mono">{result.outputFileName}</span>
                  )}
                  <button
                    type="button"
                    onClick={onDownload}
                    className="flex items-center space-x-2 rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors shadow-sm"
                  >
                    <Download className="h-4 w-4" />
                    <span>Download Translated {formatLabel}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Profiler Performance Metrics Summary */}
            {metrics && (
              <div className="mt-4 pt-3 border-t border-slate-800/80 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-slate-300 font-mono">
                <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
                  <span className="text-slate-500 block text-[10px] uppercase font-sans">Total Time</span>
                  <span className="font-bold text-emerald-400">{(metrics.tTotalMs / 1000).toFixed(2)}s</span>
                </div>
                <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
                  <span className="text-slate-500 block text-[10px] uppercase font-sans">Gemini API Time</span>
                  <span className="font-bold text-blue-400">{(metrics.tGeminiApiMs / 1000).toFixed(2)}s</span>
                </div>
                <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
                  <span className="text-slate-500 block text-[10px] uppercase font-sans">API Calls / Retries</span>
                  <span className="font-bold text-slate-200">{metrics.geminiRequests} calls ({metrics.totalRetries} retries)</span>
                </div>
                <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
                  <span className="text-slate-500 block text-[10px] uppercase font-sans">Batch / Concurrency</span>
                  <span className="font-bold text-amber-300">Size: {metrics.batchSize} | Workers: {metrics.concurrency}</span>
                </div>
              </div>
            )}

            {/* Error detail message if present */}
            {result.error && (
              <p className="mt-3 text-xs text-rose-300 border-t border-rose-900/50 pt-2">
                {result.error}
              </p>
            )}
          </div>

          {/* Failed segments button */}
          {result.failed > 0 && (
            <div className="flex items-center justify-between rounded-md border border-amber-900/40 bg-amber-950/20 p-3 text-xs text-amber-200">
              <span>{result.failed} segment(s) failed validation.</span>
              <button
                type="button"
                onClick={onViewFailed}
                className="font-semibold underline hover:text-amber-100"
              >
                View Failed Segments
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
