/** A post's address on its platform; anything but an https address is shown as text, never as a link. */
export function Permalink({ url, label = "View post" }: { url: string | null; label?: string }) {
  if (url === null) return <span>No address</span>;
  if (!url.startsWith("https://")) return <span>{url}</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );
}
