/**
 * Get the pixel coordinates of the caret (cursor) inside a textarea.
 * Uses a hidden mirror div to measure the text position.
 */

const MIRROR_STYLE_PROPS = [
  'boxSizing',
  'width',
  'height',
  'overflowX',
  'overflowY',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'fontSizeAdjust',
  'lineHeight',
  'fontFamily',
  'textAlign',
  'textTransform',
  'textIndent',
  'textDecoration',
  'letterSpacing',
  'wordSpacing',
  'tabSize',
  'whiteSpace',
  'wordWrap',
  'wordBreak',
] as const;

let mirrorDiv: HTMLDivElement | null = null;

export function getCaretCoordinates(
  element: HTMLTextAreaElement,
  position: number,
): { top: number; left: number } {
  // Create mirror div if needed
  if (!mirrorDiv) {
    mirrorDiv = document.createElement('div');
    mirrorDiv.id = 'textarea-caret-mirror';
    document.body.appendChild(mirrorDiv);
  }

  const style = mirrorDiv.style;
  const computed = window.getComputedStyle(element);

  // Position off-screen
  style.position = 'absolute';
  style.visibility = 'hidden';
  style.whiteSpace = 'pre-wrap';
  style.wordWrap = 'break-word';

  // Copy styles from textarea
  for (const prop of MIRROR_STYLE_PROPS) {
    style.setProperty(prop.replace(/([A-Z])/g, '-$1').toLowerCase(), computed.getPropertyValue(prop.replace(/([A-Z])/g, '-$1').toLowerCase()));
  }

  // Handle scrollbar width
  style.overflow = 'hidden';

  // Set content up to caret position
  mirrorDiv.textContent = element.value.substring(0, position);

  // Create span marker at caret position
  const span = document.createElement('span');
  span.textContent = element.value.substring(position) || '.';
  mirrorDiv.appendChild(span);

  // Get element's position
  const rect = element.getBoundingClientRect();

  // Calculate coordinates relative to viewport
  const coordinates = {
    top: rect.top + span.offsetTop - element.scrollTop,
    left: rect.left + span.offsetLeft - element.scrollLeft,
  };

  // Clean up
  mirrorDiv.textContent = '';

  return coordinates;
}
