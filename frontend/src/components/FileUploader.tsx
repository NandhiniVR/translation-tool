import React, { useRef } from 'react';
import { Upload, FileText, CheckCircle2 } from 'lucide-react';

interface FileUploaderProps {
  selectedFile: File | null;
  onFileSelect: (file: File | null) => void;
  disabled?: boolean;
}

export const FileUploader: React.FC<FileUploaderProps> = ({
  selectedFile,
  onFileSelect,
  disabled,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      validateAndSetFile(files[0]!);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      validateAndSetFile(files[0]!);
    }
  };

  const validateAndSetFile = (file: File) => {
    const validExtensions = ['.mqxliff', '.xliff', '.xml', '.docx'];
    const fileName = file.name.toLowerCase();
    const isValid = validExtensions.some((ext) => fileName.endsWith(ext));

    if (!isValid) {
      alert('Invalid file format. Please upload a .mqxliff, .xliff, .xml, or .docx file.');
      return;
    }
    onFileSelect(file);
  };

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wider text-slate-400">
          1. Select Document
        </h2>
        <span className="inline-flex items-center rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-300 border border-slate-700">
          MQXLIFF &bull; XLIFF &bull; DOCX
        </span>
      </div>

      <div
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => !disabled && fileInputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center rounded-md border-2 border-dashed p-8 text-center transition-colors cursor-pointer ${
          selectedFile
            ? 'border-emerald-500/50 bg-emerald-950/10'
            : 'border-slate-700 bg-slate-950/50 hover:border-slate-600 hover:bg-slate-950'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept=".mqxliff,.xliff,.xml,.docx"
          disabled={disabled}
          className="hidden"
        />

        {selectedFile ? (
          <div className="flex flex-col items-center space-y-2">
            <CheckCircle2 className="h-10 w-10 text-emerald-400" />
            <div className="flex items-center space-x-2 text-sm font-medium text-slate-200">
              <FileText className="h-4 w-4 text-emerald-400" />
              <span>{selectedFile.name}</span>
            </div>
            <p className="text-xs text-slate-400">
              {(selectedFile.size / 1024).toFixed(1)} KB &mdash; Ready for translation
            </p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onFileSelect(null);
              }}
              disabled={disabled}
              className="mt-2 text-xs font-medium text-slate-400 underline hover:text-slate-200"
            >
              Choose different file
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center space-y-2">
            <Upload className="h-10 w-10 text-slate-500" />
            <p className="text-sm font-medium text-slate-300">
              Drag and drop your translation document here
            </p>
            <p className="text-xs text-slate-500">
              Supported formats: <code className="text-slate-400">.mqxliff</code>, <code className="text-slate-400">.xliff</code>, <code className="text-slate-400">.docx</code>
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
