// Click-tracking parameters that sites add to links (fbclid, gclid, utm_*...). Used by the
// browser to clean addresses as they open, and by the Lab's "Clean link" tool.

export const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'mc_eid', 'igshid', 'igsh',
  'yclid', 'twclid', 'ttclid', 'li_fat_id', 'epik', 'mkt_tok', '_hsenc', '_hsmi', '__hstc', '__hssc',
  '__hsfp', 'hsctatracking', 'oly_anon_id', 'oly_enc_id', 'vero_id', 'vero_conv', 'rb_clickid', 's_cid',
  'wickedid', 'ml_subscriber', 'ml_subscriber_hash', 'srsltid', 'si', 'utm_source', 'utm_medium',
  'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'utm_name', 'utm_cid', 'utm_reader', 'utm_referrer',
  'utm_social', 'utm_social-type', 'utm_brand', 'utm_place', 'utm_pubreferrer', 'utm_swu', 'utm_viz_id'
])

/** Parameters that are only trackers on some sites (elsewhere they can mean something else). */
export const ONLY_ON: Record<string, string[]> = {
  // "si" is the share id on YouTube and Spotify links; some shops use it for other things
  si: ['youtube.com', 'youtu.be', 'spotify.com']
}

/** Is this query parameter a tracker on this site ("example.com")? */
export function isTrackingParam(key: string, site: string): boolean {
  const k = key.toLowerCase()
  if (!TRACKING_PARAMS.has(k)) return false
  const only = ONLY_ON[k]
  return !only || only.includes(site)
}
