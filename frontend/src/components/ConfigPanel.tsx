import React from 'react';
import type { Language, Domain } from '../types';
import { Cpu } from 'lucide-react';

interface ConfigPanelProps {
  languages: Language[];
  domains: Domain[];
  sourceLanguage: string;
  targetLanguage: string;
  domain: string;
  aiProvider: 'gemini' | 'groq';
  onSourceLanguageChange: (lang: string) => void;
  onTargetLanguageChange: (lang: string) => void;
  onDomainChange: (domain: string) => void;
  onAiProviderChange: (provider: 'gemini' | 'groq') => void;
  disabled?: boolean;
}

export const ConfigPanel: React.FC<ConfigPanelProps> = ({
  languages,
  domains,
  sourceLanguage,
  targetLanguage,
  domain,
  aiProvider,
  onSourceLanguageChange,
  onTargetLanguageChange,
  onDomainChange,
  onAiProviderChange,
  disabled,
}) => {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-5 shadow-sm space-y-4">
      <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">
        2. Translation Parameters
      </h2>

      <div className="space-y-4">
        {/* AI Provider Toggle */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center space-x-1.5">
            <Cpu className="h-3.5 w-3.5 text-blue-400" />
            <span>AI Translation Engine Provider</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onAiProviderChange('gemini')}
              className={`flex flex-col items-start p-2.5 rounded-md border text-left transition-colors ${
                aiProvider === 'gemini'
                  ? 'border-blue-500 bg-blue-950/40 text-blue-200'
                  : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center space-x-1.5 font-semibold text-xs text-slate-200">
                <span className={`h-2 w-2 rounded-full ${aiProvider === 'gemini' ? 'bg-blue-400' : 'bg-slate-600'}`} />
                <span>Google Gemini</span>
              </div>
              <span className="text-[10px] text-slate-500 mt-1">gemini-2.0-flash</span>
            </button>

            <button
              type="button"
              disabled={disabled}
              onClick={() => onAiProviderChange('groq')}
              className={`flex flex-col items-start p-2.5 rounded-md border text-left transition-colors ${
                aiProvider === 'groq'
                  ? 'border-emerald-500 bg-emerald-950/40 text-emerald-200'
                  : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center space-x-1.5 font-semibold text-xs text-slate-200">
                <span className={`h-2 w-2 rounded-full ${aiProvider === 'groq' ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                <span>Groq Llama 3.3</span>
              </div>
              <span className="text-[10px] text-slate-500 mt-1">llama-3.3-70b-versatile</span>
            </button>
          </div>
        </div>

        {/* Source Language */}
        <div>
          <label htmlFor="source-language" className="block text-xs font-semibold text-slate-300 mb-1">
            Source Language
          </label>
          <select
            id="source-language"
            value={sourceLanguage}
            onChange={(e) => onSourceLanguageChange(e.target.value)}
            disabled={disabled}
            className="w-full rounded-md border border-slate-700 bg-slate-950 p-2.5 text-xs text-slate-100 shadow-sm focus:border-blue-500 focus:outline-none disabled:opacity-50"
          >
            {languages.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.name} {lang.nativeName ? `(${lang.nativeName})` : ''} [{lang.code}]
              </option>
            ))}
          </select>
        </div>

        {/* Target Language */}
        <div>
          <label htmlFor="target-language" className="block text-xs font-semibold text-slate-300 mb-1">
            Target Language
          </label>
          <select
            id="target-language"
            value={targetLanguage}
            onChange={(e) => onTargetLanguageChange(e.target.value)}
            disabled={disabled}
            className="w-full rounded-md border border-slate-700 bg-slate-950 p-2.5 text-xs text-slate-100 shadow-sm focus:border-blue-500 focus:outline-none disabled:opacity-50"
          >
            {languages.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.name} {lang.nativeName ? `(${lang.nativeName})` : ''} [{lang.code}]
              </option>
            ))}
          </select>
        </div>

        {/* Subject Domain */}
        <div>
          <label htmlFor="domain-select" className="block text-xs font-semibold text-slate-300 mb-1">
            Subject Domain Guidelines
          </label>
          <select
            id="domain-select"
            value={domain}
            onChange={(e) => onDomainChange(e.target.value)}
            disabled={disabled}
            className="w-full rounded-md border border-slate-700 bg-slate-950 p-2.5 text-xs text-slate-100 shadow-sm focus:border-blue-500 focus:outline-none disabled:opacity-50"
          >
            {domains.map((dom) => (
              <option key={dom.code} value={dom.code}>
                {dom.name} Domain
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};
