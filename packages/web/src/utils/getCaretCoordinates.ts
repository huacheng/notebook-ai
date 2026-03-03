/**
 * Get the pixel coordinates of the caret (cursor) inside a textarea.
 * Returns viewport-relative coordinates.
 */

const properties = [
  'direction', 'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderStyle', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize',
  'fontSizeAdjust', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform',
  'textIndent', 'textDecoration', 'letterSpacing', 'wordSpacing', 'tabSize',
  'MozTabSize', 'whiteSpace', 'wordWrap', 'wordBreak',
] as const;

let div: HTMLDivElement | null = null;

export function getCaretCoordinates(
  element: HTMLTextAreaElement,
  position: number,
): { top: number; left: number } {
  // Lazy create mirror div
  if (!div) {
    div = document.createElement('div');
    div.id = 'input-textarea-caret-position-mirror-div';
    document.body.appendChild(div);
  }

  const style = div.style;
  const computed = getComputedStyle(element);

  // Default styles
  style.whiteSpace = 'pre-wrap';
  style.wordWrap = 'break-word';
  style.position = 'absolute';
  style.top = '0';
  style.left = '0';
  style.visibility = 'hidden';
  style.overflow = 'hidden';

  // Transfer the element's properties to the div
  properties.forEach((prop) => {
    style[prop as any] = computed[prop as any];
  });

  // Firefox doesn't have a proper scrollbar width property
  style.width = `${element.offsetWidth}px`;
  style.height = 'auto';

  // Transfer content
  div.textContent = element.value.substring(0, position);

  // Create a span to mark the caret position
  const span = document.createElement('span');
  // Use zero-width space if at end, otherwise use the remaining text
  span.textContent = element.value.substring(position) || '\u200b';
  div.appendChild(span);

  // Get textarea's bounding rect
  const rect = element.getBoundingClientRect();

  // Compute caret coordinates relative to viewport
  const borderTop = parseInt(computed.borderTopWidth, 10) || 0;
  const paddingTop = parseInt(computed.paddingTop, 10) || 0;
  const borderLeft = parseInt(computed.borderLeftWidth, 10) || 0;
  const paddingLeft = parseInt(computed.paddingLeft, 10) || 0;

  const coordinates = {
    top: rect.top + borderTop + paddingTop + span.offsetTop - element.scrollTop,
    left: rect.left + borderLeft + paddingLeft + span.offsetLeft - element.scrollLeft,
  };

  // Cleanup
  div.innerHTML = '';

  return coordinates;
}
