export function validateTelegramUser(updateLike) {
  const msg = updateLike?.message || updateLike;
  const chatId = msg?.chat?.id ?? updateLike?.chat?.id;
  const allowedChatId = process.env.TELEGRAM_CHAT_ID;
  const topicId = process.env.TELEGRAM_TOPIC_ID;
  if (!allowedChatId) return false;
  if (String(chatId) !== String(allowedChatId)) return false;
  if (topicId) {
    const threadId = msg?.message_thread_id ?? updateLike?.message_thread_id;
    if (threadId != null && String(threadId) !== String(topicId)) return false;
  }
  return true;
}

export function validateCallback(query) {
  if (!validateTelegramUser(query?.message || query)) return false;
  const data = String(query?.data || '');
  if (data.length > 80) return false;
  return /^[a-z0-9_:-]+$/i.test(data);
}
