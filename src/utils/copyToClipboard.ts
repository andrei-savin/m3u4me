/**
 * Copies text to the clipboard. Resolves to true if it worked, so the caller can show
 * "Copied" (or an error).
 *
 * The app is usually opened over plain `http://<LAN-IP>`, which browsers don't count as
 * secure, and there `navigator.clipboard` doesn't exist. The fallback copies from a
 * hidden text box instead (the old execCommand way). `readonly` stops a phone from
 * opening its keyboard for that box, setSelectionRange is needed because iPhones
 * ignore select() on its own, and the 16px text stops iPhones zooming the whole page in,
 * which they do when any text box with smaller text gets focus.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission refused or similar: try the fallback below.
    }
  }
  const el = document.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');
  el.style.cssText = 'position:fixed;opacity:0;top:0;left:0;font-size:16px;';
  document.body.appendChild(el);
  el.select();
  el.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { console.error(e); }
  document.body.removeChild(el);
  return ok;
}
