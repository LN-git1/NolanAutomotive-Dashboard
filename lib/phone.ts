/**
 * Phone numbers for `wa.me` links.
 *
 * WhatsApp's click-to-chat URL takes a number in full international form with no
 * `+`, no spaces and no leading zero: `https://wa.me/353871234567`. Anything
 * else — including the `087 123 4567` an Irish customer's number is written as —
 * silently fails, which is why the WhatsApp button opened a contact picker
 * instead of the customer's chat.
 */

/** Ireland. The garage is in Kilcock; every customer number is local by default. */
export const DEFAULT_COUNTRY_CODE = '353';

/**
 * Normalise a phone number to the digits-only international form `wa.me` wants.
 *
 * Handles the shapes a number is actually stored in:
 *
 *   "087 430 3785"    -> "353874303785"   (national, leading 0 replaced)
 *   "+353 87 430 3785"-> "353874303785"   (already international)
 *   "00353874303785"  -> "353874303785"   (00 international prefix)
 *   "(087) 430-3785"  -> "353874303785"   (punctuation stripped)
 *   "353874303785"    -> "353874303785"   (unchanged)
 *
 * Returns null when there is nothing usable, so callers can fall back to a
 * contact picker rather than building a broken link.
 */
export function toWhatsAppNumber(
  input: string | null | undefined,
  countryCode: string = DEFAULT_COUNTRY_CODE,
): string | null {
  if (!input) return null;

  const trimmed = input.trim();
  if (trimmed === '') return null;

  // A leading + means the number is already international.
  const hadPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');

  if (digits === '') return null;

  if (hadPlus) {
    // Nothing to add — the digits after + are the full international number.
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0')) {
    // National format: the trunk 0 is replaced by the country code, not kept.
    digits = countryCode + digits.slice(1);
  } else if (!digits.startsWith(countryCode)) {
    // No trunk prefix and no country code — assume it is local.
    digits = countryCode + digits;
  }

  // Shorter than this cannot be a real international number; better to fall
  // back to the contact picker than to open a chat with the wrong person.
  if (digits.length < 8) return null;

  return digits;
}

/** `true` when a usable WhatsApp link can be built for this number. */
export function hasWhatsAppNumber(input: string | null | undefined): boolean {
  return toWhatsAppNumber(input) !== null;
}
