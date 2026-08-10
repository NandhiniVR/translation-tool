import { TranslationPipeline } from '../translation/TranslationPipeline.js';
import type { TranslationSegment, BatchPromptInput, BatchSegmentInputItem } from '../types/index.js';
import { PromptBuilder } from '../translation/PromptBuilder.js';
import { getDomainConfig } from '../domains/domainRegistry.js';
import { getLanguageRules } from '../languages/languageRegistry.js';
import { ProviderFactory } from '../translation/ProviderFactory.js';
import { config } from '../config/index.js';

async function testReverseBatch() {
  const sourceLanguage = 'ta';
  const targetLanguage = 'en';
  const domain = 'general';

  const batchInputItems: BatchSegmentInputItem[] = [
    {
      id: 'seg-1',
      sourceText: 'வணக்கம், நீங்கள் எப்படி இருக்கிறீர்கள்?'
    },
    {
      id: 'seg-2',
      sourceText: 'இது ஒரு சோதனை ஆவணம்'
    }
  ];

  console.log('Testing Tamil -> English with Groq (Batch JSON)...');
  
  const promptBuilder = new PromptBuilder();
  const domainConfig = getDomainConfig(domain);
  const languageRules = getLanguageRules(targetLanguage);
  
  const batchPromptInput: BatchPromptInput = {
    sourceLanguage,
    targetLanguage,
    domain,
    items: batchInputItems,
    glossaryTerms: [],
    languageRules,
    domainInstructions: domainConfig.promptInstructions,
  };

  const systemPrompt = promptBuilder.buildBatchSystemPrompt(batchPromptInput);
  const userPrompt = promptBuilder.buildBatchUserPrompt(batchPromptInput);

  console.log('====================================');
  console.log('SYSTEM PROMPT:');
  console.log(systemPrompt);
  console.log('====================================');
  console.log('USER PROMPT:');
  console.log(userPrompt);
  console.log('====================================');

  const provider = ProviderFactory.getProvider('groq');
  
  try {
    const apiResponse = await provider.translate(systemPrompt, userPrompt, { jsonMode: true });
    console.log('API RESPONSE:');
    console.log(apiResponse.text);
    
    // Parse using Pipeline logic
    const pipeline = new (TranslationPipeline as any)();
    const parsed = pipeline.extractBatchArray(apiResponse.text);
    console.log('PARSED ARRAY:');
    console.log(JSON.stringify(parsed, null, 2));
  } catch (err) {
    console.error('API Error:', err);
  }
}

testReverseBatch().catch(console.error);
