// --- CONFIG (скопировано из config.js, чтобы popup.js получал правильные надписи) ---
const CONFIG = {
  TITLE: "Summary Page",
  DESCRIPTION: "Генерируйте краткое содержание любой страницы с помощью ИИ.",
  PLACEHOLDER_TEXT: "Нажмите кнопку для создания краткого содержания",
  // Модели и уровни детализации можно оставить для UI, если нужно
  AVAILABLE_MODELS: [
    { id: "llama-4", name: "Llama 4 Maverick" },
    { id: "deepseek-v3", name: "DeepSeek V3 Base" },
    { id: "gemini-2.5", name: "Gemini 2.5 Pro" },
    { id: "qwen2.5-vl", name: "Qwen2.5 VL 32B" }
  ],
  DETAIL_LEVELS: [
    { id: "brief", name: "Кратко" },
    { id: "detailed", name: "Детально" },
    { id: "very-detailed", name: "Очень подробно" }
  ],
  DEFAULT_MODEL: "llama-4"
};

// Store ongoing summaries
let activeSummaryRequests = new Map();

// --- Открытие страницы после установки/обновления расширения ---
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: 'https://summary-page.online/welcome' });
  } else if (details.reason === 'update') {
    chrome.tabs.create({ url: 'https://summary-page.online/whats-new' });
  }
});


// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'rephraseSummary') {
    // Перефразируем только текст уже готового саммари!
    const summaryText = request.data && request.data.summaryText;
    if (!summaryText) {
      sendResponse({ error: 'Нет текста для перефразирования' });
      return true;
    }
    const selectedModel = request.data.model;
    // Строим prompt для LLM
    const prompt = `Перефразируй следующий текст на русском языке, измени структуру и формулировки, сохрани смысл:\n\n${summaryText}`;
    generateSummary({
      prompt,
      selectedModel,
      detailLevel: null,
      rephrase: true
    })
      .then(summary => {
        console.log('Перефразированный summary:', summary);
        if (!summary || typeof summary !== 'string' || summary.trim() === '') {
          sendResponse({ error: 'Модель не вернула текст перефразированного саммари.' });
        } else {
          sendResponse({ summary });
        }
      })
      .catch(error => {
        console.error('Ошибка при перефразировании:', error);
        sendResponse({ error: error.message || String(error) });
      });
    return true;
  }
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
  if (!requestData || (typeof requestData.prompt !== 'string' && !requestData.pageData)) {
    throw new Error('Некорректные данные страницы');
  }

  // Корректно определяем selectedModel
  const selectedModel = requestData.selectedModel || requestData.model || CONFIG.DEFAULT_MODEL;

  let prompt;
  let systemPrompt;
  if (typeof requestData.prompt === 'string') {
    // Перефразирование: используем только prompt
    prompt = requestData.prompt;
    systemPrompt = '';
  } else {
    // Генерация саммари: нужны pageData и detailLevel
    const detailLevel = requestData.detailLevel;
    const detailConfig = CONFIG.DETAIL_LEVELS.find(lvl => lvl.id === detailLevel);
    if (!detailConfig) {
      throw new Error('Некорректный уровень детализации: ' + detailLevel);
    }
    systemPrompt = requestData.detailPromptOverride || detailConfig.systemPrompt;
    const pageData = requestData.pageData;
    prompt = `Создай краткое содержание для следующей веб-страницы:\nЗаголовок: ${pageData.title || 'Без заголовка'}\nURL: ${pageData.url || 'Нет URL'}\nОписание: ${pageData.description || 'Нет описания'}\n\nСодержание:\n${pageData.text.slice(0, 8000)}`;
  }

  // Теперь API принимает text, model, detailLevel, token/userId
  let body = {
    text: prompt,
    model: requestData.selectedModel,
    detailLevel: requestData.detailLevel
  };
  if (requestData.userToken) {
    body.token = requestData.userToken;
  } else if (requestData.userId) {
    body.userId = requestData.userId;
  }

  const response = await fetch('https://summary-page.online/api/generate-summary', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'HTTP-Referer': chrome.runtime.getURL('/'),
      'X-Title': 'Chrome Summary Extension'
    },
    body: JSON.stringify(body)
  });

  let responseData;
  try {
    responseData = await response.json();
  } catch (e) {
    console.error('Ошибка парсинга JSON:', e);
    throw new Error('Ошибка парсинга ответа');
  }

  // Логируем полный ответ для отладки
  console.log('API raw response:', responseData);

  if (response.status === 429) {
    throw new Error('Лимит запросов исчерпан');
  } else if (response.status === 401) {
    throw new Error('Ошибка авторизации');
  } else if (responseData.error) {
    throw new Error(responseData.error.message || JSON.stringify(responseData.error));
  }

  // Попытка найти текст саммари в разных форматах
  if (responseData.summary) {
    return {
      summary: responseData.summary,
      requestsMade: responseData.requestsMade,
      requestsLimit: responseData.requestsLimit
    };
  }

  throw new Error('Некорректный формат ответа API: ' + JSON.stringify(responseData));
}
