/**
 * Existing conversation loads replace the message list; new turns append to
 * the existing list. Only appended turns should animate the follow-to-bottom
 * behavior.
 */
export function shouldAnimateChatScroll(previousMessages, messages) {
  if (!Array.isArray(previousMessages) || previousMessages.length === 0) return false;
  if (!Array.isArray(messages) || messages.length < previousMessages.length) return false;
  return previousMessages.every((message, index) => messages[index] === message);
}
