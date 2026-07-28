const GSM_BASIC = new Set(Array.from("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ`¿abcdefghijklmnopqrstuvwxyzäöñüà"));
const GSM_EXTENDED = new Set(Array.from("^{}\\[~]|€"));

export function smsPartCount(value) {
  const text = String(value || "");
  if (!text) return 0;
  let gsmUnits = 0;
  let gsm = true;
  for (const character of text) {
    if (GSM_BASIC.has(character)) gsmUnits += 1;
    else if (GSM_EXTENDED.has(character)) gsmUnits += 2;
    else { gsm = false; break; }
  }
  if (gsm) return gsmUnits <= 160 ? 1 : Math.ceil(gsmUnits / 153);
  const unicodeLength = Array.from(text).length;
  return unicodeLength <= 70 ? 1 : Math.ceil(unicodeLength / 67);
}

export function smsBundleCount(parts, bundleSize = 50) {
  const count = Math.max(0, Number(parts || 0));
  return count === 0 ? 0 : Math.ceil(count / bundleSize);
}
