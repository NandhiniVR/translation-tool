import React from 'react';
import type { Language } from '../types';
import { Cpu } from 'lucide-react';
import type { AIProvider } from '../services/api';
import { PROVIDERS, getProviderModels } from '../services/providers';

interface ConfigPanelProps {
  languages: Language[];
  sourceLanguage: string;
  targetLanguage: string;
  aiProvider: AIProvider;
  selectedModel: string;
  onSourceLanguageChange: (lang: string) => void;
  onTargetLanguageChange: (lang: string) => void;
  onAiProviderChange: (provider: AIProvider) => void;
  onModelChange: (model: string) => void;
  disabled?: boolean;
}

export const ConfigPanel: React.FC<ConfigPanelProps> = ({
  languages,
  sourceLanguage,
  targetLanguage,
  aiProvider,
  selectedModel,
  onSourceLanguageChange,
  onTargetLanguageChange,
  onAiProviderChange,
  onModelChange,
  disabled,
}) => {
  const modelOptions = getProviderModels(aiProvider);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-5 shadow-sm space-y-4">
      <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">
        2. Translation Parameters
      </h2>

      <div className="space-y-4">
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

        {/* AI Provider */}
        <div>
          <label htmlFor="ai-provider" className="block text-xs font-semibold text-slate-300 mb-1 flex items-center space-x-1.5">
            <Cpu className="h-3.5 w-3.5 text-blue-400" />
            <span>AI Provider</span>
          </label>
          <select
            id="ai-provider"
            value={aiProvider}
            onChange={(event) => onAiProviderChange(event.target.value as AIProvider)}
            disabled={disabled}
            className="w-full rounded-md border border-slate-700 bg-slate-950 p-2.5 text-xs text-slate-100 shadow-sm focus:border-blue-500 focus:outline-none disabled:opacity-50"
          >
            {PROVIDERS.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
          </select>
        </div>

        {/* AI Model */}
        <div>
          <label htmlFor="ai-model" className="block text-xs font-semibold text-slate-300 mb-1">
            AI Model
          </label>
          <select
            id="ai-model"
            value={selectedModel}
            onChange={(event) => onModelChange(event.target.value)}
            disabled={disabled || modelOptions.length <= 1}
            className="w-full rounded-md border border-slate-700 bg-slate-950 p-2.5 text-xs text-slate-100 shadow-sm focus:border-blue-500 focus:outline-none disabled:opacity-50"
          >
            {modelOptions.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </div>

      </div>
    </div>
  );
};
