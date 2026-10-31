(() => {
  const thread = document.querySelector('[data-message-thread]');
  if (!thread || thread.dataset.messageOlder === 'true') return;

  const status = document.querySelector('[data-message-status]');
  const olderLink = document.querySelector('[data-older-messages]');
  const emptyMessage = document.querySelector('[data-message-empty]');
  let signature = Array.from(thread.querySelectorAll('[data-message-id]'), item => item.dataset.messageId).join('|');
  let pending = false;
  let stopped = false;
  let generation = 0;
  let controller;
  const timeFormat = new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
  });
  if (status) {
    status.hidden = false;
    status.textContent = 'Messages refresh automatically while this page is visible.';
  }
  thread.scrollTop = thread.scrollHeight;

  function renderMessage(message) {
    const item = document.createElement('li');
    item.className = `message-row${message.isOwn ? ' message-own' : ''}`;
    item.dataset.messageId = message.id;
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    const sender = document.createElement('strong');
    sender.textContent = message.isOwn ? 'You' : message.senderName;
    const time = document.createElement('time');
    time.dateTime = message.createdAt;
    time.textContent = timeFormat.format(new Date(message.createdAt));
    meta.append(sender, time);
    const text = document.createElement('p');
    text.className = 'preserve-lines';
    text.textContent = message.body;
    bubble.append(meta, text);
    item.append(bubble);
    return item;
  }

  async function refreshMessages() {
    if (stopped || pending || document.visibilityState !== 'visible') return;
    pending = true;
    const requestGeneration = ++generation;
    const requestController = new AbortController();
    controller = requestController;
    const timeout = setTimeout(() => requestController.abort(), 12000);
    try {
      const response = await fetch(thread.dataset.messageUpdates, {
        credentials: 'same-origin', cache: 'no-store', signal: requestController.signal, headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('Updates unavailable');
      const data = await response.json();
      if (stopped || requestGeneration !== generation || document.visibilityState !== 'visible') return;
      if (!Array.isArray(data.messages)) throw new Error('Invalid message update');
      const nextSignature = data.messages.map(message => message.id).join('|');
      if (nextSignature !== signature) {
        const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 120;
        const previousScrollTop = thread.scrollTop;
        const fragment = document.createDocumentFragment();
        data.messages.forEach(message => fragment.append(renderMessage(message)));
        thread.replaceChildren(fragment);
        thread.scrollTop = nearBottom ? thread.scrollHeight : previousScrollTop;
        signature = nextSignature;
      }
      if (olderLink) {
        olderLink.hidden = !data.olderCursor;
        if (data.olderCursor) {
          const base = thread.dataset.messageUpdates.replace(/\/updates$/, '');
          olderLink.href = `${base}?before=${encodeURIComponent(data.olderCursor)}`;
        }
      }
      if (emptyMessage) emptyMessage.hidden = data.messages.length > 0;
      if (status) status.textContent = 'Messages are up to date.';
    } catch (error) {
      if (!stopped && requestGeneration === generation && error.name !== 'AbortError' && status) {
        status.textContent = 'Updates unavailable. Refresh to check for new messages.';
      }
    } finally {
      clearTimeout(timeout);
      pending = false;
    }
  }

  let interval = setInterval(refreshMessages, 5000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshMessages();
    } else {
      generation += 1;
      if (controller) controller.abort();
    }
  });
  window.addEventListener('pagehide', () => {
    stopped = true;
    generation += 1;
    clearInterval(interval);
    if (controller) controller.abort();
  });
  window.addEventListener('pageshow', () => {
    if (!stopped) return;
    stopped = false;
    interval = setInterval(refreshMessages, 5000);
    refreshMessages();
  });
})();
