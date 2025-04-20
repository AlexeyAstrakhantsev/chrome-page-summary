document.addEventListener('DOMContentLoaded', async function() {
  // Google OAuth кнопка
  const googleAuthBtn = document.getElementById('googleAuthBtn');
  const googleAuthStatus = document.getElementById('googleAuthStatus');

  function setGoogleAuthStatus(text, statusClass) {
    googleAuthStatus.textContent = text;
    googleAuthStatus.className = 'google-auth-status' + (statusClass ? ' ' + statusClass : '');
  }

  // Проверка статуса при загрузке (попытка получить токен без interactive)
  if (googleAuthStatus && chrome.identity) {
    chrome.identity.getAuthToken({ interactive: false }, function(token) {
      if (token) {
        setGoogleAuthStatus('Авторизация через Google: успешно', 'success');
      } else {
        setGoogleAuthStatus('Авторизация через Google: не выполнена', 'unknown');
      }
    });
  }

  if (googleAuthBtn && chrome.identity) {
    googleAuthBtn.addEventListener('click', async () => {
      googleAuthBtn.disabled = true;
      googleAuthBtn.textContent = 'Авторизация...';
      chrome.identity.getAuthToken({ interactive: true }, function(token) {
        if (chrome.runtime.lastError) {
          googleAuthBtn.textContent = 'Ошибка авторизации';
          setGoogleAuthStatus('Ошибка авторизации', 'error');
          setTimeout(() => { googleAuthBtn.textContent = 'Войти через Google'; googleAuthBtn.disabled = false; }, 2000);
          console.warn('Google OAuth error:', chrome.runtime.lastError.message);
          return;
        }
        if (token) {
          googleAuthBtn.textContent = 'Успешно!';
          setGoogleAuthStatus('Авторизация через Google: успешно', 'success');
          setTimeout(() => { googleAuthBtn.textContent = 'Войти через Google'; googleAuthBtn.disabled = false; }, 2000);
          console.log('Google OAuth token:', token);
          // Здесь можно отправить токен на сервер для проверки и получить email/ID
        } else {
          googleAuthBtn.textContent = 'Ошибка';
          setGoogleAuthStatus('Ошибка авторизации', 'error');
          setTimeout(() => { googleAuthBtn.textContent = 'Войти через Google'; googleAuthBtn.disabled = false; }, 2000);
        }
      });
    });
  }
  const googleLogoutBtn = document.getElementById('googleLogoutBtn');
  if (googleLogoutBtn && chrome.identity) {
    googleLogoutBtn.addEventListener('click', () => {
      googleLogoutBtn.disabled = true;
      googleLogoutBtn.textContent = 'Выход...';
      chrome.identity.getAuthToken({ interactive: false }, function(token) {
        if (token) {
          chrome.identity.removeCachedAuthToken({ token }, function() {
            setGoogleAuthStatus('Авторизация через Google: не выполнена', 'unknown');
            googleLogoutBtn.textContent = 'Выйти из аккаунта Google';
            googleLogoutBtn.disabled = false;
            googleAuthBtn.disabled = false;
            googleAuthBtn.textContent = 'Войти через Google';
          });
        } else {
          setGoogleAuthStatus('Авторизация через Google: не выполнена', 'unknown');
          googleLogoutBtn.textContent = 'Выйти из аккаунта Google';
          setTimeout(() => { googleLogoutBtn.disabled = false; }, 2000);
          googleAuthBtn.disabled = false;
          googleAuthBtn.textContent = 'Войти через Google';
        }
      });
    });
  }

  window.progressBar = document.getElementById('progressBar');
  window.progressInner = document.getElementById('progressInner');
  window.currentProgress = 0;
  window.progressInterval = null;

  const summarizeBtn = document.getElementById('summarizeBtn');
  const summaryDiv = document.getElementById('summary');
  const loadingDiv = document.getElementById('loading');
  const statusMessage = document.getElementById('statusMessage');
  const modelSelect = document.getElementById('modelSelect');
  const settingsPanel = document.getElementById('settingsPanel');
  const settingsToggle = document.getElementById('settingsToggle');
  const detailButtons = document.querySelectorAll('.detail-button');
  const copyBtn = document.getElementById('copyBtn');
  const rephraseBtn = document.getElementById('rephraseBtn');
  const summaryActions = document.getElementById('summaryActions');
  const copiedLabel = document.getElementById('copiedLabel');
  const placeholderSummary = document.getElementById('placeholderSummary');
  const limitsInfo = document.getElementById('limitsInfo');

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
        summaryDiv.innerHTML = typeof response.summary === 'string' ? response.summary : (response.summary && response.summary.summary ? response.summary.summary : '[Ошибка: некорректный формат ответа]');
        // Показываем лимиты
        if (typeof response.requestsMade === 'number' && typeof response.requestsLimit === 'number') {
          limitsInfo.innerHTML = `Лимит: <b>${response.requestsMade}</b> из <b>${response.requestsLimit}</b> использовано`;
        } else {
          limitsInfo.innerHTML = '';
        }
        showPlaceholder(false);
      } else if (response && response.status === 'processing') {
        startLoadingState();
        updateStatus('Генерируем краткое содержание...');
        showPlaceholder(false); // Не показываем placeholder при генерации
        listenForCompletion(tab.id);
      } else if (response && response.status === 'error') {
        const errorText = response.error || '';
        let errorHtml = 'Ошибка при генерации краткого содержания: ' + errorText;
        summaryDiv.innerHTML = errorHtml;
        // Показываем лимиты даже при ошибке
        if (typeof response.requestsMade === 'number' && typeof response.requestsLimit === 'number') {
          limitsInfo.innerHTML = `Лимит: <b>${response.requestsMade}</b> из <b>${response.requestsLimit}</b> использовано`;
        } else {
          limitsInfo.innerHTML = '';
        }
      }
    }
  });

  // Listen for summary completion
  function listenForCompletion(tabId) {
    chrome.runtime.onMessage.addListener(function messageHandler(message) {
      if (message.action === 'summaryComplete' && message.tabId === tabId) {
        stopLoadingState();
        summaryDiv.innerHTML = typeof message.summary === 'string' ? message.summary : (message.summary && message.summary.summary ? message.summary.summary : '[Ошибка: некорректный формат ответа]');
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

  let hasTriedGenerate = false;

  summarizeBtn.addEventListener('click', async () => {
    hasTriedGenerate = true;
    showPlaceholder(false); // скрываем placeholder мгновенно при клике
    try {
      summaryDiv.innerHTML = ''; // очищаем только при генерации нового саммари
      if (limitsInfo) limitsInfo.innerHTML = '';
      startLoadingState();
      updateStatus('Анализируем содержимое...');
      // placeholder не показываем вообще при генерации
      
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
      // Сохраняем pageData глобально для перефразирования
      window._lastPageData = pageData;
      // Получаем Google OAuth токен перед генерацией
      updateStatus('Получаем токен Google...');
      // Получаем id_token Google через launchWebAuthFlow
      async function getGoogleIdToken(clientId) {
        return new Promise((resolve, reject) => {
          const redirectUri = chrome.identity.getRedirectURL();
          const url =
            'https://accounts.google.com/o/oauth2/v2/auth' +
            '?client_id=' + encodeURIComponent(clientId) +
            '&response_type=id_token' +
            '&redirect_uri=' + encodeURIComponent(redirectUri) +
            '&scope=openid%20email%20profile' +
            '&nonce=' + Math.random().toString(36).substring(2);

          chrome.identity.launchWebAuthFlow(
            { url, interactive: true },
            (redirectUrl) => {
              if (chrome.runtime.lastError || !redirectUrl) {
                resolve(null);
                return;
              }
              const m = redirectUrl.match(/[&#]id_token=([^&]+)/);
              if (m && m[1]) {
                resolve(m[1]);
              } else {
                resolve(null);
              }
            }
          );
        });
      }

      let userToken = null;
      let userId = null;
      const clientId = "97387329038-0ebnm49lsbrun3m9l8r2vpbhfv0m2lo4.apps.googleusercontent.com";
      try {
        userToken = await getGoogleIdToken(clientId);
      } catch (authErr) {
        userToken = null;
      }
      // Если токен не получен — гость, генерируем userId (UUID) и сохраняем в localStorage
      if (!userToken) {
        userId = localStorage.getItem('summary_guest_userId');
        if (!userId) {
          userId = ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
            ((c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & 15)) >> (c / 4)).toString(16)
          );
          localStorage.setItem('summary_guest_userId', userId);
        }
      }
      // Отправляем запрос на генерацию
      updateStatus('Генерируем краткое содержание...');
      let response;
      try {
        response = await chrome.runtime.sendMessage({
          action: 'generateSummary',
          tabId: tab.id,
          data: {
            pageData,
            selectedModel: modelSelect.value,
            detailLevel: selectedDetailLevel,
            ...(userToken ? { userToken } : { userId })
          }
        });
      } catch (err) {
        const errorText = err.message || '';
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
        if (limitsInfo) limitsInfo.innerHTML = '';
        stopLoadingState();
        return;
      }
      summaryDiv.innerHTML = 'Ошибка при генерации краткого содержания: ' + errorText;
      if (limitsInfo) limitsInfo.innerHTML = '';
      stopLoadingState();
    }
  });

  function startLoadingState() {
    if (summaryActions) summaryActions.style.display = 'none';
    if (window.progressBar && window.progressInner) {
      window.currentProgress = 0;
      window.progressInner.style.width = '0%';
      window.progressBar.style.display = '';
      clearInterval(window.progressInterval);
      window.progressInterval = setInterval(() => {
        if (window.currentProgress < 90) {
          window.currentProgress += Math.random() * 2 + 0.5;
          if (window.currentProgress > 90) window.currentProgress = 90;
          window.progressInner.style.width = window.currentProgress + '%';
        }
      }, 120);
    }
    summarizeBtn.disabled = true;
    loadingDiv.style.display = 'block';
    settingsPanel.classList.add('hidden');
    settingsToggle.disabled = true;
    settingsToggle.querySelector('.material-icons').textContent = 'settings';
  }

  function stopLoadingState() {
    // Доводим прогресс-бар до 100% и скрываем
    if (window.progressBar && window.progressInner) {
      clearInterval(window.progressInterval);
      window.progressInner.style.width = '100%';
      setTimeout(() => {
        window.progressBar.style.display = 'none';
        window.progressInner.style.width = '0%';
      }, 300);
    }

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
    if (summaryActions) summaryActions.style.display = show ? '' : 'none';
    if (show && rephraseBtn && !rephraseBtn._handlerAttached) {
      rephraseBtn.addEventListener('click', async () => {
        try {
          startLoadingState();
          updateStatus('Генерируем альтернативный вариант...');
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab) throw new Error('Не удалось получить текущую вкладку');
          // Получаем pageData из последнего сгенерированного саммари
        // Отправляем только текст текущего саммари
        const summaryText = summaryDiv.textContent;
        const response = await chrome.runtime.sendMessage({
            action: 'rephraseSummary',
            tabId: tab.id,
            data: {
              model: modelSelect.value,
              detailLevel: selectedDetailLevel,
              summaryText
            }
          });
           if (response && response.summary) {
             // Полностью заменяем текст саммари новым вариантом
             summaryDiv.textContent = response.summary;
             showCopyButton(true);
             showSummaryBlock(true);
             showPlaceholder(false);
             updateStatus('Альтернативный вариант готов!');
           } else {
             let errMsg = 'Ошибка: не удалось получить альтернативный вариант.';
             if (response && response.error) {
               errMsg += '\n' + response.error;
             }
             summaryDiv.textContent = errMsg;
             updateStatus('Ошибка при генерации.');
           }
        } catch (err) {
          summaryDiv.textContent = 'Ошибка: ' + err.message;
          updateStatus('Ошибка при генерации.');
        } finally {
          stopLoadingState();
        }
      });
      rephraseBtn._handlerAttached = true;
    }
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
  // Показываем или скрываем блоки в зависимости от наличия summary
  const hasSummary = summaryDiv.innerText.trim().length > 0;
  // Если идет генерация (progressBar видим), placeholder не показываем
  const isProcessing = window.progressBar && window.progressBar.style.display !== 'none';
  showCopyButton(hasSummary);
  showSummaryBlock(hasSummary);
  showPlaceholder(!hasSummary && !isProcessing);
}

  // --- Удаляем переопределение innerHTML ---
  // Вместо этого используем MutationObserver для автоматического вызова updateSummaryUI
  const observer = new MutationObserver(() => updateSummaryUI());
  observer.observe(summaryDiv, { childList: true, subtree: true });

  // И дополнительно, если где-то меняется textContent, вызывайте updateSummaryUI() вручную

  updateSummaryUI();


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
