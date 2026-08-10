import React from 'react';
import { X, AlertCircle } from 'lucide-react';
import type { SegmentError } from '../types';

interface FailureReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  errors: SegmentError[];
}

export const FailureReportModal: React.FC<FailureReportModalProps> = ({
  isOpen,
  onClose,
  errors,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs">
      <div className="w-full max-w-2xl rounded-lg border border-slate-800 bg-slate-900 p-6 shadow-xl space-y-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2 text-rose-400">
            <AlertCircle className="h-5 w-5" />
            <h3 className="text-base font-semibold text-slate-100">
              Failed Segments Report ({errors.length})
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-xs text-slate-400">
          The following segments could not be safely validated. Output generation was blocked or these segments were excluded to prevent file corruption.
        </p>

        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {errors.map((err, idx) => (
            <div
              key={`${err.segmentId}-${idx}`}
              className="rounded-md border border-slate-800 bg-slate-950 p-3 text-xs space-y-1"
            >
              <div className="flex items-center justify-between text-slate-300 font-medium">
                <span>Segment ID: <code className="text-blue-400">{err.segmentId}</code> (Index {err.segmentIndex})</span>
                <span className="rounded bg-rose-950/60 px-2 py-0.5 text-[10px] uppercase font-semibold text-rose-300 border border-rose-900/50">
                  {err.errorType}
                </span>
              </div>
              <p className="text-slate-400 font-mono">{err.message}</p>
            </div>
          ))}
        </div>

        <div className="border-t border-slate-800 pt-3 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
          >
            Close Report
          </button>
        </div>
      </div>
    </div>
  );
};
