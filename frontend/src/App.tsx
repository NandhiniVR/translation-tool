import { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { FileUploader } from './components/FileUploader';
import { ConfigPanel } from './components/ConfigPanel';
import { ProgressTracker } from './components/ProgressTracker';
import { FailureReportModal } from './components/FailureReportModal';
import { BenchmarkModal } from './components/BenchmarkModal';
import { fetchLanguages, fetchDomains, translateDocument, runBenchmarkApi } from './services/api';
import type { Language, Domain, TranslationResponse } from './types';
import type { BenchmarkReport } from './services/api';
import { Play, BarChart2 } from 'lucide-react';

export function App() {
  const [languages, setLanguages] = useState<Language[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [sourceLanguage, setSourceLanguage] = useState<string>('en');
  const [targetLanguage, setTargetLanguage] = useState<string>('hi');
  const [domain, setDomain] = useState<string>('medical');
  const [aiProvider, setAiProvider] = useState<'gemini' | 'groq'>('gemini');

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [translationResult, setTranslationResult] = useState<TranslationResponse | null>(null);

  const [isFailureModalOpen, setIsFailureModalOpen] = useState<boolean>(false);
  const [isBenchmarkModalOpen, setIsBenchmarkModalOpen] = useState<boolean>(false);
  const [benchmarkReport, setBenchmarkReport] = useState<BenchmarkReport | null>(null);
  const [isBenchmarking, setIsBenchmarking] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    // Load configurable languages and domains from backend
    Promise.all([fetchLanguages(), fetchDomains()])
      .then(([langs, doms]) => {
        setLanguages(langs);
        setDomains(doms);
        if (langs.length > 0) {
          setSourceLanguage(langs[0]!.code);
          if (langs.length > 1) {
            setTargetLanguage(langs[1]!.code);
          }
        }
        if (doms.length > 0) {
          setDomain(doms[0]!.code);
        }
      })
      .catch((err) => {
        console.error('Failed to load initial configuration:', err);
        setErrorMsg(`Failed to connect to translation backend: ${err.message || 'Unknown error'}`);
      });
  }, []);

  const handleStartTranslation = async () => {
    if (!selectedFile) return;
    setIsTranslating(true);
    setTranslationResult(null);
    setErrorMsg(null);

    try {
      const response = await translateDocument(
        selectedFile,
        sourceLanguage,
        targetLanguage,
        domain,
        aiProvider
      );
      setTranslationResult(response);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setIsTranslating(false);
    }
  };

  const handleRunBenchmark = async () => {
    if (!selectedFile) return;
    setIsBenchmarking(true);
    setErrorMsg(null);

    try {
      const report = await runBenchmarkApi(selectedFile, sourceLanguage, targetLanguage, domain);
      setBenchmarkReport(report);
      setIsBenchmarkModalOpen(true);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setIsBenchmarking(false);
    }
  };

  const handleDownload = () => {
    if (!translationResult) return;
    
    if (translationResult.downloadData) {
      // Decode base64 to Blob and trigger download
      const binaryString = window.atob(translationResult.downloadData);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = translationResult.outputFileName ?? 'translated_document';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } else if (translationResult.downloadUrl) {
      window.location.href = translationResult.downloadUrl;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 font-sans">
      <Header />

      <main className="flex-1 max-w-5xl w-full mx-auto p-6 space-y-6">
        {errorMsg && (
          <div className="rounded-md border border-rose-900/50 bg-rose-950/30 p-4 text-xs text-rose-200">
            {errorMsg}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FileUploader
            selectedFile={selectedFile}
            onFileSelect={setSelectedFile}
            disabled={isTranslating || isBenchmarking}
          />

          <ConfigPanel
            languages={languages}
            domains={domains}
            sourceLanguage={sourceLanguage}
            targetLanguage={targetLanguage}
            domain={domain}
            aiProvider={aiProvider}
            onSourceLanguageChange={setSourceLanguage}
            onTargetLanguageChange={setTargetLanguage}
            onDomainChange={setDomain}
            onAiProviderChange={setAiProvider}
            disabled={isTranslating || isBenchmarking}
          />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end space-x-3">
          {/* Benchmark Button */}
          <button
            type="button"
            id="run-benchmark-btn"
            onClick={handleRunBenchmark}
            disabled={!selectedFile || isTranslating || isBenchmarking}
            title="Run side-by-side Gemini vs Groq performance comparison"
            className="flex items-center space-x-2 rounded-md border border-amber-700/50 bg-amber-950/30 px-5 py-3 text-sm font-semibold text-amber-300 hover:bg-amber-900/40 hover:border-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <BarChart2 className="h-4 w-4" />
            <span>{isBenchmarking ? 'Benchmarking...' : 'Compare Providers'}</span>
          </button>

          {/* Translate Button */}
          <button
            type="button"
            id="start-translation-btn"
            onClick={handleStartTranslation}
            disabled={!selectedFile || isTranslating || isBenchmarking}
            className="flex items-center space-x-2 rounded-md bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Play className="h-4 w-4 fill-current" />
            <span>{isTranslating ? 'Translating Document...' : 'Start AI Translation'}</span>
          </button>
        </div>

        {/* Progress & Output Section */}
        <ProgressTracker
          isTranslating={isTranslating}
          result={translationResult}
          onDownload={handleDownload}
          onViewFailed={() => setIsFailureModalOpen(true)}
        />
      </main>

      {/* Failure Report Modal */}
      <FailureReportModal
        isOpen={isFailureModalOpen}
        onClose={() => setIsFailureModalOpen(false)}
        errors={translationResult?.failedSegments ?? translationResult?.validationReport?.failedSegments ?? []}
      />

      {/* Benchmark Results Modal */}
      <BenchmarkModal
        isOpen={isBenchmarkModalOpen}
        onClose={() => setIsBenchmarkModalOpen(false)}
        report={benchmarkReport}
      />

      <footer className="border-t border-slate-900 py-4 text-center text-xs text-slate-500">
        MemoQ Bilingual AI Translation Pipeline Prototype &bull; Language-Agnostic Translation Engine
      </footer>
    </div>
  );
}

export default App;
