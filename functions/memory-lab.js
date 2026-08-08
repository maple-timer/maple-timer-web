export async function onRequest(context) {
  const assetUrl = new URL(context.request.url);
  assetUrl.pathname = "/";
  assetUrl.search = "";
  return context.env.ASSETS.fetch(assetUrl.toString(), context.request);
}
