import { du } from "./locales/desktop-ui.js";
/** Installation UI is owned by Electron, not by an untrusted website. */
export async function prepareBrowserConnector(options: {
  browserName: string;
  prompt: (detail: string, buttons: string[]) => Promise<number>;
  openInstall: () => Promise<void>;
}): Promise<boolean> {
  const choice = await options.prompt(
    du().firstConnectorInstall(options.browserName),
    [du().cancel, du().firstInstall, du().alreadyInstalledContinue],
  );
  if (choice === 0) return false;
  if (choice === 2) return true;
  if (choice !== 1) return false;
  await options.openInstall();
  return await options.prompt(
    du().connectorInstallDetail,
    [du().later, du().alreadyInstalledConnect],
  ) === 1;
}
