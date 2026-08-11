# Multilingual AI Translation Tool for MemoQ

A prototype of a language-agnostic, AI-powered translation application for translating MemoQ bilingual files (`.mqxliff` / `.xliff`).

---

## Key Features

- **Language-Agnostic Core Architecture**: Works for any source and target language combination (English, Hindi, Gujarati, Punjabi, Urdu, Tamil, Telugu, Malayalam, Marathi, Bengali, etc.). Adding a language requires only configuration.
- **RTL Language Support**: Automatic right-to-left layout support for target languages such as Urdu.
- **Inline Tag Protection**: Preserves MemoQ inline formatting tags (`<bpt>`, `<ept>`, `<ph>`, `<g>`, `<mrk>`) using placeholder tokens (`__TAG_N__`). Validates token counts and positions before restoration.
- **Configurable Entity Protection**: Protects URLs, emails, study IDs, and product codes (`__ENTITY_N__`) without freezing words that have valid target translations.
- **Surrounding Context Engine**: Provides Previous, Current, and Next segment text to Gemini to resolve pronouns and ambiguity. Translates **ONLY** the current segment.
- **Multilingual Glossary Support**: Injects glossary terms into prompt instructions as preferred guidelines rather than performing blind regex replacements that corrupt target grammar.
- **7-Point Validation**: Verifies segment counts, ID mapping, order, non-empty translations, unrestored tag/entity tokens, numeric values, and XML well-formedness before allowing download.
- **Professional UI**: Simple, clean document translation workspace built with React, Vite, and Tailwind CSS.

---

## Directory Structure

```text
translation-tool/
├── frontend/             # React + Vite + TypeScript + Tailwind CSS UI
│   └── src/
│       ├── components/   # FileUploader, ConfigPanel, ProgressTracker, FailureReportModal
│       ├── services/     # API client
│       └── types/        # Frontend TypeScript definitions
│
├── backend/              # Node.js + Express + TypeScript server
│   └── src/
│       ├── config/       # Environment & Winston logger configuration
│       ├── controllers/  # Translation & Download HTTP controllers
│       ├── domains/      # Universal contextual domain profile (no user-selected domain)
│       ├── glossary/     # Glossary lookup service & default terms
│       ├── languages/    # Language registry (10 languages) & generic rules
│       ├── output/       # XML OutputGenerator with well-formedness validation
│       ├── parsers/      # MemoQParser (fast-xml-parser v5)
│       ├── protection/   # TagProtector & EntityProtector modules
│       ├── routes/       # Express routes & Multer file upload config
│       ├── translation/  # TranslationPipeline, GeminiProvider, PromptBuilder, ContextBuilder
│       └── validation/   # SegmentValidator
│
├── uploads/              # Uploaded .mqxliff file temporary directory
├── outputs/              # Translated .mqxliff file output directory
├── test-data/
│   ├── sample/           # Sample XLIFF test files
│   └── golden/           # Human-approved translation validation dataset
└── README.md
```

---

## Quick Start

### Prerequisites
- Node.js v20+ (Tested on Node v24.13.0)
- npm v10+

### 1. Configuration
Copy `.env.example` to `.env` in the root folder and set your Google Gemini API key:
```env
GEMINI_API_KEY=your_actual_gemini_api_key_here
PORT=3001
TRANSLATION_CONCURRENCY=1
GEMINI_MODEL=gemini-3.1-pro-preview
```

### 2. Install & Start Backend
```bash
cd backend
npm install
npm run build
npm start
```
Backend server runs on `http://localhost:3001`.

### 3. Install & Start Frontend
```bash
cd frontend
npm install
npm run dev
```
Frontend development server runs on `http://localhost:5173`.

---

## Testing & Quality Verification

### Run Backend Unit Tests
```bash
cd backend
npm test
```
Tests cover `MemoQParser`, `TagProtector`, `EntityProtector`, and `ContextBuilder` (27/27 tests passing).

---

## License
MIT License
"# translation-tool" 
