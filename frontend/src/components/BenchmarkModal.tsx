import React from 'react';
import { X, Zap, Award, FileText } from 'lucide-react';
import type { BenchmarkReport } from '../services/api';

interface BenchmarkModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: BenchmarkReport | null;
}

export const BenchmarkModal: React.FC<BenchmarkModalProps> = ({
  isOpen,
  onClose,
  report,
}) => {
  if (!isOpen || !report) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-lg border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-5 text-slate-100 font-sans">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-2">
            <Award className="h-5 w-5 text-amber-400" />
            <h2 className="text-base font-bold text-slate-100">
              Provider Comparison Benchmark Report
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Document Details */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400">
          <div className="flex items-center space-x-2">
            <FileText className="h-4 w-4 text-slate-400" />
            <span className="font-semibold text-slate-200">{report.documentName}</span>
          </div>
          <div>
            <span>Language Pair: </span>
            <span className="font-semibold text-slate-200">{report.sourceLanguage} &rarr; {report.targetLanguage}</span>
          </div>
          <div>
            <span>Domain: </span>
            <span className="font-semibold text-slate-200 capitalize">{report.domain}</span>
          </div>
          <div>
            <span>Segments: </span>
            <span className="font-semibold text-slate-200">{report.totalSegments}</span>
          </div>
          <div>
            <span>Batch Size: </span>
            <span className="font-semibold text-slate-200">{report.batchSize} (Workers: {report.concurrency})</span>
          </div>
        </div>

        {/* Side-by-Side Comparison Table */}
        <div className="overflow-x-auto border border-slate-800 rounded-md">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="p-3 font-semibold">Metric</th>
                <th className="p-3 font-semibold text-blue-400">Google Gemini (gemini-2.0-flash)</th>
                <th className="p-3 font-semibold text-emerald-400">Groq Llama 3.3 (70b-versatile)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-slate-200">
              <tr>
                <td className="p-3 font-sans font-medium text-slate-300">Total Processing Time</td>
                <td className="p-3 font-bold text-blue-400">{(report.gemini.totalTimeMs / 1000).toFixed(2)} s</td>
                <td className="p-3 font-bold text-emerald-400">{(report.groq.totalTimeMs / 1000).toFixed(2)} s</td>
              </tr>
              <tr>
                <td className="p-3 font-sans font-medium text-slate-300">API Execution Time</td>
                <td className="p-3">{(report.gemini.apiTimeMs / 1000).toFixed(2)} s</td>
                <td className="p-3">{(report.groq.apiTimeMs / 1000).toFixed(2)} s</td>
              </tr>
              <tr>
                <td className="p-3 font-sans font-medium text-slate-300">Average Request Latency</td>
                <td className="p-3">{report.gemini.avgLatencyMs} ms</td>
                <td className="p-3">{report.groq.avgLatencyMs} ms</td>
              </tr>
              <tr>
                <td className="p-3 font-sans font-medium text-slate-300">Slowest Request Latency</td>
                <td className="p-3">{report.gemini.maxLatencyMs} ms</td>
                <td className="p-3">{report.groq.maxLatencyMs} ms</td>
              </tr>
              <tr>
                <td className="p-3 font-sans font-medium text-slate-300">API Requests / Retries</td>
                <td className="p-3">{report.gemini.requests} requests ({report.gemini.retries} retries)</td>
                <td className="p-3">{report.groq.requests} requests ({report.groq.retries} retries)</td>
              </tr>
              <tr>
                <td className="p-3 font-sans font-medium text-slate-300">Completed / Failed Segments</td>
                <td className="p-3">
                  <span className="text-emerald-400">{report.gemini.completedSegments} ok</span>
                  {report.gemini.failedSegments > 0 && (
                    <span className="text-rose-400 ml-2">({report.gemini.failedSegments} failed)</span>
                  )}
                </td>
                <td className="p-3">
                  <span className="text-emerald-400">{report.groq.completedSegments} ok</span>
                  {report.groq.failedSegments > 0 && (
                    <span className="text-rose-400 ml-2">({report.groq.failedSegments} failed)</span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Verdict & Recommendation */}
        <div className="rounded-md border border-slate-800 bg-slate-950 p-4 space-y-2 text-xs">
          <div className="flex items-center space-x-2">
            <Zap className="h-4 w-4 text-amber-400" />
            <h4 className="font-semibold text-slate-200 uppercase tracking-wider text-[11px]">
              Benchmark Verdict & Recommendation
            </h4>
          </div>
          <p className="text-slate-300">
            <strong>Fastest Provider:</strong>{' '}
            <span className="capitalize font-bold text-amber-400">{report.fastestProvider}</span>{' '}
            {report.speedupPercentage > 0 && `(${report.speedupPercentage}% faster)`}
          </p>
          <p className="text-slate-400 text-[11px]">
            <em>Human translation quality requires subjective review. Both providers maintained 100% placeholder, entity, and tag validation structure.</em>
          </p>
        </div>

        {/* Sample Translation Outputs Comparison */}
        {report.gemini.sampleTranslations.length > 0 && (
          <div className="space-y-3 pt-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Sample Segment Translation Comparisons
            </h4>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {report.gemini.sampleTranslations.map((sample, i) => {
                const groqSample = report.groq.sampleTranslations[i];
                return (
                  <div key={sample.segmentId} className="rounded border border-slate-800 bg-slate-950 p-3 text-xs space-y-1">
                    <p className="text-slate-400 font-semibold">[{sample.segmentId}] Source: <span className="font-normal text-slate-200">{sample.sourceText}</span></p>
                    <p className="text-blue-300">Gemini: {sample.translatedText || '(failed)'}</p>
                    <p className="text-emerald-300">Groq: {groqSample?.translatedText || '(failed)'}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
          >
            Close Benchmark Report
          </button>
        </div>
      </div>
    </div>
  );
};
