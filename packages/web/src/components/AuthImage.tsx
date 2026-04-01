import { useState, useEffect } from 'react';

/**
 * Image component that fetches via Authorization header instead of embedding
 * tokens in the URL. Prevents credential leakage in browser history, logs,
 * and referrer headers.
 */
export function AuthImage({ src, alt, style, ...rest }: React.ImgHTMLAttributes<HTMLImageElement>) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!src) return;
    let revoked = false;
    const token = sessionStorage.getItem('nb-auth-token');
    fetch(src, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (revoked) return;
        setBlobUrl(URL.createObjectURL(blob));
      })
      .catch(() => {
        if (!revoked) setError(true);
      });
    return () => {
      revoked = true;
      setBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    };
  }, [src]);

  if (error) return <span title={`Failed to load: ${alt ?? src}`}>🖼️</span>;
  if (!blobUrl) return <span style={{ display: 'inline-block', width: 24, height: 24, background: '#e7e5e4', borderRadius: 4 }} />;
  return <img src={blobUrl} alt={alt ?? ''} style={style} {...rest} />;
}
