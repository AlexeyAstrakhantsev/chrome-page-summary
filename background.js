// --- CONFIG (скопировано из config.js, чтобы popup.js получал правильные надписи) ---
const CONFIG = {
  OPENAI_API_BASE_URL: "https://openrouter.ai/api/v1",
  TITLE: "Summary Page",
  DESCRIPTION: "Генерируйте краткое содержание любой страницы с помощью ИИ.",
  PLACEHOLDER_TEXT: "Нажмите кнопку для создания краткого содержания",
  AVAILABLE_MODELS: [
    {
      id: "meta-llama/llama-4-maverick:free",
      name: "Llama 4 Maverick",
      prompt: "Сделай краткое структурированное саммари на русском языке."
    },
    {
      id: "deepseek/deepseek-v3-base:free",
      name: "DeepSeek V3 Base",
      prompt: "Сделай подробное саммари на русском языке."
    },
    {
      id: "google/gemini-2.5-pro-exp-03-25:free",
      name: "Gemini 2.5 Pro",
      prompt: "Сделай саммари для специалистов."
    },
    {
      id: "qwen/qwen2.5-vl-32b-instruct:free",
      name: "Qwen2.5 VL 32B",
      prompt: "Сделай краткое саммари с ключевыми фактами."
    }
  ],
  DETAIL_LEVELS: {
    brief: {
      systemPrompt: `Ты - опытный редактор, создающий краткие обзоры текста. 
Твоя задача - создать лаконичное саммари на русском языке:
1. Начни с 1-2 предложений, описывающих суть
2. Выдели 2-3 ключевых момента
3. Общий объем - 1-2 абзаца`
    },
    detailed: {
      systemPrompt: `Ты - опытный редактор, специализирующийся на создании информативных обзоров текста. 
Твоя задача - создать качественное саммари на русском языке:
1. Отрази основные идеи и ключевые моменты
2. Сохрани важные детали и цифры
3. Используй четкую структуру
4. Общий объем - 3-4 абзаца

Формат:
• Начни с 1-2 предложений о сути
• Выдели 3-4 ключевых момента
• Добавь важные цифры и факты`
    },
    'very-detailed': {
      systemPrompt: `Ты - опытный аналитик, создающий подробные обзоры текста. 
Твоя задача - создать детальное саммари на русском языке:
1. Глубоко раскрой основные темы и идеи
2. Сохрани все важные детали, цифры и факты
3. Добавь контекст и связи между идеями
4. Используй четкую структуру
5. Общий объем - 5-6 абзацев

Формат:
• Начни с краткого обзора (2-3 предложения)
• Подробно опиши 4-5 ключевых аспектов
• Включи все важные данные и цитаты
• Добавь выводы или заключение`
    }
  },
  DEFAULT_MODEL: "meta-llama/llama-4-maverick:free"
};

// Store ongoing summaries
let activeSummaryRequests = new Map();

// --- Получение API-ключа из chrome.storage.local ---
async function getApiKey() {
  return new Promise(resolve => {
    chrome.storage.local.get(['OPENAI_API_KEY'], ({ OPENAI_API_KEY }) => {
      resolve(OPENAI_API_KEY || '');
    });
  });
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getConfig') {
    sendResponse(CONFIG);
    return true;
  }

  if (request.action === 'generateSummary') {
    // Set initial processing status
    activeSummaryRequests.set(request.tabId, {
      status: 'processing',
      startTime: Date.now()
    });

    // Start summary generation
    generateSummary(request.data)
      .then(summary => {
        // Store the result
        activeSummaryRequests.set(request.tabId, {
          status: 'completed',
          summary: summary,
          completionTime: Date.now()
        });
        // Notify any open popups
        chrome.runtime.sendMessage({
          action: 'summaryComplete',
          tabId: request.tabId,
          summary: summary
        });
      })
      .catch(error => {
        activeSummaryRequests.set(request.tabId, {
          status: 'error',
          error: error.message,
          completionTime: Date.now()
        });
        // Notify any open popups
        chrome.runtime.sendMessage({
          action: 'summaryError',
          tabId: request.tabId,
          error: error.message
        });
      });

    // Immediately respond that we've started processing
    sendResponse({ status: 'processing' });
    return true; // Keep the message channel open for async response
  }

  if (request.action === 'checkSummaryStatus') {
    const result = activeSummaryRequests.get(request.tabId);
    sendResponse(result || { status: 'not_found' });
    return true;
  }
});

async function generateSummary(requestData) {
  const { pageData, selectedModel = CONFIG.DEFAULT_MODEL, detailLevel = 'detailed' } = requestData;

  if (!pageData || !pageData.text) {
    throw new Error('Некорректные данные страницы');
  }

  const detailConfig = CONFIG.DETAIL_LEVELS[detailLevel];
  if (!detailConfig) {
    throw new Error('Некорректный уровень детализации: ' + detailLevel);
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('API-ключ не указан. Введите свой ключ в настройках расширения.');
  }

  const prompt = `Создай краткое содержание для следующей веб-страницы:\nЗаголовок: ${pageData.title || 'Без заголовка'}\nURL: ${pageData.url || 'Нет URL'}\nОписание: ${pageData.description || 'Нет описания'}\n\nСодержание:\n${pageData.text.slice(0, 8000)}`;

  const response = await fetch(CONFIG.OPENAI_API_BASE_URL + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': chrome.runtime.getURL('/'),
      'X-Title': 'Chrome Summary Extension'
    },
    body: JSON.stringify({
      model: selectedModel,
      messages: [
        {
          role: "system",
          content: detailConfig.systemPrompt
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7
    })
  });

  let responseData;
  try {
    responseData = await response.json();
  } catch (e) {
    console.error('Ошибка парсинга JSON от OpenRouter:', e);
    throw new Error('Ошибка парсинга ответа от OpenRouter');
  }

  // Логируем полный ответ для отладки
  console.log('OpenRouter API raw response:', responseData);

  if (responseData.error) {
    throw new Error(responseData.error.message || JSON.stringify(responseData.error));
  }

  // Попытка найти текст саммари в разных форматах
  if (responseData.choices && responseData.choices[0] && responseData.choices[0].message) {
    return responseData.choices[0].message.content;
  }
  if (responseData.choices && responseData.choices[0] && responseData.choices[0].text) {
    return responseData.choices[0].text;
  }
  if (responseData.message) {
    return responseData.message;
  }

  throw new Error('Некорректный формат ответа API: ' + JSON.stringify(responseData));
}
