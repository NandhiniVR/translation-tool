import { TranslationPipeline } from '../translation/TranslationPipeline.js';
import type { TranslationSegment } from '../types/index.js';
import { PromptBuilder } from '../translation/PromptBuilder.js';
import { getDomainConfig } from '../domains/domainRegistry.js';
import { getLanguageRules } from '../languages/languageRegistry.js';
import { ProviderFactory } from '../translation/ProviderFactory.js';
import { config } from '../config/index.js';

async function testReverse() {
  const sourceText = 'வணக்கம், நீங்கள் எப்படி இருக்கிறீர்கள்?';
  const sourceLanguage = 'ta';
  const targetLanguage = 'en';
  const domain = 'general';

  console.log('Testing Tamil -> English with Groq...');
  
  const promptBuilder = new PromptBuilder();
  const domainConfig = getDomainConfig(domain);
  const languageRules = getLanguageRules(targetLanguage);
  
  const promptInput = {
    sourceLanguage,
    targetLanguage,
    domain,
    context: {
      nodeRefs: [],
      previousText: '',
      nextText: '',
    },
    protectedText: sourceText,
    glossaryTerms: [],
    languageRules,
    domainInstructions: domainConfig.promptInstructions,
  };

  const systemPrompt = promptBuilder.buildSystemPrompt(promptInput);
  const userPrompt = promptBuilder.buildUserPrompt(promptInput);

  console.log('====================================');
  console.log('SYSTEM PROMPT:');
  console.log(systemPrompt);
  console.log('====================================');
  console.log('USER PROMPT:');
  console.log(userPrompt);
  console.log('====================================');

  const provider = ProviderFactory.getProvider('groq', 'llama-3.1-70b-versatile'); // Using typical model name
  
  try {
    const apiResponse = await provider.translate(systemPrompt, userPrompt, { jsonMode: false });
    console.log('API RESPONSE:');
    console.log(apiResponse.text);
  } catch (err) {
    console.error('API Error:', err);
  }
}

testReverse().catch(console.error);
