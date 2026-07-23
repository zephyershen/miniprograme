const COMMENT_EMOJIS = Object.freeze([
  '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣',
  '😊', '🙂', '🙃', '😉', '😍', '🥰', '😘', '😋',
  '😜', '🤪', '🤓', '😎', '🥳', '🤩', '😏', '😌',
  '😔', '🥺', '😢', '😭', '😤', '😡', '🤯', '😱',
  '🥶', '🥵', '🫠', '🤔', '🫡', '🤫', '🙄', '😴',
  '👍', '👎', '👏', '🙌', '🫶', '🤝', '💪', '🙏',
  '✌️', '🤞', '👀', '💡', '🔥', '🎉', '✅', '❤️',
  '💔', '🌟', '🚀', '💯', '🎈', '🌹', '☕', '🍻'
]);

function positivePixels(value) {
  const pixels = Math.floor(Number(value) || 0);
  return pixels > 0 ? pixels : 0;
}

function keyboardDockState(keyboardHeight, windowHeight) {
  const keyboard = positivePixels(keyboardHeight);
  if (!keyboard) return { keyboardOpen: false, sheetStyle: '' };

  const viewport = positivePixels(windowHeight);
  const sheetHeight = viewport > keyboard
    ? `${Math.max(0, viewport - keyboard - 12)}px`
    : `calc(100vh - ${keyboard}px - 12px)`;
  return {
    keyboardOpen: true,
    sheetStyle: `bottom:${keyboard}px;height:${sheetHeight};`
  };
}

module.exports = {
  COMMENT_EMOJIS,
  keyboardDockState
};
