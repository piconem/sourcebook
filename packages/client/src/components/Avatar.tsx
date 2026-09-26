/** Initials in a colored circle; the hue is derived from the username so each person keeps a color. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
  return letters.toUpperCase();
}

export function hueOf(key: string): number {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return h;
}

export function Avatar({ name, username, size = 28 }: { name: string; username: string; size?: number }) {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${hueOf(username)} 55% 45%)` }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
