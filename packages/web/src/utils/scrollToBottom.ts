/**
 * Returns true when the user has scrolled up far enough that the bottom
 * of the scrollable container is more than `threshold` pixels away.
 */
export function shouldShowScrollBtn(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold = 200,
): boolean {
  return scrollHeight - scrollTop - clientHeight > threshold;
}
