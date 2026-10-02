// Realistic CDN/WAF refusal pages, trimmed to the parts their vendors always
// serve. Groupon's www host sits behind Akamai; the Cloudflare page guards the
// detector's other common vendor so the tests are not Akamai-shaped only.

/** Akamai's "Access Denied" page, as served with a 403 from www.groupon.com. */
export const AKAMAI_403 = `<HTML><HEAD>
<TITLE>Access Denied</TITLE>
</HEAD><BODY>
<H1>Access Denied</H1>

You don't have permission to access "http&#58;&#47;&#47;www&#46;groupon&#46;com&#47;mobilenextapi&#47;graphql" on this server.<P>
Reference&#32;&#35;18&#46;4a2c1602&#46;1759400000&#46;1b2c3d4e
<P>https&#58;&#47;&#47;errors&#46;edgesuite&#46;net&#47;18&#46;4a2c1602&#46;1759400000&#46;1b2c3d4e</P>
</BODY>
</HTML>
`;

/** Cloudflare's "Attention Required!" block page. */
export const CLOUDFLARE_403 = `<!DOCTYPE html>
<html class="no-js" lang="en-US">
<head>
<title>Attention Required! | Cloudflare</title>
<meta charset="UTF-8" />
</head>
<body>
  <div id="cf-wrapper">
    <div id="cf-error-details" class="cf-error-details-wrapper">
      <h1 data-translate="block_headline">Sorry, you have been blocked</h1>
      <h2 class="cf-subheadline">You are unable to access groupon.com</h2>
    </div>
  </div>
</body>
</html>
`;

/** A genuine origin refusal: plain, no vendor marker. The control case. */
export const ORIGIN_403 = `<html><head><title>403 Forbidden</title></head><body><h1>Forbidden</h1></body></html>`;

/** An HTML Response the way a CDN serves one. */
export function htmlRes(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html', ...headers } });
}
