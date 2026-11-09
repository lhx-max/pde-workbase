// The host injects product policy; shared canvas code never imports a product manifest.
let disabledProviders: readonly string[] = [];

export function setCanvasMediaPolicy(providers: readonly string[]): void {
  disabledProviders = [...providers];
}

export function isCanvasMediaProviderEnabled(provider: string): boolean {
  return !disabledProviders.includes(provider);
}
