/* Production gates. Empty string = feature hidden / not loaded. No secrets. */
window.SITE_CONFIG = Object.freeze({
  checkoutUrl: '', // set to real Cakto HTTPS URL when Funil delivers it
  pixelId: '', // Meta dataset ID when available
  labofertasScript: '', // full script URL or empty
  /* Same-host sibling path: works on local simulate and GitHub Pages org repos. */
  appUrl: '../recettesproteinees-app/',
  merciUrl: 'merci/',
  showIncompleteFaq: false, // hide FAQ rows that still contain blockers
  production: true
});
