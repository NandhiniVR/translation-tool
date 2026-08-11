import type { AIProvider } from './api';

export interface ProviderModelOption {
  id: string;
  label: string;
}

export interface ProviderOption {
  id: AIProvider;
  label: string;
  models: ProviderModelOption[];
}

/**
 * Provider and model catalog shown in the UI.
 *
 * Defaults mirror the backend configuration (.env.example). The backend honors
 * the selected model and falls back to its own configured default when no model
 * is sent, so server-side env overrides keep working for API clients.
 */
export const PROVIDERS: ProviderOption[] = [
  {
    id: 'gemini',
    label: 'Gemini',
    models: [
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
      { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
    ],
  },
  {
    id: 'groq',
    label: 'Groq',
    models: [{ id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile' }],
  },
  {
    id: 'mistral',
    label: 'Mistral',
    models: [{ id: 'mistral-large-latest', label: 'Mistral Large (Latest)' }],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    models: [{ id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B Instruct' }],
  },
];

export function getProviderModels(provider: AIProvider): ProviderModelOption[] {
  return PROVIDERS.find((p) => p.id === provider)?.models ?? [];
}

export function getDefaultModel(provider: AIProvider): string {
  return getProviderModels(provider)[0]?.id ?? '';
}
