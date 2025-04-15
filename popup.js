document.addEventListener('DOMContentLoaded', async function() {
  const summarizeBtn = document.getElementById('summarizeBtn');
  const summaryDiv = document.getElementById('summary');
  const loadingDiv = document.getElementById('loading');
  const statusMessage = document.getElementById('statusMessage');
  const modelSelect = document.getElementById('modelSelect');
  const settingsPanel = document.getElementById('settingsPanel');
  const settingsToggle = document.getElementById('settingsToggle');
  const detailButtons = document.querySelectorAll('.detail-button');
  const copyBtn = document.getElementById('copyBtn');
  const copiedLabel = document.getElementById('copiedLabel');
  const placeholderSummary = document.getElementById('placeholderSummary');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const apiKeySaved = document.getElementById('apiKeySaved');

  let selectedDetailLevel = 'brief';

  // Toggle settings panel
  settingsToggle.addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
    const isHidden = settingsPanel.classList.contains('hidden');
    settingsToggle.querySelector('.material-icons').textContent = isHidden ? 'settings' : 'close';
  });

  // Handle detail level selection
  detailButtons.forEach(button => {
    button.addEventListener('click', () => {
      detailButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      selectedDetailLevel = button.dataset.level;
    });
  });

  // Get config from background script
  let CONFIG = null;
  try {
    CONFIG = await chrome.runtime.sendMessage({ action: 'getConfig' });
  } catch (err) {
    summaryDiv.innerHTML = 'Ошибка: не удалось связаться с сервисом (background.js). Перезагрузите расширение.';
    return;
  }

  // --- UI: заголовок, описание, placeholder ---
  console.log('CONFIG:', CONFIG);
  const headerTitle = document.querySelector('.header h2');
  console.log('headerTitle:', headerTitle);
  if (headerTitle) {
    headerTitle.textContent = CONFIG.TITLE;
    console.log('Заголовок установлен:', CONFIG.TITLE);
  } else {
    console.warn('Заголовок не найден в DOM');
  }

  const desc = document.getElementById('descriptionText');
  if (desc) desc.textContent = CONFIG.DESCRIPTION;

  if (placeholderSummary) {
    const placeholderTextSpan = placeholderSummary.querySelector('span:last-child');
    if (placeholderTextSpan) placeholderTextSpan.textContent = CONFIG.PLACEHOLDER_TEXT;
  }

  // --- Populate model selector ---
  modelSelect.innerHTML = '';
  CONFIG.AVAILABLE_MODELS.forEach(model => {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.name;
    option.setAttribute('data-prompt', model.prompt || '');
    modelSelect.appendChild(option);
  });

  // Check if there's an ongoing or completed summary for current tab
  chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
    if (tab) {
      updateStatus('Проверяем статус...');
      let response;
      try {
        response = await chrome.runtime.sendMessage({
          action: 'checkSummaryStatus',
          tabId: tab.id
        });
      } catch (err) {
        const errorText = err.message || '';
        if (errorText.includes('Rate limit exceeded: free-models-per-day')) {
          const rateLimitHtml = '<div style="color:#b71c1c;font-weight:bold;line-height:1.4;padding:4px 0 0 0;">Лимит бесплатных запросов OpenRouter исчерпан.<br>Пополните баланс на <a href="https://openrouter.ai/credits" target="_blank" style="color:#1565c0;">openrouter.ai/credits</a> или попробуйте позже.</div>';
          summaryDiv.innerHTML = rateLimitHtml;
          return;
        }
        summaryDiv.innerHTML = 'Ошибка: не удалось связаться с сервисом (background.js). Перезагрузите расширение.';
        return;
      }

      if (response && response.status === 'completed') {
        summaryDiv.innerHTML = response.summary;
      } else if (response && response.status === 'processing') {
        startLoadingState();
        updateStatus('Генерируем краткое содержание...');
        listenForCompletion(tab.id);
      } else if (response && response.status === 'error') {
        const errorText = response.error || '';
        if (errorText.includes('Rate limit exceeded: free-models-per-day')) {
          const rateLimitHtml = '<div style="color:#b71c1c;font-weight:bold;line-height:1.4;padding:4px 0 0 0;">Лимит бесплатных запросов OpenRouter исчерпан.<br>Пополните баланс на <a href="https://openrouter.ai/credits" target="_blank" style="color:#1565c0;">openrouter.ai/credits</a> или попробуйте позже.</div>';
          summaryDiv.innerHTML = rateLimitHtml;
          return;
        }
        summaryDiv.innerHTML = 'Ошибка при генерации краткого содержания: ' + errorText;
      }
    }
  });

  // Listen for summary completion
  function listenForCompletion(tabId) {
    chrome.runtime.onMessage.addListener(function messageHandler(message) {
      if (message.action === 'summaryComplete' && message.tabId === tabId) {
        stopLoadingState();
        summaryDiv.innerHTML = message.summary;
        updateSummaryUI();
        chrome.runtime.onMessage.removeListener(messageHandler);
      } else if (message.action === 'summaryError' && message.tabId === tabId) {
        stopLoadingState();
        const errorText = message.error || '';
        if (errorText.includes('Rate limit exceeded: free-models-per-day')) {
          const rateLimitHtml = '<div style="color:#b71c1c;font-weight:bold;line-height:1.4;padding:4px 0 0 0;">Лимит бесплатных запросов OpenRouter исчерпан.<br>Пополните баланс на <a href="https://openrouter.ai/credits" target="_blank" style="color:#1565c0;">openrouter.ai/credits</a> или попробуйте позже.</div>';
          summaryDiv.innerHTML = rateLimitHtml;
          chrome.runtime.onMessage.removeListener(messageHandler);
          return;
        }
        summaryDiv.innerHTML = 'Ошибка при генерации краткого содержания: ' + errorText;
        chrome.runtime.onMessage.removeListener(messageHandler);
      }
    });
  }

  summarizeBtn.addEventListener('click', async () => {
    try {
      startLoadingState();
      updateStatus('Анализируем содержимое...');
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        throw new Error('Активная вкладка не найдена');
      }
      
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          // Try to get the main content using various selectors
          const selectors = [
            'article',
            'main',
            '[role="main"]',
            '.content',
            '#content',
            '.article',
            '#article'
          ];
          
          let mainContent = null;
          for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
              mainContent = element;
              break;
            }
          }
          
          // If no specific content container found, use body
          const article = mainContent || document.body;
          const text = article.innerText || article.textContent;
          
          // Get meta description if available
          const metaDescription = document.querySelector('meta[name="description"]')?.content || '';
          
          return {
            text: text,
            title: document.title,
            url: window.location.href,
            description: metaDescription
          };
        }
      });

      if (!results || !results[0] || !results[0].result) {
        throw new Error('Не удалось получить содержимое страницы');
      }

      const pageData = results[0].result;

      // Send message to background script to start generation
      updateStatus('Генерируем краткое содержание...');
      let response;
      try {
        response = await chrome.runtime.sendMessage({
          action: 'generateSummary',
          tabId: tab.id,
          data: {
            pageData,
            selectedModel: modelSelect.value,
            detailLevel: selectedDetailLevel
          }
        });
      } catch (err) {
        const errorText = err.message || '';
        if (errorText.includes('Rate limit exceeded: free-models-per-day')) {
          const rateLimitHtml = '<div style="color:#b71c1c;font-weight:bold;line-height:1.4;padding:4px 0 0 0;">Лимит бесплатных запросов OpenRouter исчерпан.<br>Пополните баланс на <a href="https://openrouter.ai/credits" target="_blank" style="color:#1565c0;">openrouter.ai/credits</a> или попробуйте позже.</div>';
          summaryDiv.innerHTML = rateLimitHtml;
          stopLoadingState();
          return;
        }
        summaryDiv.innerHTML = 'Ошибка: не удалось связаться с сервисом (background.js). Перезагрузите расширение.';
        stopLoadingState();
        return;
      }

      if (response && response.status === 'processing') {
        listenForCompletion(tab.id);
      } else {
        throw new Error('Неожиданный ответ от background script');
      }
    } catch (error) {
      console.error('Error:', error);
      const errorText = error.message || '';
      if (errorText.includes('Rate limit exceeded: free-models-per-day')) {
        const rateLimitHtml = '<div style="color:#b71c1c;font-weight:bold;line-height:1.4;padding:4px 0 0 0;">Лимит бесплатных запросов OpenRouter исчерпан.<br>Пополните баланс на <a href="https://openrouter.ai/credits" target="_blank" style="color:#1565c0;">openrouter.ai/credits</a> или попробуйте позже.</div>';
        summaryDiv.innerHTML = rateLimitHtml;
        stopLoadingState();
        return;
      }
      summaryDiv.innerHTML = 'Ошибка при генерации краткого содержания: ' + errorText;
      stopLoadingState();
    }
  });

  function startLoadingState() {
    summarizeBtn.disabled = true;
    loadingDiv.style.display = 'block';
    summaryDiv.innerHTML = '';
    settingsPanel.classList.add('hidden');
    settingsToggle.disabled = true;
    settingsToggle.querySelector('.material-icons').textContent = 'settings';
  }

  function stopLoadingState() {
    summarizeBtn.disabled = false;
    loadingDiv.style.display = 'none';
    settingsToggle.disabled = false;
    const isHidden = settingsPanel.classList.contains('hidden');
    settingsToggle.querySelector('.material-icons').textContent = isHidden ? 'settings' : 'close';
  }

  function updateStatus(message) {
    statusMessage.textContent = message;
  }

  function showCopyButton(show) {
    copyBtn.style.display = show ? '' : 'none';
  }
  function showPlaceholder(show) {
    placeholderSummary.style.display = show ? '' : 'none';
  }
  function showSummaryBlock(show) {
    summaryDiv.style.display = show ? '' : 'none';
  }

  copyBtn.addEventListener('click', async () => {
    const text = summaryDiv.innerText;
    if (text) {
      await navigator.clipboard.writeText(text);
      copiedLabel.classList.add('visible');
      setTimeout(() => copiedLabel.classList.remove('visible'), 1200);
    }
  });

  function updateSummaryUI() {
    const hasSummary = summaryDiv.innerText.trim().length > 0;
    showCopyButton(hasSummary);
    showSummaryBlock(hasSummary);
    showPlaceholder(!hasSummary);
  }

  // --- Удаляем переопределение innerHTML ---
  // Вместо этого используем MutationObserver для автоматического вызова updateSummaryUI
  const observer = new MutationObserver(() => updateSummaryUI());
  observer.observe(summaryDiv, { childList: true, subtree: true });

  // И дополнительно, если где-то меняется textContent, вызывайте updateSummaryUI() вручную

  updateSummaryUI();

  // --- API KEY UI ---
  chrome.storage.local.get(['OPENAI_API_KEY'], ({ OPENAI_API_KEY }) => {
    console.log('OPENAI_API_KEY из storage:', OPENAI_API_KEY);
    if (!OPENAI_API_KEY) {
      if (apiKeyInput) {
        apiKeyInput.focus();
        apiKeyInput.placeholder = 'Введите ваш API-ключ';
      }
      updateStatus('API-ключ не указан. Введите свой ключ в настройках расширения.');
    }
  });

  apiKeyInput.addEventListener('input', () => {
    chrome.storage.local.set({ OPENAI_API_KEY: apiKeyInput.value }, () => {
      apiKeySaved.style.display = 'inline';
      setTimeout(() => { apiKeySaved.style.display = 'none'; }, 1200);
    });
  });

  // Save settings to storage
  function saveSettings() {
    chrome.storage.local.set({
      selectedModel: modelSelect.value,
      selectedDetailLevel: selectedDetailLevel
    });
  }

  // Load settings from storage
  chrome.storage.local.get(['selectedModel', 'selectedDetailLevel'], (result) => {
    if (result.selectedModel) {
      modelSelect.value = result.selectedModel;
    } else if (CONFIG.DEFAULT_MODEL) {
      modelSelect.value = CONFIG.DEFAULT_MODEL;
    }
    if (result.selectedDetailLevel) {
      selectedDetailLevel = result.selectedDetailLevel;
      detailButtons.forEach(btn => {
        if (btn.dataset.level === selectedDetailLevel) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
    }
  });

  // Save settings when changed
  modelSelect.addEventListener('change', saveSettings);
  detailButtons.forEach(btn => {
    btn.addEventListener('click', saveSettings);
  });
});
