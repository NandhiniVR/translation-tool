import { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { FileUploader } from './components/FileUploader';
import { ConfigPanel } from './components/ConfigPanel';
import { ProgressTracker } from './components/ProgressTracker';
import { FailureReportModal } from './components/FailureReportModal';
import { BenchmarkModal } from './components/BenchmarkModal';
import { fetchLanguages, translateDocument, runBenchmarkApi } from './services/api';
import type { Language, TranslationResponse, TranslationType } from './types';
import type { AIProvider, BenchmarkReport } from './services/api';
import { getDefaultModel } from './services/providers';
import { Play, BarChart2 } from 'lucide-react';

export function App() {
  const [languages, setLanguages] = useState<Language[]>([]);
  const [sourceLanguage, setSourceLanguage] = useState<string>('auto');
  const [targetLanguage, setTargetLanguage] = useState<string>('en');
  const [aiProvider, setAiProvider] = useState<AIProvider>('gemini');
  const [selectedModel, setSelectedModel] = useState<string>(getDefaultModel('gemini'));
  const [translationType, setTranslationType] = useState<TranslationType>('standard');
  const [customInstructions, setCustomInstructions] = useState<string>('');

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [translationResult, setTranslationResult] = useState<TranslationResponse | null>(null);

  const [isFailureModalOpen, setIsFailureModalOpen] = useState<boolean>(false);
  const [isBenchmarkModalOpen, setIsBenchmarkModalOpen] = useState<boolean>(false);
  const [benchmarkReport, setBenchmarkReport] = useState<BenchmarkReport | null>(null);
  const [isBenchmarking, setIsBenchmarking] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchLanguages()
      .then((langs) => {
        setLanguages(langs);
      })
      .catch((err) => {
        console.error('Failed to load initial configuration:', err);
        setErrorMsg(`Failed to connect to translation backend: ${err.message || 'Unknown error'}`);
      });
  }, []);

  const handleProviderChange = (provider: AIProvider) => {
    setAiProvider(provider);
    setSelectedModel(getDefaultModel(provider));
  };

  const handleTranslationTypeChange = (type: TranslationType) => {
    setTranslationType(type);
    if (type === 'chat-bilingual') {
      if (!sourceLanguage) setSourceLanguage('auto');
      if (!targetLanguage) setTargetLanguage('en');
    }
  };

  const handleStartTranslation = async () => {
    if (!selectedFile) return;
    setIsTranslating(true);
    setTranslationResult(null);
    setErrorMsg(null);

    const isChat = translationType === 'chat-bilingual';
    const outputFormat = isChat ? 'bilingual' : 'translation-only';

    try {
      const response = await translateDocument(
        selectedFile,
        sourceLanguage,
        targetLanguage,
        aiProvider,
        selectedModel,
        outputFormat,
        translationType,
        customInstructions
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
      const report = await runBenchmarkApi(selectedFile, sourceLanguage, targetLanguage);
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
            sourceLanguage={sourceLanguage}
            targetLanguage={targetLanguage}
            aiProvider={aiProvider}
            selectedModel={selectedModel}
            translationType={translationType}
            customInstructions={customInstructions}
            onSourceLanguageChange={setSourceLanguage}
            onTargetLanguageChange={setTargetLanguage}
            onAiProviderChange={handleProviderChange}
            onModelChange={setSelectedModel}
            onTranslationTypeChange={handleTranslationTypeChange}
            onCustomInstructionsChange={setCustomInstructions}
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
