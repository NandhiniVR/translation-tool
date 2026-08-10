import type { Language, Domain, TranslationResponse } from '../types';

export interface BenchmarkReport {
  documentName: string;
  sourceLanguage: string;
  targetLanguage: string;
  domain: string;
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

export async function fetchLanguages(): Promise<Language[]> {
  const res = await fetch('/api/languages');
  if (!res.ok) {
    throw new Error(`Failed to fetch languages: ${res.statusText}`);
  }
  const data = (await res.json()) as { languages: Language[] };
  return data.languages;
}

export async function fetchDomains(): Promise<Domain[]> {
  const res = await fetch('/api/domains');
  if (!res.ok) {
    throw new Error(`Failed to fetch domains: ${res.statusText}`);
  }
  const data = (await res.json()) as { domains: Domain[] };
  return data.domains;
}

export async function translateDocument(
  file: File,
  sourceLanguage: string,
  targetLanguage: string,
  domain: string,
  aiProvider: 'gemini' | 'groq' = 'gemini'
): Promise<TranslationResponse> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('sourceLanguage', sourceLanguage);
  formData.append('targetLanguage', targetLanguage);
  formData.append('domain', domain);
  formData.append('aiProvider', aiProvider);

  const res = await fetch('/api/translate', {
    method: 'POST',
    body: formData,
  });

  const data = await res.json();
  if (!res.ok && !data.success) {
    throw new Error(data.error ?? 'Translation request failed.');
  }

  return data as TranslationResponse;
}

export async function runBenchmarkApi(
  file: File,
  sourceLanguage: string,
  targetLanguage: string,
  domain: string
): Promise<BenchmarkReport> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('sourceLanguage', sourceLanguage);
  formData.append('targetLanguage', targetLanguage);
  formData.append('domain', domain);

  const res = await fetch('/api/benchmark', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error ?? 'Benchmark execution failed.');
  }

  return (await res.json()) as BenchmarkReport;
}
