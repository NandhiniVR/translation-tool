import React from 'react';

export const Header: React.FC = () => {
  return (
    <header className="border-b border-slate-800 bg-slate-900/80 px-6 py-4 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 font-semibold text-white">
            MQ
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-100">
              MemoQ Multilingual AI Translation Tool
            </h1>
            <p className="text-xs text-slate-400">
              Bilingual XLIFF Document Translation Engine
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2 text-xs text-slate-400">
          <span className="inline-flex items-center rounded-full bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-300 border border-slate-700">
            Language Agnostic Architecture
          </span>
        </div>
      </div>
    </header>
  );
};
