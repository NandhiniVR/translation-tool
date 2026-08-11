import type { Language, TranslationResponse } from '../types';

export type AIProvider = 'gemini' | 'groq' | 'mistral' | 'openrouter';

export interface BenchmarkReport {
  documentName: string;
  sourceLanguage: string;
  targetLanguage: string;
  totalSegments: number;
  batchSize: number;
  concurrency: number;
  gemini: {
    provider: 'gemini';
    model: string;
    totalTimeMs: number;
    apiTimeMs: number;
    avgLatencyMs: number;
    maxLatencyMs: number;
    requests: number;
    retries: number;
    completedSegments: number;
    failedSegments: number;
    sampleTranslations: Array<{
      segmentId: string;
      sourceText: string;
      translatedText: string;
    }>;
  };
  groq: {
    provider: 'groq';
    model: string;
    totalTimeMs: number;
    apiTimeMs: number;
    avgLatencyMs: number;
    maxLatencyMs: number;
    requests: number;
    retries: number;
    completedSegments: number;
    failedSegments: number;
    sampleTranslations: Array<{
      segmentId: string;
      sourceText: string;
      translatedText: string;
    }>;
  };
  fastestProvider: 'gemini' | 'groq' | 'equal';
  mostReliableProvider: 'gemini' | 'groq' | 'equal';
  speedupPercentage: number;
}

async function safeJson<T>(res: Response, fallbackError: string): Promise<T> {
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Server error (${res.status}): ${text.slice(0, 200) || fallbackError}`);
  }
  if (!res.ok) {
    throw new Error(data?.error ?? `${fallbackError} (${res.status})`);
  }
  return data as T;
}

export async function fetchLanguages(): Promise<Language[]> {
  const res = await fetch('/api/languages');
  const data = await safeJson<{ languages: Language[] }>(res, 'Failed to fetch languages');
  return data.languages;
}

export async function translateDocument(
  file: File,
  sourceLanguage: string,
  targetLanguage: string,
  aiProvider: AIProvider = 'gemini',
  model?: string
): Promise<TranslationResponse> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('sourceLanguage', sourceLanguage);
  formData.append('targetLanguage', targetLanguage);
  formData.append('aiProvider', aiProvider);
  if (model) {
    formData.append('model', model);
  }

  const res = await fetch('/api/translate', {
    method: 'POST',
    body: formData,
  });

  return safeJson<TranslationResponse>(res, 'Translation request failed.');
}

export async function runBenchmarkApi(
  file: File,
  sourceLanguage: string,
  targetLanguage: string
): Promise<BenchmarkReport> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('sourceLanguage', sourceLanguage);
  formData.append('targetLanguage', targetLanguage);

  const res = await fetch('/api/benchmark', {
    method: 'POST',
    body: formData,
  });

  return safeJson<BenchmarkReport>(res, 'Benchmark execution failed.');
}
