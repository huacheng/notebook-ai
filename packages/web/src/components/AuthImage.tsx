import { useState, useEffect } from 'react';

/**
 * Image that fetches via cookie-based auth and rehosts as a blob URL,
 * preventing token leakage in browser history, logs, or referrer.
 */
export function AuthImage({ src, alt, style, ...rest }: React.ImgHTMLAttributes<HTMLImageElement>) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!src) return;
    let revoked = false;
    fetch(src, { credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (revoked) return;
        setBlobUrl(URL.createObjectURL(blob));
      })
      .catch(() => { if (!revoked) setError(true); });
    return () => {
      revoked = true;
      setBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    };
  }, [src]);

  if (error) return <span title={`Failed to load: ${alt ?? src}`}>🖼️</span>;
  if (!blobUrl) return <span style={{ display: 'inline-block', width: 24, height: 24, background: '#e7e5e4', borderRadius: 4 }} />;
  return <img src={blobUrl} alt={alt ?? ''} style={style} {...rest} />;
}
