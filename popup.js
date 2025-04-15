document.addEventListener('DOMContentLoaded', function() {
  const summarizeBtn = document.getElementById('summarizeBtn');
  const summaryDiv = document.getElementById('summary');
  const loadingDiv = document.getElementById('loading');

  summarizeBtn.addEventListener('click', async () => {
    try {
      loadingDiv.style.display = 'block';
      summaryDiv.textContent = '';
      
      // Get the current active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Execute script to get page content
      const [{result}] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: () => {
          // Get main content (you might want to adjust this based on specific sites)
          const article = document.querySelector('article') || document.body;
          return article.innerText;
        }
      });

      // Here you would normally make an API call to AI service
      // For demonstration, we'll use a placeholder
      // Replace this with actual API call to ChatGPT or DeepSeek
      const summary = await generateSummary(result);
      
      summaryDiv.textContent = summary;
    } catch (error) {
      summaryDiv.textContent = 'Error generating summary: ' + error.message;
    } finally {
      loadingDiv.style.display = 'none';
    }
  });
});

// This is a placeholder function - replace with actual API call
async function generateSummary(text) {
  // Here you would make an API call to ChatGPT or DeepSeek
  // For now, we'll return a placeholder message
  return "To generate actual summaries, you need to:\n\n" +
         "1. Sign up for an AI API (ChatGPT or DeepSeek)\n" +
         "2. Get your API key\n" +
         "3. Implement the API call with your key\n\n" +
         "The page content has been captured and is ready for summarization!";
}
